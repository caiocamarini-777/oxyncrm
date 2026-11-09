import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/gmail/accounts", () => ({ loadAccountToken: async () => "tok" }));
const loader = vi.hoisted(() => ({ candidates: [] as unknown[] }));
vi.mock("@/lib/meet/match-loader", () => ({
  loadCandidates: vi.fn(async () => loader.candidates),
}));

import { GmailAuthError, GmailRateLimitError } from "@/lib/gmail/client";
import { loadCandidates } from "@/lib/meet/match-loader";
import type { Candidate } from "@/lib/meet/match";
import { fakeDb, resetSeq, type Row, type Tables } from "@/lib/meet/fake-db.test-support";
import { SyncTokenExpiredError, type CalendarClient, type CalendarEvent } from "./google";
import type { CalendarDeps } from "./push";
import { runCalendarSync } from "./sync";

// ---- Agenda falsa --------------------------------------------------------------------------------------------

type Listing = { events: CalendarEvent[]; nextSyncToken: string };
type Script = { changes?: Listing | Error; from?: Listing | Error; window?: CalendarEvent[] | Error };
type Call = {
  account: string;
  op: "listChanges" | "listFrom" | "listWindow" | "insert" | "patch" | "delete";
  arg?: unknown;
  ev?: Partial<CalendarEvent>;
  opts?: Record<string, unknown>;
};

/** Agenda falsa por caixa: as listagens vêm do roteiro; criar, atualizar e apagar só registram a chamada. */
function fakeGoogle(scripts: Record<string, Script>, fail: { insert?: Error } = {}) {
  const calls: Call[] = [];
  let created = 0;
  const reply = <T>(v: T | Error | undefined, fallback: T): T => {
    if (v instanceof Error) throw v;
    return structuredClone(v ?? fallback);
  };
  const clientFor = (account: string) => {
    const s = scripts[account] ?? {};
    return {
      listChanges: async (token: string) => {
        calls.push({ account, op: "listChanges", arg: token });
        return reply(s.changes, { events: [], nextSyncToken: "tok-next" });
      },
      listFrom: async (timeMin: Date) => {
        calls.push({ account, op: "listFrom", arg: timeMin.toISOString() });
        return reply(s.from, { events: [], nextSyncToken: "tok-first" });
      },
      listWindow: async (timeMin: Date, timeMax: Date) => {
        calls.push({ account, op: "listWindow", arg: [timeMin.toISOString(), timeMax.toISOString()] });
        return reply(s.window, []);
      },
      insertEvent: async (ev: Partial<CalendarEvent>, opts: Record<string, unknown>) => {
        calls.push({ account, op: "insert", ev, opts });
        if (fail.insert) throw fail.insert;
        created++;
        return { id: `ev-new-${created}`, etag: `"etag-new-${created}"` };
      },
      patchEvent: async (id: string, ev: Partial<CalendarEvent>, opts: Record<string, unknown>) => {
        calls.push({ account, op: "patch", arg: id, ev, opts });
        return { id, etag: '"etag-patched"' };
      },
      deleteEvent: async (id: string, opts: Record<string, unknown>) => {
        calls.push({ account, op: "delete", arg: id, opts });
      },
    } as unknown as CalendarClient;
  };
  return { calls, clientFor };
}

// ---- dados de base -------------------------------------------------------------------------------------------

const SCOPE = "https://www.googleapis.com/auth/calendar.events";
const NOW = new Date("2026-11-09T15:00:00.000Z");
const MIN = 60_000;
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
/** Id de atividade que vem no `oxynActivityId` (a consulta só aceita uuid). */
const A_UUID = "aaaaaaaa-0000-4000-8000-000000000001";

const account = (over: Row = {}): Row => ({
  id: "acc-1",
  user_id: "u-1",
  company_id: "co-1",
  email: "caio@oxyn.com.br",
  status: "active",
  scopes: ["https://www.googleapis.com/auth/gmail.readonly", SCOPE],
  created_at: "2026-11-01T00:00:00Z",
  calendar_since: "2026-11-09T12:00:00.000Z",
  calendar_sync_token: "tok-1",
  calendar_lock_until: null,
  ...over,
});

const activity = (over: Row = {}): Row => ({
  id: "a-1",
  company_id: "co-1",
  owner_id: "u-1",
  type_id: "t-meet",
  channel_id: "ch-video",
  person_id: "p-1",
  deal_id: "d-1",
  lead_id: null,
  organization_id: null,
  subject: "Demo com a Acme",
  description: "Levar a proposta",
  due_at: "2026-11-10T17:00:00+00:00",
  duration_minutes: 45,
  done: false,
  completed_at: null,
  meeting_outcome: null,
  deleted_at: null,
  updated_at: "2026-11-09T14:00:00+00:00",
  source: "crm",
  calendar_account_id: "acc-1",
  calendar_event_id: "ev-1",
  calendar_etag: '"etag-1"',
  calendar_state: "synced",
  calendar_error: null,
  calendar_attempts: 0,
  meet_url: null,
  ...over,
});

const event = (over: Partial<CalendarEvent> = {}): CalendarEvent => ({
  id: "ev-1",
  etag: '"etag-2"',
  status: "confirmed",
  summary: "Demo com a Acme",
  start: { dateTime: "2026-11-10T17:00:00Z" },
  end: { dateTime: "2026-11-10T17:45:00Z" },
  updated: "2026-11-09T14:30:00.000Z",
  ...over,
});

const PERSON: Row = { id: "p-1", deleted_at: null, emails: [{ value: "cliente@acme.com", primary: true }] };

function baseTables(o: { accounts?: Row[]; activities?: Row[]; companies?: Row[]; types?: Row[]; channels?: Row[] }): Tables {
  return {
    companies: o.companies ?? [
      { id: "co-1", slug: "acme", archived_at: null, settings: { calendar_sync: { enabled: true, enabled_at: "2026-11-09T12:00:00Z" } } },
      { id: "co-2", slug: "outra", archived_at: null, settings: { calendar_sync: { enabled: false } } },
    ],
    activity_types: o.types ?? [
      { id: "t-task", company_id: "co-1", name: "Tarefa", is_meeting: false, active: true, position: 0 },
      { id: "t-call", company_id: "co-1", name: "Ligação", is_meeting: false, active: true, position: 1 },
      { id: "t-meet", company_id: "co-1", name: "Reunião", is_meeting: true, active: true, position: 2 },
    ],
    activity_channels: o.channels ?? [
      { id: "ch-email", company_id: "co-1", name: "E-mail", active: true, is_legacy: false, position: 0 },
      { id: "ch-video", company_id: "co-1", name: "Videochamada", active: true, is_legacy: false, position: 4 },
      { id: "ch-presencial", company_id: "co-1", name: "Presencial", active: true, is_legacy: false, position: 5 },
      { id: "ch-legacy", company_id: "co-1", name: "Não informado", active: false, is_legacy: true, position: 6 },
    ],
    persons: [PERSON],
    email_accounts: o.accounts ?? [account()],
    activities: o.activities ?? [],
  };
}

function setup(
  o: {
    accounts?: Row[];
    activities?: Row[];
    companies?: Row[];
    types?: Row[];
    channels?: Row[];
    google?: Record<string, Script>;
    fail?: { insert?: Error };
    clock?: () => Date;
    budgetMs?: number;
  } = {},
) {
  const tables = baseTables(o);
  const { db, log } = fakeDb(tables);
  const google = fakeGoogle(o.google ?? {}, o.fail);
  const deps: CalendarDeps = { db, clientFor: google.clientFor, now: o.clock ?? (() => NOW), appUrl: "https://crm.oxyn.app" };
  return {
    tables,
    log,
    calls: google.calls,
    run: () => runCalendarSync(deps, { budgetMs: o.budgetMs ?? 60_000 }),
    act: (id: string) => tables.activities.find((r) => r.id === id)!,
    acc: (id = "acc-1") => tables.email_accounts.find((r) => r.id === id)!,
  };
}

type Log = ReturnType<typeof fakeDb>["log"];
const rpcs = (log: Log, name: string) => log.filter((l) => l.op === "rpc" && l.table === name);
/** Gravação direta em `activities` (sem a marca de sessão: o gatilho marcaria a atividade como pendente de novo). */
const directWrites = (log: Log) => log.filter((l) => l.table === "activities" && l.op !== "select");
const ops = (calls: Call[], op: Call["op"]) => calls.filter((c) => c.op === op);

beforeEach(() => {
  resetSeq();
  loader.candidates = [];
  vi.mocked(loadCandidates).mockClear();
});

// ---- caixas da rodada ----------------------------------------------------------------------------------------

describe("runCalendarSync: caixas da rodada", () => {
  it("só as ativas, com o escopo da Agenda e com a Agenda ligada na empresa", async () => {
    const t = setup({
      accounts: [
        account(),
        account({ id: "acc-reconnect", user_id: "u-2", status: "reconnect" }),
        account({ id: "acc-readonly", user_id: "u-3", scopes: ["https://www.googleapis.com/auth/calendar.events.readonly"] }),
        account({ id: "acc-off", user_id: "u-4", company_id: "co-2" }),
        account({ id: "acc-noscopes", user_id: "u-5", scopes: null }),
      ],
    });
    const res = await t.run();
    expect(res.map((r) => r.accountId)).toEqual(["acc-1"]);
    expect(new Set(t.calls.map((c) => c.account))).toEqual(new Set(["acc-1"]));
  });

  it("empresa arquivada fica de fora", async () => {
    const t = setup({
      companies: [
        { id: "co-1", slug: "acme", archived_at: "2026-11-01T00:00:00Z", settings: { calendar_sync: { enabled: true } } },
      ],
    });
    expect(await t.run()).toEqual([]);
  });

  it("caixa segura por outra rodada (lease vigente) fica de fora e o lease dela continua", async () => {
    const until = new Date(NOW.getTime() + 60_000).toISOString();
    const t = setup({ accounts: [account({ calendar_lock_until: until })] });
    expect(await t.run()).toEqual([]);
    expect(t.calls).toEqual([]);
    expect(t.acc().calendar_lock_until).toBe(until);
  });

  it("pega o lease vencido e solta no fim", async () => {
    const t = setup({ accounts: [account({ calendar_lock_until: ago(MIN) })] });
    const res = await t.run();
    expect(res).toEqual([{ accountId: "acc-1", pushed: 0, pulled: 0, created: 0 }]);
    expect(t.acc().calendar_lock_until).toBeNull();
    const claim = t.log.find((l) => l.table === "email_accounts" && l.op === "update");
    expect(claim?.values).toEqual([{ calendar_lock_until: new Date(NOW.getTime() + 300_000).toISOString() }]);
  });

  it("erro numa caixa vai para o resultado dela e as outras seguem", async () => {
    const t = setup({
      accounts: [
        account({ id: "acc-a", created_at: "2026-01-01T00:00:00Z" }),
        account({ id: "acc-b", user_id: "u-2", calendar_sync_token: "tok-b" }),
      ],
      google: {
        "acc-a": { changes: new Error("Google fora do ar") },
        "acc-b": { changes: { events: [event({ id: "ev-x", summary: "Almoço" })], nextSyncToken: "tok-b2" } },
      },
    });
    const res = await t.run();
    expect(res).toEqual([
      { accountId: "acc-a", pushed: 0, pulled: 0, created: 0, error: "Google fora do ar" },
      { accountId: "acc-b", pushed: 0, pulled: 0, created: 1 },
    ]);
    expect(t.acc("acc-a").calendar_sync_token).toBe("tok-1");
    expect(t.acc("acc-a").calendar_lock_until).toBeNull();
    expect(t.acc("acc-b").calendar_sync_token).toBe("tok-b2");
  });

  it("sem orçamento, as caixas restantes ficam para a próxima rodada", async () => {
    let ms = NOW.getTime();
    const t = setup({
      accounts: [account({ id: "acc-a", created_at: "2026-01-01T00:00:00Z" }), account({ id: "acc-b", user_id: "u-2" })],
      clock: () => new Date((ms += 40_000)),
      budgetMs: 100_000,
    });
    const res = await t.run();
    expect(res.map((r) => r.accountId)).toEqual(["acc-a"]);
  });

  it("vendedor sem caixa: as atividades dele ficam pendentes, sem erro, e as outras caixas seguem", async () => {
    const t = setup({
      activities: [
        activity({ id: "a-sem-caixa", owner_id: "u-9", calendar_state: "pending", calendar_event_id: null, updated_at: ago(10 * MIN) }),
      ],
    });
    const res = await t.run();
    expect(res).toEqual([{ accountId: "acc-1", pushed: 0, pulled: 0, created: 0 }]);
    expect(t.act("a-sem-caixa").calendar_state).toBe("pending");
    expect(ops(t.calls, "insert")).toEqual([]);
  });

  it("token recusado (401 depois de renovar): a caixa vai para reconectar", async () => {
    const t = setup({ google: { "acc-1": { changes: new GmailAuthError("token recusado") } } });
    const res = await t.run();
    expect(res[0].error).toBe("token recusado");
    expect(t.acc()).toMatchObject({ status: "reconnect", last_error: "token recusado", calendar_sync_token: "tok-1" });
  });
});

// ---- envio das pendentes -------------------------------------------------------------------------------------

describe("runCalendarSync: envio das pendentes", () => {
  it("envia as pendentes paradas há mais de 2 min e as com erro abaixo de 3 tentativas", async () => {
    const t = setup({
      activities: [
        activity({ id: "a-velha", calendar_state: "pending", calendar_event_id: null, calendar_account_id: null, updated_at: ago(3 * MIN) }),
        activity({ id: "a-fresca", calendar_state: "pending", calendar_event_id: null, calendar_account_id: null, updated_at: ago(MIN) }),
        activity({ id: "a-erro", calendar_state: "error", calendar_attempts: 2, calendar_event_id: null, calendar_account_id: null, updated_at: ago(MIN) }),
        activity({ id: "a-esgotada", calendar_state: "error", calendar_attempts: 3, calendar_event_id: null, calendar_account_id: null }),
        activity({ id: "a-outro-dono", owner_id: "u-2", calendar_state: "pending", calendar_event_id: null, updated_at: ago(10 * MIN) }),
        activity({ id: "a-outra-empresa", company_id: "co-2", calendar_state: "pending", calendar_event_id: null, updated_at: ago(10 * MIN) }),
      ],
    });
    const res = await t.run();
    expect(res[0].pushed).toBe(2);
    const sent = ops(t.calls, "insert").map((c) => c.ev?.extendedProperties?.private?.oxynActivityId);
    expect(sent.sort()).toEqual(["a-erro", "a-velha"]);
    expect(t.act("a-velha")).toMatchObject({ calendar_state: "synced", calendar_event_id: expect.stringMatching(/^ev-new-/) });
    expect(t.act("a-fresca").calendar_state).toBe("pending");
    expect(t.act("a-esgotada").calendar_state).toBe("error");
  });

  it("a pendente da empresa de outra caixa do dono fica para a caixa dela", async () => {
    const t = setup({
      companies: [
        { id: "co-1", slug: "acme", archived_at: null, settings: { calendar_sync: { enabled: true } } },
        { id: "co-3", slug: "beta", archived_at: null, settings: { calendar_sync: { enabled: true } } },
      ],
      accounts: [
        account({ created_at: "2026-01-01T00:00:00Z" }),
        account({ id: "acc-beta", company_id: "co-3", email: "caio@beta.com", calendar_sync_token: "tok-beta" }),
      ],
      activities: [
        activity({ id: "a-beta", company_id: "co-3", calendar_state: "pending", calendar_event_id: null, calendar_account_id: null, updated_at: ago(10 * MIN) }),
      ],
    });
    await t.run();
    expect(ops(t.calls, "insert").map((c) => c.account)).toEqual(["acc-beta"]);
    expect(t.act("a-beta")).toMatchObject({ calendar_state: "synced", calendar_account_id: "acc-beta" });
  });

  it("limite de uso do Google no envio para a rodada da caixa (nem faz a passada de janela)", async () => {
    const t = setup({
      fail: { insert: new GmailRateLimitError() },
      activities: [
        activity({ id: "a-1", calendar_state: "pending", calendar_event_id: null, calendar_account_id: null, updated_at: ago(10 * MIN) }),
        activity({ id: "a-2", calendar_state: "pending", calendar_event_id: null, calendar_account_id: null, updated_at: ago(9 * MIN) }),
      ],
    });
    const res = await t.run();
    expect(ops(t.calls, "insert")).toHaveLength(1);
    expect(ops(t.calls, "listWindow")).toEqual([]);
    expect(res[0].error).toBeDefined();
    expect(t.act("a-1").calendar_state).toBe("pending");
    expect(t.act("a-2").calendar_state).toBe("pending");
    // A entrada vem antes do envio: as mudanças lidas já foram aplicadas e o token gravado.
    expect(t.acc().calendar_sync_token).toBe("tok-next");
  });
});

// ---- entrada: eventos ligados --------------------------------------------------------------------------------

describe("runCalendarSync: evento ligado a uma atividade", () => {
  const changes = (...events: CalendarEvent[]): Record<string, Script> => ({
    "acc-1": { changes: { events, nextSyncToken: "tok-2" } },
  });

  it("evento que o CRM acabou de gravar (mesmo etag) não muda a atividade", async () => {
    const t = setup({
      activities: [activity()],
      google: changes(event({ etag: '"etag-1"', summary: "Outro título", start: { dateTime: "2026-11-11T10:00:00Z" } })),
    });
    const before = structuredClone(t.act("a-1"));
    const res = await t.run();
    expect(t.act("a-1")).toEqual(before);
    expect(rpcs(t.log, "calendar_apply_inbound")).toEqual([]);
    expect(rpcs(t.log, "calendar_mark_synced")).toEqual([]);
    expect(res[0]).toMatchObject({ pulled: 0, created: 0 });
    expect(t.acc().calendar_sync_token).toBe("tok-2");
  });

  it("horário e título mudados na Agenda, Agenda mais recente: aplica com a marca de entrada", async () => {
    const t = setup({
      activities: [activity()],
      google: changes(
        event({
          summary: "  Demo remarcada  ",
          start: { dateTime: "2026-11-11T13:00:00-03:00" },
          end: { dateTime: "2026-11-11T14:00:00-03:00" },
        }),
      ),
    });
    const res = await t.run();
    expect(res[0].pulled).toBe(1);
    expect(rpcs(t.log, "calendar_apply_inbound")).toHaveLength(1);
    expect(directWrites(t.log)).toEqual([]);
    expect(t.act("a-1")).toMatchObject({
      subject: "Demo remarcada",
      due_at: "2026-11-11T16:00:00.000Z",
      duration_minutes: 60,
      calendar_etag: '"etag-2"',
      calendar_state: "synced",
    });
  });

  it("CRM mais recente: marca a atividade como pendente para reenviar, sem mudar o horário", async () => {
    const t = setup({
      activities: [activity({ updated_at: "2026-11-09T14:50:00+00:00" })],
      google: changes(event({ start: { dateTime: "2026-11-12T10:00:00Z" }, end: { dateTime: "2026-11-12T11:00:00Z" } })),
    });
    const res = await t.run();
    expect(res[0].pulled).toBe(0);
    expect(rpcs(t.log, "calendar_apply_inbound")).toEqual([]);
    expect(rpcs(t.log, "calendar_mark_synced")[0].values).toEqual({
      p_activity: "a-1",
      p_fields: { calendar_etag: '"etag-2"', calendar_state: "pending", calendar_attempts: 0, calendar_error: null },
    });
    expect(t.act("a-1").due_at).toBe("2026-11-10T17:00:00+00:00");
    expect(directWrites(t.log)).toEqual([]);
  });

  it("etag novo sem mudança de horário nem título: só grava o etag e preenche o Meet vazio, sem pendente", async () => {
    const t = setup({
      activities: [activity()],
      google: changes(event({ hangoutLink: "https://meet.google.com/abc-defg-hij" })),
    });
    const res = await t.run();
    expect(res[0].pulled).toBe(0);
    expect(rpcs(t.log, "calendar_apply_inbound").map((l) => (l.values as Row).p_patch)).toEqual([
      { calendar_etag: '"etag-2"', meet_url: "https://meet.google.com/abc-defg-hij" },
    ]);
    expect(t.act("a-1")).toMatchObject({ calendar_state: "synced", meet_url: "https://meet.google.com/abc-defg-hij" });
  });

  it("não troca o Meet já gravado", async () => {
    const t = setup({
      activities: [activity({ meet_url: "https://meet.google.com/aaa-bbbb-ccc" })],
      google: changes(event({ hangoutLink: "https://meet.google.com/abc-defg-hij" })),
    });
    await t.run();
    expect(t.act("a-1").meet_url).toBe("https://meet.google.com/aaa-bbbb-ccc");
  });

  it("atividade de 0 minutos e evento de 15 minutos: não é mudança", async () => {
    const t = setup({
      activities: [activity({ duration_minutes: 0 })],
      google: changes(event({ end: { dateTime: "2026-11-10T17:15:00Z" } })),
    });
    await t.run();
    expect(t.act("a-1").duration_minutes).toBe(0);
    expect(t.act("a-1").calendar_state).toBe("synced");
  });

  it("evento que virou de dia inteiro: mantém o horário e aplica só o título", async () => {
    const t = setup({
      activities: [activity()],
      google: changes(event({ summary: "Novo título", start: { date: "2026-11-10" }, end: { date: "2026-11-11" } })),
    });
    await t.run();
    expect(t.act("a-1")).toMatchObject({ subject: "Novo título", due_at: "2026-11-10T17:00:00+00:00", duration_minutes: 45 });
  });

  it("evento particular: o título da Agenda não entra no CRM", async () => {
    const t = setup({
      activities: [activity({ subject: "Ocupado" })],
      google: changes(event({ visibility: "private", summary: "Consulta médica", start: { dateTime: "2026-11-10T18:00:00Z" }, end: { dateTime: "2026-11-10T18:45:00Z" } })),
    });
    await t.run();
    expect(t.act("a-1")).toMatchObject({ subject: "Ocupado", due_at: "2026-11-10T18:00:00.000Z" });
  });

  it("atividade concluída: o horário e o título ficam como estão (histórico)", async () => {
    const t = setup({
      activities: [activity({ done: true, completed_at: "2026-11-09T13:00:00Z", meeting_outcome: "held" })],
      google: changes(event({ summary: "Outro", start: { dateTime: "2026-11-12T10:00:00Z" } })),
    });
    await t.run();
    expect(t.act("a-1")).toMatchObject({ subject: "Demo com a Acme", due_at: "2026-11-10T17:00:00+00:00", calendar_etag: '"etag-2"' });
  });

  it("evento órfão (gravação de volta perdida) com oxynActivityId é religado em vez de virar atividade nova", async () => {
    const t = setup({
      activities: [
        activity({ id: A_UUID, calendar_event_id: null, calendar_account_id: null, calendar_etag: null, calendar_state: "pending", updated_at: ago(10 * MIN) }),
      ],
      google: changes(event({ id: "ev-orfao", etag: '"etag-o"', extendedProperties: { private: { oxynActivityId: A_UUID } } })),
    });
    const res = await t.run();
    expect(res[0].created).toBe(0);
    expect(t.tables.activities).toHaveLength(1);
    // Religada antes do envio: o envio atualiza o evento órfão em vez de criar outro.
    expect(ops(t.calls, "insert")).toEqual([]);
    expect(ops(t.calls, "patch").map((c) => c.arg)).toEqual(["ev-orfao"]);
    expect(t.act(A_UUID)).toMatchObject({ calendar_account_id: "acc-1", calendar_event_id: "ev-orfao", calendar_state: "synced" });
  });

  it("evento de atividade apagada de vez é tratado como novo", async () => {
    const t = setup({
      google: changes(event({ id: "ev-solto", extendedProperties: { private: { oxynActivityId: "00000000-0000-4000-8000-000000000000" } } })),
    });
    const res = await t.run();
    expect(res[0].created).toBe(1);
    expect(t.tables.activities[0]).toMatchObject({ calendar_event_id: "ev-solto", source: "google_calendar" });
  });
});

// ---- entrada: eventos cancelados -----------------------------------------------------------------------------

describe("runCalendarSync: evento apagado ou cancelado na Agenda", () => {
  const cancelled = (over: Partial<CalendarEvent> = {}): Record<string, Script> => ({
    "acc-1": { changes: { events: [{ id: "ev-1", etag: '"etag-c"', status: "cancelled", ...over }], nextSyncToken: "tok-2" } },
  });

  it("reunião aberta é concluída como cancelada, com a marca de entrada", async () => {
    const t = setup({ activities: [activity()], google: cancelled() });
    const res = await t.run();
    expect(res[0].pulled).toBe(1);
    expect(directWrites(t.log)).toEqual([]);
    expect(t.act("a-1")).toMatchObject({
      done: true,
      completed_at: NOW.toISOString(),
      meeting_outcome: "canceled",
      deleted_at: null,
      calendar_event_id: null,
      calendar_state: "synced",
    });
  });

  it("tarefa vai para a lixeira", async () => {
    const t = setup({ activities: [activity({ type_id: "t-task" })], google: cancelled() });
    await t.run();
    expect(t.act("a-1")).toMatchObject({ deleted_at: NOW.toISOString(), done: false, meeting_outcome: null });
  });

  it.each([
    ["concluída", { done: true, completed_at: "2026-11-09T13:00:00Z", meeting_outcome: "held" }],
    ["na lixeira", { deleted_at: "2026-11-09T13:00:00Z" }],
  ])("atividade já %s: ignora", async (_, over) => {
    const t = setup({ activities: [activity(over)], google: cancelled() });
    const before = structuredClone(t.act("a-1"));
    const res = await t.run();
    expect(t.act("a-1")).toEqual(before);
    expect(res[0].pulled).toBe(0);
  });

  it("evento apagado pelo próprio CRM (atividade cancelada e desligada do evento) não conclui de novo", async () => {
    // O envio apagou o evento e desfez o vínculo; o Google devolve o evento cancelado, com o oxynActivityId.
    const t = setup({
      activities: [
        activity({
          id: A_UUID,
          done: true,
          completed_at: "2026-11-09T14:00:00Z",
          meeting_outcome: "canceled",
          calendar_event_id: null,
          calendar_account_id: null,
          calendar_etag: null,
        }),
        activity({ id: "a-2", subject: "Outra", calendar_event_id: "ev-2", calendar_etag: '"e2"' }),
      ],
      google: cancelled({ extendedProperties: { private: { oxynActivityId: A_UUID } } }),
    });
    const before = structuredClone(t.tables.activities);
    const res = await t.run();
    expect(t.tables.activities).toEqual(before);
    expect(res[0]).toMatchObject({ pulled: 0, created: 0 });
  });

  it("evento do dono antigo apagado na troca de dono não cancela a atividade aberta", async () => {
    const t = setup({
      activities: [activity({ id: A_UUID, owner_id: "u-2", calendar_account_id: "acc-2", calendar_event_id: "ev-novo" })],
      google: cancelled({ extendedProperties: { private: { oxynActivityId: A_UUID } } }),
    });
    await t.run();
    expect(t.act(A_UUID)).toMatchObject({ done: false, deleted_at: null, calendar_event_id: "ev-novo" });
  });

  it("evento apagado pelo envio com a atividade aberta e sem vínculo (criação na outra caixa falhou): não religa nem cancela", async () => {
    const t = setup({
      activities: [
        activity({
          id: A_UUID,
          calendar_account_id: null,
          calendar_event_id: null,
          calendar_etag: null,
          calendar_state: "error",
          calendar_attempts: 3,
        }),
      ],
      google: cancelled({ extendedProperties: { private: { oxynActivityId: A_UUID } } }),
    });
    const before = structuredClone(t.act(A_UUID));
    const res = await t.run();
    expect(t.act(A_UUID)).toEqual(before);
    expect(res[0]).toMatchObject({ pulled: 0, created: 0 });
  });

  it("cancelado desconhecido: ignora", async () => {
    const t = setup({ google: cancelled({ id: "ev-x" }) });
    const res = await t.run();
    expect(res[0]).toMatchObject({ pulled: 0, created: 0 });
    expect(t.tables.activities).toEqual([]);
  });
});

// ---- entrada: eventos novos ----------------------------------------------------------------------------------

describe("runCalendarSync: evento novo criado na Agenda", () => {
  const changes = (...events: CalendarEvent[]): Record<string, Script> => ({
    "acc-1": { changes: { events, nextSyncToken: "tok-2" } },
  });
  const candidate = (over: Partial<Candidate> = {}): Candidate => ({
    person: { id: "p-1", organizationId: "o-1" },
    deals: [],
    leads: [],
    meetingActivities: [],
    ...over,
  });

  it("reunião com convidado que é contato do CRM: tipo reunião, Videochamada, vínculo pelo casador", async () => {
    loader.candidates = [candidate({ deals: [{ id: "d-9", personId: "p-1", organizationId: "o-1", lastActivityAt: null }] })];
    const t = setup({
      google: changes(
        event({
          id: "ev-new",
          etag: '"e-n"',
          summary: "Call com a Acme",
          description: "Pauta",
          hangoutLink: "https://meet.google.com/xyz-abcd-efg",
          conferenceData: { conferenceId: "xyz-abcd-efg" },
          attendees: [
            { email: "caio@oxyn.com.br", self: true, responseStatus: "accepted" },
            { email: "Cliente@Acme.com", responseStatus: "needsAction" },
          ],
        }),
      ),
    });
    const res = await t.run();
    expect(res[0].created).toBe(1);
    expect(loadCandidates).toHaveBeenCalledWith(expect.anything(), "co-1", ["cliente@acme.com"]);
    expect(rpcs(t.log, "calendar_insert_inbound")).toHaveLength(1);
    expect(directWrites(t.log)).toEqual([]);
    expect(t.tables.activities).toEqual([
      expect.objectContaining({
        source: "google_calendar",
        company_id: "co-1",
        owner_id: "u-1",
        type_id: "t-meet",
        channel_id: "ch-video",
        subject: "Call com a Acme",
        description: "Pauta",
        due_at: "2026-11-10T17:00:00.000Z",
        duration_minutes: 45,
        deal_id: "d-9",
        lead_id: null,
        person_id: null,
        calendar_account_id: "acc-1",
        calendar_event_id: "ev-new",
        calendar_etag: '"e-n"',
        calendar_state: "synced",
        meet_url: "https://meet.google.com/xyz-abcd-efg",
      }),
    ]);
  });

  it("sem candidato: fica sem vínculo", async () => {
    const t = setup({
      google: changes(event({ id: "ev-new", attendees: [{ email: "alguem@fora.com" }] })),
    });
    await t.run();
    expect(t.tables.activities[0]).toMatchObject({ deal_id: null, lead_id: null, person_id: null, organization_id: null });
  });

  it.each([
    ["leads", "lead_id"],
    ["persons", "person_id"],
  ] as const)("vínculo com %s grava %s", async (entity, column) => {
    loader.candidates =
      entity === "leads" ? [candidate({ leads: [{ id: "l-9", personId: "p-1", organizationId: null }] })] : [candidate()];
    const t = setup({ google: changes(event({ id: "ev-new", attendees: [{ email: "cliente@acme.com" }] })) });
    await t.run();
    expect(t.tables.activities[0][column]).toBe(entity === "leads" ? "l-9" : "p-1");
  });

  it("compromisso sem convidados nem link: Tarefa, canal Não informado, sem consultar o casador", async () => {
    const t = setup({ google: changes(event({ id: "ev-new", summary: "Dentista" })) });
    await t.run();
    expect(loadCandidates).not.toHaveBeenCalled();
    expect(t.tables.activities[0]).toMatchObject({ type_id: "t-task", channel_id: "ch-legacy", subject: "Dentista" });
  });

  it("com local e sem link: Presencial", async () => {
    const t = setup({ google: changes(event({ id: "ev-new", location: "Av. Paulista, 1000" })) });
    await t.run();
    expect(t.tables.activities[0].channel_id).toBe("ch-presencial");
  });

  it("sem o canal pelo nome: usa o canal legado", async () => {
    const t = setup({
      channels: [
        { id: "ch-email", company_id: "co-1", name: "E-mail", active: true, is_legacy: false, position: 0 },
        { id: "ch-legacy", company_id: "co-1", name: "Não informado", active: false, is_legacy: true, position: 6 },
      ],
      google: changes(event({ id: "ev-new", hangoutLink: "https://meet.google.com/a" })),
    });
    await t.run();
    expect(t.tables.activities[0].channel_id).toBe("ch-legacy");
  });

  it("sem o tipo Tarefa: o primeiro tipo ativo que não é reunião", async () => {
    const t = setup({
      types: [
        { id: "t-old", company_id: "co-1", name: "Antigo", is_meeting: false, active: false, position: 0 },
        { id: "t-meet", company_id: "co-1", name: "Reunião", is_meeting: true, active: true, position: 1 },
        { id: "t-call", company_id: "co-1", name: "Ligação", is_meeting: false, active: true, position: 2 },
      ],
      google: changes(event({ id: "ev-new" })),
    });
    await t.run();
    expect(t.tables.activities[0].type_id).toBe("t-call");
  });

  it("evento particular entra como Ocupado, sem descrição", async () => {
    const t = setup({
      google: changes(event({ id: "ev-new", visibility: "private", summary: "Consulta", description: "segredo" })),
    });
    await t.run();
    expect(t.tables.activities[0]).toMatchObject({ subject: "Ocupado", description: null });
  });

  it("o que fica de fora: recusado, dia inteiro, antes do início da sincronização", async () => {
    const t = setup({
      google: changes(
        event({ id: "ev-r", attendees: [{ email: "caio@oxyn.com.br", self: true, responseStatus: "declined" }] }),
        event({ id: "ev-d", start: { date: "2026-11-10" }, end: { date: "2026-11-11" } }),
        event({ id: "ev-a", start: { dateTime: "2026-11-09T11:00:00Z" }, end: { dateTime: "2026-11-09T11:30:00Z" } }),
      ),
    });
    const res = await t.run();
    expect(res[0].created).toBe(0);
    expect(t.tables.activities).toEqual([]);
    expect(t.acc().calendar_sync_token).toBe("tok-2");
  });

  it("o mesmo evento duas vezes na rodada não cria duas atividades", async () => {
    const t = setup({ google: changes(event({ id: "ev-new" }), event({ id: "ev-new", etag: '"etag-3"' })) });
    const res = await t.run();
    expect(res[0].created).toBe(1);
    expect(t.tables.activities).toHaveLength(1);
    expect(t.tables.activities[0].calendar_etag).toBe('"etag-3"');
  });
});

// ---- passada de janela e token ---------------------------------------------------------------------------------

describe("runCalendarSync: recorrentes, token e 410", () => {
  it("passada de janela: a ocorrência recorrente desconhecida dentro dos 7 dias vira atividade", async () => {
    const recurring = (id: string, start: string, over: Partial<CalendarEvent> = {}) =>
      event({ id, recurringEventId: "rec-1", summary: "Semanal", start: { dateTime: start }, end: { dateTime: start.replace("T10", "T11") }, ...over });
    const t = setup({
      activities: [activity({ id: "a-rec", calendar_event_id: "rec-1_20261110", calendar_etag: '"r"' })],
      google: {
        "acc-1": {
          window: [
            recurring("rec-1_20261110", "2026-11-10T10:00:00Z", { etag: '"r2"' }),
            recurring("rec-1_20261113", "2026-11-13T10:00:00Z"),
            event({ id: "ev-solo", summary: "Avulso" }),
          ],
        },
      },
    });
    const res = await t.run();
    expect(res[0].created).toBe(1);
    expect(t.calls.find((c) => c.op === "listWindow")?.arg).toEqual([NOW.toISOString(), "2026-11-16T15:00:00.000Z"]);
    expect(t.tables.activities.map((a) => a.calendar_event_id)).toEqual(["rec-1_20261110", "rec-1_20261113"]);
    // A conhecida não muda pela passada de janela (as mudanças dela chegam pela leitura incremental).
    expect(t.act("a-rec").calendar_etag).toBe('"r"');
  });

  it("grava o novo token depois de aplicar as mudanças", async () => {
    const t = setup();
    await t.run();
    expect(ops(t.calls, "listChanges").map((c) => c.arg)).toEqual(["tok-1"]);
    expect(t.acc().calendar_sync_token).toBe("tok-next");
  });

  it("410: refaz pela lista a partir de agora, sem adoção, e grava o token novo", async () => {
    const t = setup({
      activities: [activity({ id: "a-solta", calendar_event_id: null, calendar_account_id: null, calendar_state: "none" })],
      google: {
        "acc-1": {
          changes: new SyncTokenExpiredError(),
          from: {
            events: [event({ id: "ev-pipedrive" }), event({ id: "ev-1", etag: '"etag-1"' })],
            nextSyncToken: "tok-novo",
          },
        },
      },
    });
    const res = await t.run();
    expect(ops(t.calls, "listFrom").map((c) => c.arg)).toEqual([NOW.toISOString()]);
    expect(res[0].error).toBeUndefined();
    // Sem adoção: o evento com o mesmo título e horário vira atividade nova.
    expect(t.act("a-solta").calendar_event_id).toBeNull();
    expect(res[0].created).toBe(2);
    expect(t.acc()).toMatchObject({ calendar_sync_token: "tok-novo", calendar_since: "2026-11-09T12:00:00.000Z" });
  });

  it("limite de uso na leitura: token mantido e erro no resultado", async () => {
    const t = setup({ google: { "acc-1": { changes: new GmailRateLimitError() } } });
    const res = await t.run();
    expect(res[0].error).toBeDefined();
    expect(t.acc().calendar_sync_token).toBe("tok-1");
  });
});

// ---- primeira rodada -----------------------------------------------------------------------------------------

describe("runCalendarSync: primeira rodada", () => {
  const first = (o: Parameters<typeof setup>[0] = {}) =>
    setup({ ...o, accounts: o.accounts ?? [account({ calendar_since: null, calendar_sync_token: null })] });
  const open = (over: Row = {}): Row =>
    activity({ calendar_event_id: null, calendar_account_id: null, calendar_etag: null, calendar_state: "none", ...over });

  it("adota o evento do Pipedrive com o mesmo início (até o minuto) e o mesmo título, sem convidar", async () => {
    const t = first({
      activities: [open({ subject: "Demo  com a ACME " })],
      google: {
        "acc-1": {
          from: {
            events: [
              event({
                id: "ev-pd",
                etag: '"pd"',
                summary: "demo com a acme",
                start: { dateTime: "2026-11-10T14:00:40-03:00" },
                hangoutLink: "https://meet.google.com/pd",
              }),
            ],
            nextSyncToken: "tok-first",
          },
        },
      },
    });
    const res = await t.run();
    expect(ops(t.calls, "insert")).toEqual([]);
    expect(ops(t.calls, "patch")).toEqual([]);
    expect(t.act("a-1")).toMatchObject({
      calendar_account_id: "acc-1",
      calendar_event_id: "ev-pd",
      calendar_etag: '"pd"',
      calendar_state: "synced",
      meet_url: "https://meet.google.com/pd",
    });
    expect(directWrites(t.log)).toEqual([]);
    // O evento adotado não vira outra atividade.
    expect(t.tables.activities).toHaveLength(1);
    expect(res[0]).toMatchObject({ pulled: 1, created: 0 });
    expect(t.acc()).toMatchObject({ calendar_since: NOW.toISOString(), calendar_sync_token: "tok-first" });
    expect(ops(t.calls, "listChanges")).toEqual([]);
  });

  it("primeira rodada sem nenhum convite: cria o que falta com sendUpdates none e sem convidados", async () => {
    const t = first({
      activities: [
        open({ id: "a-reuniao" }),
        open({ id: "a-tarefa", type_id: "t-task", subject: "Mandar proposta", due_at: "2026-11-12T12:00:00Z" }),
      ],
      google: { "acc-1": { from: { events: [event({ id: "ev-outro", summary: "Outro assunto" })], nextSyncToken: "tok-first" } } },
    });
    const res = await t.run();
    const inserts = ops(t.calls, "insert");
    expect(inserts).toHaveLength(2);
    for (const c of inserts) {
      expect(c.opts).toEqual({ sendUpdates: "none", withMeet: false });
      expect(c.ev?.attendees).toBeUndefined();
    }
    expect(t.calls.some((c) => c.opts?.sendUpdates === "all")).toBe(false);
    expect(res[0].pushed).toBe(2);
    expect(t.act("a-reuniao")).toMatchObject({ calendar_state: "synced", calendar_event_id: expect.stringMatching(/^ev-new-/) });
    // O evento não adotado segue as regras de entrada.
    expect(res[0].created).toBe(1);
    expect(t.tables.activities.find((a) => a.calendar_event_id === "ev-outro")).toMatchObject({ source: "google_calendar" });
    expect(t.acc()).toMatchObject({ calendar_since: NOW.toISOString(), calendar_sync_token: "tok-first" });
  });

  it("cada evento é adotado uma vez só", async () => {
    const t = first({
      activities: [open({ id: "a-1" }), open({ id: "a-2" })],
      google: { "acc-1": { from: { events: [event({ id: "ev-pd" })], nextSyncToken: "tok-first" } } },
    });
    await t.run();
    expect(t.act("a-1").calendar_event_id).toBe("ev-pd");
    expect(ops(t.calls, "insert").map((c) => c.ev?.extendedProperties?.private?.oxynActivityId)).toEqual(["a-2"]);
  });

  it("não adota pelo título diferente nem pelo minuto diferente", async () => {
    const t = first({
      activities: [open()],
      google: {
        "acc-1": {
          from: {
            events: [
              event({ id: "ev-titulo", summary: "Demo com a Acme 2" }),
              event({ id: "ev-hora", start: { dateTime: "2026-11-10T17:01:00Z" } }),
              event({ id: "ev-cancelado", status: "cancelled" }),
            ],
            nextSyncToken: "tok-first",
          },
        },
      },
    });
    await t.run();
    expect(t.act("a-1").calendar_event_id).toMatch(/^ev-new-/);
  });

  it("atividade passada, concluída, na lixeira ou já ligada não entra na adoção nem é criada", async () => {
    const t = first({
      activities: [
        open({ id: "a-passada", due_at: "2026-11-09T14:00:00Z" }),
        open({ id: "a-concluida", done: true, completed_at: "2026-11-09T13:00:00Z", meeting_outcome: "held" }),
        open({ id: "a-lixeira", deleted_at: "2026-11-09T13:00:00Z" }),
        activity({ id: "a-ligada", calendar_event_id: "ev-ja", calendar_etag: '"j"' }),
      ],
      google: { "acc-1": { from: { events: [event({ id: "ev-pd" })], nextSyncToken: "tok-first" } } },
    });
    await t.run();
    expect(ops(t.calls, "insert")).toEqual([]);
    expect(t.act("a-passada").calendar_event_id).toBeNull();
    expect(t.act("a-ligada").calendar_event_id).toBe("ev-ja");
  });

  it("falha ao criar algum evento: a primeira rodada não termina e recomeça na próxima", async () => {
    const t = first({
      activities: [open()],
      fail: { insert: new Error("Requisição inválida") },
    });
    const res = await t.run();
    expect(res[0].error).toBeDefined();
    expect(t.act("a-1")).toMatchObject({ calendar_state: "error", calendar_attempts: 1 });
    expect(t.acc()).toMatchObject({ calendar_since: null, calendar_sync_token: null });
  });

  it("depois de 3 tentativas a atividade fica só no Tentar de novo e a primeira rodada termina", async () => {
    const t = first({ activities: [open({ calendar_state: "error", calendar_attempts: 3 })] });
    await t.run();
    expect(ops(t.calls, "insert")).toEqual([]);
    expect(t.acc().calendar_since).toBe(NOW.toISOString());
  });

  it("pendente recém-gravada (a ação do vendedor está enviando): não envia e a primeira rodada recomeça", async () => {
    const t = first({ activities: [open({ calendar_state: "pending", updated_at: ago(MIN) })] });
    await t.run();
    expect(ops(t.calls, "insert")).toEqual([]);
    expect(t.acc().calendar_since).toBeNull();
  });

  it("adoção mantém pendente a atividade que tem mudança do CRM para enviar", async () => {
    const t = first({
      activities: [open({ calendar_state: "pending", updated_at: ago(10 * MIN) })],
      google: { "acc-1": { from: { events: [event({ id: "ev-pd" })], nextSyncToken: "tok-first" } } },
    });
    await t.run();
    expect(t.act("a-1")).toMatchObject({ calendar_event_id: "ev-pd", calendar_state: "pending" });
    expect(ops(t.calls, "insert")).toEqual([]);
  });

  it("limite de uso na criação: para sem gravar o início", async () => {
    const t = first({ activities: [open()], fail: { insert: new GmailRateLimitError() } });
    const res = await t.run();
    expect(res[0].error).toBeDefined();
    expect(t.act("a-1").calendar_state).toBe("none");
    expect(t.acc().calendar_since).toBeNull();
  });

  it("caixa desconectada e conectada de novo (linha nova): religa o evento que ficou sem caixa, sem criar outro", async () => {
    const t = first({
      activities: [activity({ id: A_UUID, calendar_account_id: null, calendar_event_id: "ev-1", calendar_etag: '"etag-1"' })],
      google: {
        "acc-1": {
          from: {
            events: [event({ etag: '"etag-1"', extendedProperties: { private: { oxynActivityId: A_UUID } } })],
            nextSyncToken: "tok-first",
          },
        },
      },
    });
    const res = await t.run();
    expect(ops(t.calls, "insert")).toEqual([]);
    expect(t.tables.activities).toHaveLength(1);
    expect(t.act(A_UUID)).toMatchObject({ calendar_account_id: "acc-1", calendar_event_id: "ev-1", calendar_state: "synced" });
    expect(res[0]).toMatchObject({ created: 0 });
    expect(t.acc().calendar_since).toBe(NOW.toISOString());
  });

  it("repetida depois de parar no meio, não duplica: o evento criado antes já é conhecido", async () => {
    const t = first({
      activities: [
        open({ id: "a-feita", calendar_event_id: "ev-new-0", calendar_account_id: "acc-1", calendar_etag: '"x"', calendar_state: "synced" }),
      ],
      google: {
        "acc-1": {
          from: { events: [event({ id: "ev-new-0", etag: '"x"', extendedProperties: { private: { oxynActivityId: "a-feita" } } })], nextSyncToken: "tok-first" },
        },
      },
    });
    const res = await t.run();
    expect(res[0]).toMatchObject({ pushed: 0, pulled: 0, created: 0 });
    expect(t.tables.activities).toHaveLength(1);
  });
});
