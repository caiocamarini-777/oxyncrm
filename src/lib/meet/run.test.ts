import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const loader = vi.hoisted(() => ({
  domains: new Set<string>(["oxyn.com.br"]),
  candidates: [] as unknown[],
}));
vi.mock("./match-loader", () => ({
  loadInternalDomains: vi.fn(async () => loader.domains),
  loadCandidates: vi.fn(async () => loader.candidates),
}));

import type { SupabaseClient } from "@supabase/supabase-js";
import { GmailApiError, GmailNetworkError, GmailRateLimitError } from "@/lib/gmail/client";
import { MEET_SCOPES } from "@/lib/gmail/connect";
import type { CalendarEvent, ConferenceRecord, MeetClient, Participant, Transcript, TranscriptEntry } from "./google";
import type { Candidate } from "./match";
import type { MeetingNotes, NotesInput } from "./notes";
import { isPermanentGoogleError, MAX_TRANSCRIPT_CHARS, type MeetDeps, processMeeting, runMeetSync } from "./run";
import { type MeetingSink, SinkError } from "./sink";

// ---- banco em memória ----------------------------------------------------------------------------------------

type Row = Record<string, unknown>;
type Tables = Record<string, Row[]>;

/** Chaves únicas que o banco de verdade garante (as que a rodada depende). */
const UNIQUE: Record<string, string[]> = {
  meetings: ["conference_record"],
  meeting_transcripts: ["meeting_id"],
  meeting_notes: ["meeting_id"],
  notifications: ["meeting_id", "kind", "user_id"],
};

let seq = 0;
const DEFAULTS: Record<string, () => Row> = {
  meetings: () => ({
    id: `m${++seq}`,
    status: "waiting_transcript",
    attempts: 0,
    last_error: null,
    entity: null,
    record_id: null,
    anchor_activity_id: null,
    calendar_event_id: null,
    attendees: [],
    title: "",
    updated_at: "2026-11-05T15:00:00.000Z",
  }),
  meeting_notes: () => ({ pipedrive_note_id: null, written_at: null }),
  meeting_suggestions: () => ({ id: `s${++seq}`, status: "pending", decided_by: null, decided_at: null, last_error: null }),
  notifications: () => ({ id: ++seq, read_at: null }),
};

const time = (v: unknown) => (typeof v === "string" ? Date.parse(v) : NaN);
function cmp(a: unknown, b: unknown): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  const ta = time(a);
  const tb = time(b);
  if (!Number.isNaN(ta) && !Number.isNaN(tb)) return ta - tb;
  return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
}
const unquote = (s: string) => (s.startsWith('"') && s.endsWith('"') ? s.slice(1, -1) : s);

/**
 * Banco falso no padrão do `run.test.ts` do Gmail, mas com estado: as tabelas são listas de linhas e o
 * construtor de consultas entende o vocabulário que a rodada usa (filtros, ordem, insert, upsert com
 * `onConflict`/`ignoreDuplicates`, update, delete e o `.or` do lease). Chave única violada devolve 23505.
 */
function fakeDb(tables: Tables) {
  const log: { table: string; op: string; values?: unknown }[] = [];
  const db = {
    from(table: string) {
      const rows = (tables[table] ??= []);
      let op: "select" | "insert" | "upsert" | "update" | "delete" = "select";
      let payload: Row[] = [];
      let upsertOpts: { onConflict?: string; ignoreDuplicates?: boolean } = {};
      let returning = false;
      let single: "single" | "maybe" | null = null;
      let limit = Infinity;
      const orders: { col: string; asc: boolean }[] = [];
      const filters: ((r: Row) => boolean)[] = [];
      const chain: Record<string, unknown> = {};

      chain.select = () => {
        if (op !== "select") returning = true;
        return chain;
      };
      chain.insert = (v: Row | Row[]) => ((op = "insert"), (payload = Array.isArray(v) ? v : [v]), chain);
      chain.upsert = (v: Row | Row[], o: typeof upsertOpts = {}) => (
        (op = "upsert"), (payload = Array.isArray(v) ? v : [v]), (upsertOpts = o), chain
      );
      chain.update = (v: Row) => ((op = "update"), (payload = [v]), chain);
      chain.delete = () => ((op = "delete"), chain);
      chain.eq = (c: string, v: unknown) => (filters.push((r) => r[c] === v), chain);
      // `ilike` sem curingas (o código escapa `%`, `_` e `\`): igualdade sem diferenciar maiúsculas.
      chain.ilike = (c: string, pattern: string) => {
        const literal = pattern.replace(/\\(.)/g, "$1").toLowerCase();
        filters.push((r) => typeof r[c] === "string" && (r[c] as string).toLowerCase() === literal);
        return chain;
      };
      chain.neq = (c: string, v: unknown) => (filters.push((r) => r[c] !== v), chain);
      chain.is = (c: string, v: null) => (filters.push((r) => (r[c] ?? null) === v), chain);
      chain.not = (c: string, o: string, v: unknown) => (
        filters.push((r) => (o === "is" ? (r[c] ?? null) !== v : true)), chain
      );
      chain.in = (c: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[c])), chain);
      chain.lt = (c: string, v: unknown) => (filters.push((r) => r[c] != null && cmp(r[c], v) < 0), chain);
      chain.lte = (c: string, v: unknown) => (filters.push((r) => r[c] != null && cmp(r[c], v) <= 0), chain);
      chain.gte = (c: string, v: unknown) => (filters.push((r) => r[c] != null && cmp(r[c], v) >= 0), chain);
      chain.or = (expr: string) => {
        const parts = expr.split(",").map((p) => {
          const [col, o, ...rest] = p.split(".");
          const v = unquote(rest.join("."));
          return (r: Row) =>
            o === "is" ? (r[col] ?? null) === null : o === "lt" ? r[col] != null && cmp(r[col], v) < 0 : r[col] === v;
        });
        filters.push((r) => parts.some((f) => f(r)));
        return chain;
      };
      chain.order = (col: string, o: { ascending?: boolean } = {}) => (
        orders.push({ col, asc: o.ascending !== false }), chain
      );
      chain.limit = (n: number) => ((limit = n), chain);
      chain.single = () => ((single = "single"), chain);
      chain.maybeSingle = () => ((single = "maybe"), chain);

      const conflict = (row: Row) => {
        const keys = UNIQUE[table];
        if (!keys) return undefined;
        return rows.find((r) => keys.every((k) => r[k] != null && r[k] === row[k]));
      };

      chain.then = (resolve: (v: unknown) => void, reject?: (e: unknown) => void) => {
        try {
          log.push({ table, op, values: op === "select" || op === "delete" ? undefined : payload });
          const match = rows.filter((r) => filters.every((f) => f(r)));
          let data: Row[] = [];
          if (op === "select") {
            data = [...match];
            for (const o of [...orders].reverse()) data.sort((a, b) => (o.asc ? 1 : -1) * cmp(a[o.col], b[o.col]));
            data = data.slice(0, limit);
          } else if (op === "insert") {
            const fresh = payload.map((v) => ({ ...(DEFAULTS[table]?.() ?? {}), ...structuredClone(v) }));
            if (fresh.some((r) => conflict(r))) {
              return resolve({ data: null, error: { code: "23505", message: "duplicate key value" } });
            }
            rows.push(...fresh);
            data = fresh;
          } else if (op === "upsert") {
            for (const v of payload) {
              const existing = conflict(v);
              if (existing) {
                if (upsertOpts.ignoreDuplicates) continue;
                Object.assign(existing, structuredClone(v));
                data.push(existing);
              } else {
                const fresh = { ...(DEFAULTS[table]?.() ?? {}), ...structuredClone(v) };
                rows.push(fresh);
                data.push(fresh);
              }
            }
          } else if (op === "update") {
            for (const r of match) Object.assign(r, structuredClone(payload[0]));
            data = match;
          } else {
            for (const r of match) rows.splice(rows.indexOf(r), 1);
            data = match;
          }
          const out = data.map((r) => structuredClone(r));
          if (single) {
            if (single === "single" && out.length !== 1) {
              return resolve({ data: null, error: { code: "PGRST116", message: "esperava uma linha" } });
            }
            return resolve({ data: out[0] ?? null, error: null });
          }
          return resolve({ data: op === "select" || returning ? out : null, error: null });
        } catch (e) {
          if (reject) return reject(e);
          throw e;
        }
      };
      return chain;
    },
  } as unknown as SupabaseClient;
  return { db, tables, log };
}

// ---- Meet falso ----------------------------------------------------------------------------------------------

type MeetData = {
  records: ConferenceRecord[];
  codes?: Record<string, string>;
  events?: Record<string, CalendarEvent | null>;
  transcripts?: Record<string, Transcript[]>;
  entries?: Record<string, TranscriptEntry[]>;
  participants?: Record<string, Participant[]>;
};

function fakeMeet(d: MeetData) {
  const calls = { list: [] as Date[], transcripts: 0, codes: 0 };
  const client = {
    listConferenceRecords: async (since: Date) => {
      calls.list.push(since);
      return d.records.filter((r) => r.endTime && Date.parse(r.endTime) >= since.getTime());
    },
    getMeetingCode: async (space: string) => (calls.codes++, d.codes?.[space] ?? null),
    findEventByMeetingCode: async (code: string) => d.events?.[code] ?? null,
    listTranscripts: async (record: string) => (calls.transcripts++, d.transcripts?.[record] ?? []),
    listTranscriptEntries: async (t: string) => d.entries?.[t] ?? [],
    listParticipants: async (record: string) => d.participants?.[record] ?? [],
  };
  return { client: client as unknown as MeetClient, calls };
}

// ---- dados de base -------------------------------------------------------------------------------------------

const NOW = new Date("2026-11-05T15:00:00.000Z");
const R1 = "conferenceRecords/r1";
const T1 = `${R1}/transcripts/t1`;

const NOTES: MeetingNotes = {
  summary: "Cliente quer automatizar a cobrança.",
  pains: ["Cobrança manual"],
  objections: ["Preço"],
  qualification: [{ question: "Dor principal", answer: "Cobrança manual" }],
  next_steps: [{ what: "Enviar proposta", owner: "Caio", due: "2026-11-10" }],
  suggestions: {
    meeting_outcome: "Realizada",
    next_activity: { type: "Ligação", subject: "Retorno da proposta", due_date: "2026-11-12", due_time: "10:00" },
    stage: "Negociação",
  },
};

const record = (over: Partial<ConferenceRecord> = {}): ConferenceRecord => ({
  name: R1,
  space: "spaces/s1",
  startTime: "2026-11-05T14:00:00.000Z",
  endTime: "2026-11-05T14:45:00.000Z",
  ...over,
});

const event = (attendees: string[], organizer = "caio@oxyn.com.br"): CalendarEvent => ({
  id: "ev1",
  summary: "Apresentação Acme",
  organizer: { email: organizer },
  attendees: attendees.map((email) => ({ email, displayName: email.split("@")[0] })),
  conferenceData: { conferenceId: "abc-defg-hij" },
});

function meetData(over: Partial<MeetData> = {}): MeetData {
  return {
    records: [record()],
    codes: { "spaces/s1": "abc-defg-hij" },
    events: { "abc-defg-hij": event(["caio@oxyn.com.br", "Cliente@Acme.com "]) },
    transcripts: { [R1]: [{ name: T1, state: "FILE_GENERATED" }] },
    entries: {
      [T1]: [
        { participant: `${R1}/participants/p2`, text: "Precisamos automatizar.", startTime: "2026-11-05T14:01:00.000Z" },
        { participant: `${R1}/participants/p1`, text: "Bom dia!", startTime: "2026-11-05T14:00:10.000Z" },
      ],
    },
    participants: {
      [R1]: [
        { name: `${R1}/participants/p1`, signedinUser: { user: "users/1", displayName: "Caio" } },
        { name: `${R1}/participants/p2`, anonymousUser: { displayName: "Cliente" } },
      ],
    },
    ...over,
  };
}

const account = (id: string, userId: string, over: Row = {}): Row => ({
  id,
  user_id: userId,
  company_id: "co",
  email: `${id}@oxyn.com.br`,
  status: "active",
  scopes: [...MEET_SCOPES],
  meeting_cursor: null,
  meeting_lock_until: null,
  ...over,
});

function baseTables(over: Tables = {}): Tables {
  return {
    companies: [{ id: "co", archived_at: null, settings: { meeting_assistant: { enabled: true } } }],
    profiles: [
      { id: "u1", email: "caio@oxyn.com.br", full_name: "Caio Camarini", active: true },
      { id: "u2", email: "ana@oxyn.com.br", full_name: "Ana Souza", active: true },
    ],
    memberships: [
      { user_id: "u1", company_id: "co" },
      { user_id: "u2", company_id: "co" },
    ],
    email_accounts: [account("acc1", "u1")],
    deals: [
      {
        id: "d1",
        company_id: "co",
        title: "Projeto Acme",
        pipeline_id: "pl1",
        stage_id: "st1",
        estimated_value: 12000,
        setup_total: 2000,
        mrr: 500,
        person_id: "pe1",
        organization_id: "o1",
        deleted_at: null,
      },
    ],
    stages: [
      { id: "st2", pipeline_id: "pl1", name: "Negociação", position: 2, archived_at: null },
      { id: "st1", pipeline_id: "pl1", name: "Proposta", position: 1, archived_at: null },
      { id: "st9", pipeline_id: "pl1", name: "Antiga", position: 3, archived_at: "2026-01-01T00:00:00Z" },
      { id: "sx", pipeline_id: "pl2", name: "Outro funil", position: 1, archived_at: null },
    ],
    external_ids: [
      { source: "pipedrive", entity: "deals", external_id: "101", company_id: "co", record_id: "d1" },
      { source: "pipedrive", entity: "persons", external_id: "201", company_id: "co", record_id: "pe1" },
      { source: "pipedrive", entity: "organizations", external_id: "301", company_id: "co", record_id: "o1" },
    ],
    notes: [
      { id: "n1", entity: "deals", record_id: "d1", body: "Primeira", created_at: "2026-10-01T10:00:00Z", deleted_at: null },
      { id: "n2", entity: "deals", record_id: "d1", body: "<p>Segunda <b>nota</b></p>", created_at: "2026-10-02T10:00:00Z", deleted_at: null },
      { id: "n3", entity: "deals", record_id: "d1", body: "Terceira", created_at: "2026-10-03T10:00:00Z", deleted_at: null },
      { id: "n4", entity: "deals", record_id: "d1", body: "Quarta", created_at: "2026-10-04T10:00:00Z", deleted_at: null },
      { id: "n5", entity: "deals", record_id: "d1", body: "Apagada", created_at: "2026-10-05T10:00:00Z", deleted_at: "2026-10-06T00:00:00Z" },
    ],
    import_jobs: [],
    meetings: [],
    meeting_transcripts: [],
    meeting_notes: [],
    meeting_suggestions: [],
    notifications: [],
    ...over,
  };
}

const dealCandidate: Candidate = {
  person: { id: "pe1", organizationId: "o1" },
  deals: [{ id: "d1", personId: "pe1", organizationId: "o1", lastActivityAt: null }],
  leads: [],
  meetingActivities: [],
};

function fakeSink(writeNote?: MeetingSink["writeNote"]) {
  return {
    writeNote: vi.fn(writeNote ?? (async () => ({ noteId: 555 }))),
    completeMeeting: vi.fn(async () => {}),
    createActivity: vi.fn(async () => {}),
    moveStage: vi.fn(async () => {}),
  };
}

type Setup = {
  tables?: Tables;
  meet?: Record<string, MeetData>;
  now?: Date;
  sink?: ReturnType<typeof fakeSink>;
  notes?: (input: NotesInput) => Promise<MeetingNotes>;
};

function setup(s: Setup = {}) {
  const { db, tables, log } = fakeDb(s.tables ?? baseTables());
  const meets = Object.fromEntries(Object.entries(s.meet ?? { acc1: meetData() }).map(([k, v]) => [k, fakeMeet(v)]));
  let now = s.now ?? NOW;
  const sink = s.sink ?? fakeSink();
  const notes = vi.fn(s.notes ?? (async () => NOTES));
  const pipedriveNames = vi.fn(async () => ({ outcomes: ["Realizada", "Não compareceu"], activityTypes: ["Reunião", "Ligação"] }));
  const deps: MeetDeps = {
    db,
    meetFor: (id) => (meets[id] ?? fakeMeet({ records: [] })).client,
    notes,
    sink,
    now: () => now,
    pipedriveNames,
  };
  return {
    db,
    tables,
    log,
    meets,
    sink,
    notes,
    pipedriveNames,
    deps,
    setNow: (d: Date) => (now = d),
    run: () => runMeetSync(deps, { budgetMs: 240_000 }),
  };
}

const minutesAfter = (iso: string, min: number) => new Date(Date.parse(iso) + min * 60_000);

beforeEach(() => {
  seq = 0;
  loader.domains = new Set(["oxyn.com.br"]);
  loader.candidates = [dealCandidate];
});

// ---- testes --------------------------------------------------------------------------------------------------

describe("runMeetSync: captura", () => {
  it("a mesma conference_record em duas contas cria uma reunião só, processada uma vez", async () => {
    const t = setup({
      tables: baseTables({ email_accounts: [account("acc1", "u1"), account("acc2", "u2")] }),
      meet: { acc1: meetData(), acc2: meetData() },
    });
    const out = await t.run();

    expect(t.tables.meetings).toHaveLength(1);
    expect(t.tables.meetings[0]).toMatchObject({ account_id: "acc1", owner_id: "u1", status: "done" });
    expect(t.notes).toHaveBeenCalledTimes(1);
    expect(t.sink.writeNote).toHaveBeenCalledTimes(1);
    expect(t.meets.acc2.calls.codes).toBe(0); // já existia: nem consulta a agenda
    expect(out).toEqual([
      { accountId: "acc1", created: 1, processed: 1, failed: 0 },
      { accountId: "acc2", created: 0, processed: 0, failed: 0 },
    ]);
  });

  it("dono é o organizador quando ele é usuário do CRM, mesmo trazido pela conta de outro", async () => {
    const t = setup({
      tables: baseTables({ email_accounts: [account("acc2", "u2")] }),
      meet: { acc2: meetData() },
    });
    await t.run();
    expect(t.tables.meetings[0]).toMatchObject({ account_id: "acc2", owner_id: "u1" });
  });

  it("organizador de fora do CRM: dono é o dono da conta", async () => {
    const t = setup({
      meet: {
        acc1: meetData({ events: { "abc-defg-hij": event(["caio@oxyn.com.br", "cliente@acme.com"], "cliente@acme.com") } }),
      },
    });
    await t.run();
    expect(t.tables.meetings[0]).toMatchObject({ owner_id: "u1" });
  });

  it("organizador com maiúsculas e espaços (no evento ou no perfil) ainda é reconhecido como dono", async () => {
    const t = setup({
      tables: baseTables({ email_accounts: [account("acc2", "u2")] }),
      meet: {
        acc2: meetData({ events: { "abc-defg-hij": event(["cliente@acme.com"], " Caio@OXYN.com.br ") } }),
      },
    });
    (t.tables.profiles[0] as Row).email = "CAIO@oxyn.com.br";
    await t.run();
    expect(t.tables.meetings[0]).toMatchObject({ account_id: "acc2", owner_id: "u1" });
  });

  it("organizador do CRM sem vínculo com a empresa da reunião, ou inativo: dono é o dono da conta", async () => {
    const semVinculo = setup({
      tables: baseTables({
        email_accounts: [account("acc2", "u2")],
        memberships: [
          { user_id: "u1", company_id: "outra" },
          { user_id: "u2", company_id: "co" },
        ],
      }),
      meet: { acc2: meetData() },
    });
    await semVinculo.run();
    expect(semVinculo.tables.meetings[0]).toMatchObject({ owner_id: "u2" });

    const inativo = setup({ tables: baseTables({ email_accounts: [account("acc2", "u2")] }), meet: { acc2: meetData() } });
    (inativo.tables.profiles[0] as Row).active = false;
    await inativo.run();
    expect(inativo.tables.meetings[0]).toMatchObject({ owner_id: "u2" });
  });

  it("e-mail de organizador com _ não casa com outro perfil por curinga", async () => {
    const t = setup({
      tables: baseTables({ email_accounts: [account("acc2", "u2")] }),
      meet: { acc2: meetData({ events: { "abc-defg-hij": event(["cliente@acme.com"], "c_io@oxyn.com.br") } }) },
    });
    (t.tables.profiles[0] as Row).email = "caio@oxyn.com.br";
    await t.run();
    expect(t.tables.meetings[0]).toMatchObject({ owner_id: "u2" });
  });

  it("grava título, evento e convidados (normalizados, com a marca de interno)", async () => {
    const t = setup();
    await t.run();
    expect(t.tables.meetings[0]).toMatchObject({
      company_id: "co",
      conference_record: R1,
      calendar_event_id: "ev1",
      title: "Apresentação Acme",
      started_at: "2026-11-05T14:00:00.000Z",
      ended_at: "2026-11-05T14:45:00.000Z",
      attendees: [
        { email: "caio@oxyn.com.br", name: "caio", internal: true },
        { email: "cliente@acme.com", name: "Cliente", internal: false },
      ],
    });
  });

  it("reunião só com internos vira ignored e o Claude não é chamado", async () => {
    const t = setup({
      meet: { acc1: meetData({ events: { "abc-defg-hij": event(["caio@oxyn.com.br", "ana@oxyn.com.br"]) } }) },
    });
    const out = await t.run();
    expect(t.tables.meetings[0].status).toBe("ignored");
    expect(t.notes).not.toHaveBeenCalled();
    expect(t.pipedriveNames).not.toHaveBeenCalled();
    expect(t.meets.acc1.calls.transcripts).toBe(0);
    expect(out[0]).toEqual({ accountId: "acc1", created: 1, processed: 0, failed: 0 });
  });

  it("sem evento na agenda (reunião instantânea) e sem e-mails: vira ignored", async () => {
    const t = setup({ meet: { acc1: meetData({ events: {} }) } });
    await t.run();
    expect(t.tables.meetings[0]).toMatchObject({ status: "ignored", title: "Reunião do Meet", calendar_event_id: null });
    expect(t.tables.meetings[0].attendees).toEqual([
      { email: null, name: "Caio", internal: false },
      { email: null, name: "Cliente", internal: false },
    ]);
  });

  it("primeira leitura vai até 1 dia atrás; o cursor avança para o maior endTime lido", async () => {
    const t = setup({
      meet: {
        acc1: meetData({
          records: [
            record(),
            record({ name: "conferenceRecords/r2", endTime: "2026-11-05T14:50:00.000Z" }),
            record({ name: "conferenceRecords/r3", endTime: null }),
          ],
        }),
      },
    });
    await t.run();
    expect(t.meets.acc1.calls.list[0].toISOString()).toBe("2026-11-04T15:00:00.000Z");
    expect(t.tables.email_accounts[0].meeting_cursor).toBe("2026-11-05T14:50:00.000Z");
    expect(t.tables.meetings.map((m) => m.conference_record)).toEqual([R1, "conferenceRecords/r2"]);

    await t.run();
    expect(t.meets.acc1.calls.list[1].toISOString()).toBe("2026-11-05T14:50:00.000Z");
    expect(t.tables.meetings).toHaveLength(2);
  });

  it("conta sem os escopos do Meet ou empresa com o assistente desligado é pulada", async () => {
    const t = setup({
      tables: baseTables({
        companies: [
          { id: "co", archived_at: null, settings: { meeting_assistant: { enabled: true } } },
          { id: "co2", archived_at: null, settings: {} },
        ],
        email_accounts: [
          account("acc1", "u1", { scopes: ["https://www.googleapis.com/auth/gmail.modify"] }),
          account("acc2", "u2", { company_id: "co2" }),
          account("acc3", "u2", { status: "reconnect" }),
        ],
      }),
      meet: { acc1: meetData(), acc2: meetData(), acc3: meetData() },
    });
    const out = await t.run();
    expect(out).toEqual([]);
    expect(t.meets.acc1.calls.list).toHaveLength(0);
    expect(t.meets.acc2.calls.list).toHaveLength(0);
    expect(t.meets.acc3.calls.list).toHaveLength(0);
  });

  it("lease: conta segura por outra rodada é pulada; a própria lease é solta no fim", async () => {
    const busy = setup({
      tables: baseTables({ email_accounts: [account("acc1", "u1", { meeting_lock_until: "2026-11-05T15:03:00.000Z" })] }),
    });
    expect(await busy.run()).toEqual([]);
    expect(busy.meets.acc1.calls.list).toHaveLength(0);

    const free = setup({
      tables: baseTables({ email_accounts: [account("acc1", "u1", { meeting_lock_until: "2026-11-05T14:00:00.000Z" })] }),
    });
    await free.run();
    expect(free.meets.acc1.calls.list).toHaveLength(1);
    expect(free.tables.email_accounts[0].meeting_lock_until).toBeNull();
  });

  it("isPermanentGoogleError: 4xx sem ser token ou limite é permanente; rede, 5xx e limite não", () => {
    expect(isPermanentGoogleError(new GmailApiError(404, "não encontrado"))).toBe(true);
    expect(isPermanentGoogleError(new GmailApiError(403, "sem acesso"))).toBe(true);
    expect(isPermanentGoogleError(new GmailApiError(401, "token"))).toBe(false);
    expect(isPermanentGoogleError(new GmailApiError(429, "limite"))).toBe(false);
    expect(isPermanentGoogleError(new GmailApiError(503, "fora do ar"))).toBe(false);
    expect(isPermanentGoogleError(new GmailRateLimitError())).toBe(false);
    expect(isPermanentGoogleError(new GmailNetworkError())).toBe(false);
    expect(isPermanentGoogleError(new Error("x"))).toBe(false);
  });

  it("erro permanente do Google numa reunião: registra como failed e o cursor passa dela", async () => {
    const r2 = record({ name: "conferenceRecords/r2", space: "spaces/s2", endTime: "2026-11-05T14:50:00.000Z" });
    const t = setup({
      meet: {
        acc1: meetData({
          records: [record({ space: "spaces/apagado" }), r2],
          codes: { "spaces/s2": "abc-defg-hij" },
          transcripts: { "conferenceRecords/r2": [{ name: T1, state: "FILE_GENERATED" }] },
        }),
      },
    });
    const client = t.meets.acc1.client as unknown as { getMeetingCode: (space: string) => Promise<string | null> };
    const original = client.getMeetingCode;
    client.getMeetingCode = async (space) => {
      if (space === "spaces/apagado") throw new GmailApiError(404, "Requested entity was not found.");
      return original(space);
    };
    const out = await t.run();

    expect(t.tables.meetings.map((m) => [m.conference_record, m.status])).toEqual([
      [R1, "failed"],
      ["conferenceRecords/r2", "done"],
    ]);
    expect(t.tables.meetings[0]).toMatchObject({
      owner_id: "u1",
      last_error: "Não foi possível ler a reunião no Google: Requested entity was not found.",
    });
    expect(t.tables.email_accounts[0].meeting_cursor).toBe("2026-11-05T14:50:00.000Z");
    expect(out[0]).toEqual({ accountId: "acc1", created: 2, processed: 1, failed: 1 });

    // Na rodada seguinte, a reunião ilegível não é lida de novo.
    let reads = 0;
    client.getMeetingCode = async (space) => (reads++, original(space));
    await t.run();
    expect(reads).toBe(0);
  });

  it.each([
    ["5xx", new GmailApiError(503, "Backend Error")],
    ["rede", new GmailNetworkError("socket hang up")],
    ["limite", new GmailRateLimitError("Quota exceeded")],
  ])("erro passageiro do Google (%s): para, o cursor não passa da reunião e a próxima rodada tenta de novo", async (_n, err) => {
    const r2 = record({ name: "conferenceRecords/r2", endTime: "2026-11-05T14:50:00.000Z" });
    const t = setup({ meet: { acc1: meetData({ records: [record(), r2] }) } });
    const client = t.meets.acc1.client as unknown as { getMeetingCode: (space: string) => Promise<string | null> };
    const original = client.getMeetingCode;
    client.getMeetingCode = async () => {
      throw err;
    };
    const out = await t.run();
    expect(t.tables.meetings).toHaveLength(0);
    expect(t.tables.email_accounts[0].meeting_cursor).toBeNull();
    expect(out[0]).toMatchObject({ created: 0, error: err.message });

    client.getMeetingCode = original;
    await t.run();
    expect(t.tables.meetings.map((m) => m.conference_record)).toEqual([R1, "conferenceRecords/r2"]);
    expect(t.tables.email_accounts[0].meeting_cursor).toBe("2026-11-05T14:50:00.000Z");
  });

  it("falha do Google numa conta não derruba as outras", async () => {
    const t = setup({
      tables: baseTables({ email_accounts: [account("acc1", "u1"), account("acc2", "u2")] }),
      meet: { acc2: meetData() },
    });
    t.meets.acc1 = fakeMeet({ records: [] });
    (t.meets.acc1.client as unknown as { listConferenceRecords: () => Promise<never> }).listConferenceRecords = async () => {
      throw new Error("Google fora do ar");
    };
    const out = await t.run();
    expect(out[0]).toMatchObject({ accountId: "acc1", created: 0, error: "Google fora do ar" });
    expect(out[1]).toMatchObject({ accountId: "acc2", created: 1, processed: 1 });
  });
});

describe("runMeetSync: transcrição", () => {
  it("transcrição STARTED continua em waiting_transcript; a 2 h e 1 min do fim, vira failed", async () => {
    const t = setup({ meet: { acc1: meetData({ transcripts: { [R1]: [{ name: T1, state: "STARTED" }] } }) } });
    await t.run();
    expect(t.tables.meetings[0]).toMatchObject({ status: "waiting_transcript" });
    expect(t.notes).not.toHaveBeenCalled();

    t.setNow(minutesAfter("2026-11-05T14:45:00.000Z", 120));
    await t.run();
    expect(t.tables.meetings[0]).toMatchObject({ status: "waiting_transcript" });

    t.setNow(minutesAfter("2026-11-05T14:45:00.000Z", 121));
    const out = await t.run();
    expect(t.tables.meetings[0]).toMatchObject({ status: "failed", last_error: "reunião sem transcrição" });
    expect(out[0]).toMatchObject({ failed: 1 });
    expect(t.notes).not.toHaveBeenCalled();
  });

  it("leitura da transcrição falhando: antes do prazo continua esperando; depois do prazo vira failed", async () => {
    const t = setup({ meet: { acc1: meetData({ transcripts: { [R1]: [{ name: T1, state: "STARTED" }] } }) } });
    await t.run();
    const client = t.meets.acc1.client as unknown as { listTranscripts: () => Promise<never> };
    client.listTranscripts = async () => {
      throw new GmailApiError(403, "The caller does not have permission");
    };

    t.setNow(minutesAfter("2026-11-05T14:45:00.000Z", 60));
    const early = await t.run();
    expect(t.tables.meetings[0]).toMatchObject({ status: "waiting_transcript" });
    expect(early[0].error).toBe("The caller does not have permission");

    t.setNow(minutesAfter("2026-11-05T14:45:00.000Z", 121));
    const out = await t.run();
    expect(t.tables.meetings[0]).toMatchObject({
      status: "failed",
      last_error: "reunião sem transcrição (The caller does not have permission)",
    });
    expect(out[0]).toMatchObject({ failed: 1 });
  });

  it("falha passageira lendo as entradas depois do prazo também encerra a espera", async () => {
    const t = setup({ now: minutesAfter("2026-11-05T14:45:00.000Z", 130) });
    const client = t.meets.acc1.client as unknown as { listTranscriptEntries: () => Promise<never> };
    client.listTranscriptEntries = async () => {
      throw new GmailNetworkError("socket hang up");
    };
    await t.run();
    expect(t.tables.meetings[0]).toMatchObject({ status: "failed", last_error: "reunião sem transcrição (socket hang up)" });
    expect(t.notes).not.toHaveBeenCalled();
  });

  it("FILE_GENERATED: grava as entradas em ordem, com o nome de quem falou, e o texto corrido", async () => {
    const t = setup();
    await t.run();
    expect(t.tables.meeting_transcripts).toHaveLength(1);
    expect(t.tables.meeting_transcripts[0]).toMatchObject({
      meeting_id: "m1",
      entries: [
        { speaker: "Caio", text: "Bom dia!", start: "2026-11-05T14:00:10.000Z" },
        { speaker: "Cliente", text: "Precisamos automatizar.", start: "2026-11-05T14:01:00.000Z" },
      ],
      text: "Caio: Bom dia!\nCliente: Precisamos automatizar.",
    });
  });

  it("texto da transcrição é cortado em 1.048.576 caracteres", async () => {
    const big = "x".repeat(600_000);
    const t = setup({
      meet: {
        acc1: meetData({
          entries: {
            [T1]: [
              { participant: `${R1}/participants/p1`, text: big, startTime: "2026-11-05T14:00:10.000Z" },
              { participant: `${R1}/participants/p2`, text: big, startTime: "2026-11-05T14:01:00.000Z" },
            ],
          },
        }),
      },
    });
    await t.run();
    expect(MAX_TRANSCRIPT_CHARS).toBe(1_048_576);
    expect((t.tables.meeting_transcripts[0].text as string).length).toBe(1_048_576);
    expect(t.notes.mock.calls[0][0].transcript.length).toBe(1_048_576);
  });
});

describe("processMeeting", () => {
  it("com match: writeNote uma vez, sugestões pending e status done", async () => {
    const t = setup();
    const out = await t.run();

    const m = t.tables.meetings[0];
    expect(m).toMatchObject({ status: "done", entity: "deals", record_id: "d1", attempts: 0, last_error: null });
    expect(t.sink.writeNote).toHaveBeenCalledTimes(1);
    const [target, html, userId] = t.sink.writeNote.mock.calls[0];
    expect(target).toEqual({ entity: "deals", pipedriveId: "101", personPipedriveId: "201", orgPipedriveId: "301" });
    expect(html).toContain("Cliente quer automatizar a cobrança.");
    expect(html).toContain("vendedor: Caio Camarini"); // sem usuário do Pipedrive mapeado
    expect(userId).toBeNull();
    expect(t.tables.meeting_notes[0]).toMatchObject({ meeting_id: "m1", pipedrive_note_id: 555, summary: NOTES.summary });
    expect(t.tables.meeting_notes[0].written_at).toBe(NOW.toISOString());
    expect(t.tables.meeting_suggestions.map((s) => [s.kind, s.status, s.payload])).toEqual([
      ["meeting_outcome", "pending", { outcome: "Realizada" }],
      ["next_activity", "pending", NOTES.suggestions.next_activity],
      ["stage", "pending", { stage: "Negociação" }],
    ]);
    expect(out[0]).toEqual({ accountId: "acc1", created: 1, processed: 1, failed: 0 });
  });

  it("monta o pedido ao Claude com o roteiro, os nomes do Pipedrive, as etapas do funil e as 3 últimas anotações", async () => {
    const t = setup({
      tables: baseTables({
        companies: [{ id: "co", archived_at: null, settings: { meeting_assistant: { enabled: true, questions: ["Dor", "Prazo"] } } }],
      }),
    });
    await t.run();
    const input = t.notes.mock.calls[0][0];
    expect(input).toMatchObject({
      questions: ["Dor", "Prazo"],
      title: "Apresentação Acme",
      startedAt: "2026-11-05T14:00:00.000Z",
      outcomes: ["Realizada", "Não compareceu"],
      activityTypes: ["Reunião", "Ligação"],
      stages: ["Proposta", "Negociação"],
      record: {
        kind: "negócio",
        name: "Projeto Acme",
        stage: "Proposta",
        value: 12000,
        setup: 2000,
        mrr: 500,
        recentNotes: ["Quarta", "Terceira", "Segunda nota"],
      },
    });
    expect(input.participants).toEqual(["caio <caio@oxyn.com.br> (interno)", "Cliente <cliente@acme.com>"]);
  });

  it("sem match: vira unlinked, cria uma notificação e não chama writeNote (as notas ficam guardadas)", async () => {
    loader.candidates = [];
    const t = setup();
    const out = await t.run();
    expect(t.tables.meetings[0]).toMatchObject({ status: "unlinked", entity: null });
    expect(t.sink.writeNote).not.toHaveBeenCalled();
    expect(t.tables.meeting_notes).toHaveLength(1);
    expect(t.notes.mock.calls[0][0].stages).toEqual([]);
    expect(t.tables.notifications).toHaveLength(1);
    expect(t.tables.notifications[0]).toMatchObject({
      user_id: "u1",
      company_id: "co",
      kind: "meeting_unlinked",
      meeting_id: "m1",
    });
    expect(out[0]).toMatchObject({ processed: 1, failed: 0 });

    // Rodar de novo (ex.: ação de vincular sem registro) não duplica a notificação.
    await processMeeting(t.deps, "m1");
    expect(t.tables.notifications).toHaveLength(1);
  });

  it("registro vinculado com deleted_at: vira unlinked sem chamar o sink", async () => {
    const tables = baseTables({
      meetings: [
        {
          id: "m1",
          company_id: "co",
          account_id: "acc1",
          owner_id: "u1",
          conference_record: R1,
          title: "Apresentação Acme",
          started_at: "2026-11-05T14:00:00.000Z",
          ended_at: "2026-11-05T14:45:00.000Z",
          attendees: [{ email: "cliente@acme.com", name: "Cliente", internal: false }],
          status: "processing",
          attempts: 0,
          last_error: null,
          entity: "deals",
          record_id: "d1",
          anchor_activity_id: null,
          updated_at: "2026-11-05T14:50:00.000Z",
        },
      ],
      meeting_transcripts: [{ meeting_id: "m1", entries: [], text: "Cliente: oi" }],
    });
    (tables.deals[0] as Row).deleted_at = "2026-11-05T14:55:00.000Z";
    const t = setup({ tables, meet: { acc1: meetData({ records: [] }) } });
    await t.run();
    expect(t.tables.meetings[0]).toMatchObject({
      status: "unlinked",
      entity: "deals",
      record_id: "d1",
      last_error: "registro excluído",
    });
    expect(t.sink.writeNote).not.toHaveBeenCalled();
    expect(t.tables.meeting_suggestions).toHaveLength(0);
    expect(t.tables.notifications).toHaveLength(1);
  });

  it("o sink falha 3 vezes e a reunião vira failed; o Claude é chamado uma vez só", async () => {
    const sink = fakeSink(async () => {
      throw new SinkError(503, "Pipedrive respondeu 503 em POST /v1/notes");
    });
    const t = setup({ sink });
    await t.run();
    expect(t.tables.meetings[0]).toMatchObject({
      status: "processing",
      attempts: 1,
      last_error: "Pipedrive respondeu 503 em POST /v1/notes",
    });
    expect(t.tables.meeting_notes[0].pipedrive_note_id).toBeNull();

    t.setNow(minutesAfter(NOW.toISOString(), 10));
    await t.run();
    expect(t.tables.meetings[0]).toMatchObject({ status: "processing", attempts: 2 });

    t.setNow(minutesAfter(NOW.toISOString(), 20));
    const out = await t.run();
    expect(t.tables.meetings[0]).toMatchObject({ status: "failed", attempts: 3 });
    expect(out[0]).toMatchObject({ failed: 1 });
    expect(sink.writeNote).toHaveBeenCalledTimes(3);
    expect(t.notes).toHaveBeenCalledTimes(1); // notas reaproveitadas de meeting_notes
    expect(t.tables.meeting_suggestions).toHaveLength(0);

    // Reunião failed não é tentada de novo pela rodada.
    t.setNow(minutesAfter(NOW.toISOString(), 30));
    await t.run();
    expect(sink.writeNote).toHaveBeenCalledTimes(3);
  });

  it("o Claude falha 3 vezes e a reunião vira failed, sem chamar o sink", async () => {
    const t = setup({
      notes: async () => {
        throw new Error("O Claude devolveu uma resposta fora do formato esperado.");
      },
    });
    for (let i = 0; i < 3; i++) {
      t.setNow(minutesAfter(NOW.toISOString(), i * 10));
      await t.run();
    }
    expect(t.tables.meetings[0]).toMatchObject({
      status: "failed",
      attempts: 3,
      last_error: "O Claude devolveu uma resposta fora do formato esperado.",
    });
    expect(t.notes).toHaveBeenCalledTimes(3);
    expect(t.sink.writeNote).not.toHaveBeenCalled();
    expect(t.tables.meeting_notes).toHaveLength(0);
  });

  it("anotação já gravada (pipedrive_note_id) não é gravada de novo; só faltam as sugestões", async () => {
    const tables = baseTables({
      meetings: [
        {
          id: "m1",
          company_id: "co",
          account_id: "acc1",
          owner_id: "u1",
          conference_record: R1,
          title: "Apresentação Acme",
          started_at: "2026-11-05T14:00:00.000Z",
          ended_at: "2026-11-05T14:45:00.000Z",
          attendees: [],
          status: "processing",
          attempts: 1,
          last_error: "falha ao criar sugestões",
          entity: "deals",
          record_id: "d1",
          anchor_activity_id: null,
          updated_at: "2026-11-05T14:50:00.000Z",
        },
      ],
      meeting_transcripts: [{ meeting_id: "m1", entries: [], text: "Cliente: oi" }],
      meeting_notes: [
        {
          meeting_id: "m1",
          summary: NOTES.summary,
          pains: NOTES.pains,
          objections: NOTES.objections,
          qualification: NOTES.qualification,
          next_steps: NOTES.next_steps,
          model: "claude-opus-5-5",
          raw: NOTES,
          pipedrive_note_id: 777,
          written_at: "2026-11-05T14:55:00.000Z",
        },
      ],
    });
    const t = setup({ tables, meet: { acc1: meetData({ records: [] }) } });
    await t.run();
    expect(t.sink.writeNote).not.toHaveBeenCalled();
    expect(t.notes).not.toHaveBeenCalled();
    expect(t.tables.meetings[0]).toMatchObject({ status: "done", last_error: null });
    expect(t.tables.meeting_suggestions).toHaveLength(3);
    expect(t.tables.meeting_notes[0].pipedrive_note_id).toBe(777);
  });

  it("os nomes do Pipedrive são lidos uma vez por rodada, e só quando alguma reunião precisa de notas", async () => {
    const t = setup({
      meet: {
        acc1: meetData({
          records: [record(), record({ name: "conferenceRecords/r2", space: "spaces/s1" })],
          transcripts: {
            [R1]: [{ name: T1, state: "FILE_GENERATED" }],
            "conferenceRecords/r2": [{ name: T1, state: "FILE_GENERATED" }],
          },
          participants: {},
        }),
      },
    });
    await t.run();
    expect(t.notes).toHaveBeenCalledTimes(2);
    expect(t.pipedriveNames).toHaveBeenCalledTimes(1);
  });

  it("processMeeting ignora reunião done ou ignored", async () => {
    const t = setup();
    await t.run();
    await processMeeting(t.deps, "m1");
    expect(t.sink.writeNote).toHaveBeenCalledTimes(1);
    expect(t.tables.meetings[0]).toMatchObject({ status: "done", attempts: 0 });

    const internos = setup({
      meet: { acc1: meetData({ events: { "abc-defg-hij": event(["caio@oxyn.com.br", "ana@oxyn.com.br"]) } }) },
    });
    await internos.run();
    await processMeeting(internos.deps, internos.tables.meetings[0].id as string);
    expect(internos.tables.meetings[0]).toMatchObject({ status: "ignored", attempts: 0, entity: null });
    expect(internos.notes).not.toHaveBeenCalled();
  });
});

describe("runMeetSync: descarte", () => {
  it("unlinked de 8 dias vira ignored, e a transcrição e as notas são apagadas", async () => {
    const old = {
      company_id: "co",
      account_id: "acc1",
      owner_id: "u1",
      title: "Velha",
      attendees: [],
      attempts: 0,
      last_error: null,
      entity: null,
      record_id: null,
    };
    const t = setup({
      tables: baseTables({
        meetings: [
          { ...old, id: "old", conference_record: "conferenceRecords/old", status: "unlinked", updated_at: "2026-10-28T14:00:00.000Z" },
          { ...old, id: "new", conference_record: "conferenceRecords/new", status: "unlinked", updated_at: "2026-10-30T16:00:00.000Z" },
        ],
        meeting_transcripts: [
          { meeting_id: "old", entries: [], text: "a" },
          { meeting_id: "new", entries: [], text: "b" },
        ],
        meeting_notes: [{ meeting_id: "old", summary: "s" }, { meeting_id: "new", summary: "s" }],
      }),
      meet: { acc1: meetData({ records: [] }) },
    });
    await t.run();
    expect(t.tables.meetings.map((m) => [m.id, m.status])).toEqual([
      ["old", "ignored"],
      ["new", "unlinked"],
    ]);
    expect(t.tables.meeting_transcripts.map((r) => r.meeting_id)).toEqual(["new"]);
    expect(t.tables.meeting_notes.map((r) => r.meeting_id)).toEqual(["new"]);
  });
});
