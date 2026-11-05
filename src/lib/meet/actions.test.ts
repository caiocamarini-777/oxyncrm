import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const state = vi.hoisted(() => ({
  profile: { id: "u1", isSuperAdmin: false, active: true },
  /** Resposta de `can_edit_meeting` (a permissão pelo registro vinculado). */
  canEdit: true,
  db: null as unknown,
  /** O que `processMeeting` faz com a reunião (por padrão, conclui). */
  onProcess: null as ((id: string) => void) | null,
}));

vi.mock("@/lib/auth/session", () => ({ requireUser: async () => state.profile }));
vi.mock("@/lib/supabase/server", () => ({
  createServerClient: async () => ({ rpc: async () => ({ data: state.canEdit, error: null }) }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => state.db }));
vi.mock("./run", async () => {
  const actual = await vi.importActual<typeof import("./run")>("./run");
  return {
    ...actual,
    defaultMeetDeps: () => ({}),
    processMeeting: vi.fn(async (_deps: unknown, id: string) => state.onProcess?.(id)),
  };
});

import { MEET_SCOPES } from "@/lib/gmail/connect";
import { discardMeeting, retryMeeting } from "./actions";
import { fakeDb, resetSeq, type Row, type Tables } from "./fake-db.test-support";
import { processMeeting } from "./run";

const M = "11111111-1111-4111-8111-111111111111";
const NOW = new Date("2026-11-05T15:00:00.000Z");

function meeting(over: Row = {}): Row {
  return {
    id: M,
    company_id: "co",
    account_id: "acc1",
    owner_id: "u1",
    conference_record: "conferenceRecords/r1",
    title: "Apresentação Acme",
    started_at: "2026-11-05T14:00:00.000Z",
    ended_at: "2026-11-05T14:45:00.000Z",
    attendees: [],
    status: "failed",
    attempts: 3,
    last_error: "Não foi possível ler a reunião no Google: API desativada",
    entity: null,
    record_id: null,
    anchor_activity_id: null,
    updated_at: "2026-11-05T14:50:00.000Z",
    ...over,
  };
}

function tables(over: Tables = {}): Tables {
  return {
    companies: [{ id: "co", archived_at: null, settings: { meeting_assistant: { enabled: true } } }],
    email_accounts: [{ id: "acc1", user_id: "u1", company_id: "co", status: "active", scopes: [...MEET_SCOPES] }],
    meetings: [meeting()],
    meeting_transcripts: [],
    meeting_notes: [],
    meeting_suggestions: [],
    notifications: [],
    ...over,
  };
}

function setup(t: Tables = tables()) {
  const fake = fakeDb(t, () => NOW);
  state.db = fake.db;
  return fake;
}

beforeEach(() => {
  resetSeq();
  state.profile = { id: "u1", isSuperAdmin: false, active: true };
  state.canEdit = true;
  state.onProcess = null;
  vi.mocked(processMeeting).mockClear();
});

describe("retryMeeting", () => {
  it("sem transcrição guardada: volta a esperar a transcrição, zera as tentativas e não processa", async () => {
    const t = setup();
    const res = await retryMeeting(M);
    expect(res).toEqual({ ok: true, data: { message: "Vamos buscar a transcrição de novo na próxima rodada." } });
    expect(t.tables.meetings[0]).toMatchObject({ status: "waiting_transcript", attempts: 0, last_error: null });
    expect(processMeeting).not.toHaveBeenCalled();
  });

  it("sem transcrição e com a caixa que trouxe a reunião desconectada ou sem os acessos do Meet: avisa e não muda nada", async () => {
    for (const accounts of [
      [],
      [{ id: "acc1", user_id: "u1", company_id: "co", status: "reconnect", scopes: [...MEET_SCOPES] }],
      [{ id: "acc1", user_id: "u1", company_id: "co", status: "active", scopes: [] }],
    ]) {
      const t = setup(tables({ email_accounts: accounts }));
      const res = await retryMeeting(M);
      expect(res.ok).toBe(false);
      expect(!res.ok && res.error).toBe(
        "A caixa do Google que trouxe esta reunião está desconectada ou sem acesso ao Meet. Reconecte-a no módulo E-mail e tente de novo.",
      );
      expect(t.tables.meetings[0]).toMatchObject({ status: "failed", attempts: 3 });
    }
  });

  it("sem transcrição e com o assistente desligado na empresa: avisa e não muda nada", async () => {
    const t = setup(tables({ companies: [{ id: "co", archived_at: null, settings: {} }] }));
    const res = await retryMeeting(M);
    expect(res).toEqual({ ok: false, error: "O assistente de reuniões está desligado nesta empresa." });
    expect(t.tables.meetings[0]).toMatchObject({ status: "failed" });
  });

  it("com transcrição: reivindica (processing, tentativas zeradas) e processa na hora", async () => {
    const t = setup(
      tables({
        meetings: [meeting({ attendees: [{ email: "cliente@acme.com", name: "Cliente", internal: false }], last_error: "Pipedrive fora do ar" })],
        meeting_transcripts: [{ meeting_id: M, entries: [], text: "Cliente: oi" }],
      }),
    );
    let seen: Row | null = null;
    state.onProcess = () => {
      seen = { ...t.tables.meetings[0] };
      Object.assign(t.tables.meetings[0], { status: "done", last_error: null });
    };
    const res = await retryMeeting(M);
    expect(res).toEqual({ ok: true, data: { message: "Reunião processada." } });
    expect(seen).toMatchObject({ status: "processing", attempts: 0, last_error: null });
    expect(processMeeting).toHaveBeenCalledTimes(1);
  });
});

describe("dono ou admin geral (descartar e tentar de novo)", () => {
  it("quem edita o registro mas não é o dono não descarta nem tenta de novo", async () => {
    state.profile = { id: "gestor", isSuperAdmin: false, active: true };
    const t = setup(tables({ meetings: [meeting({ entity: "deals", record_id: "d1" })] }));
    const denied = { ok: false, error: "Você não tem permissão para esta ação." };
    expect(await discardMeeting(M)).toEqual(denied);
    expect(await retryMeeting(M)).toEqual(denied);
    expect(t.tables.meetings[0]).toMatchObject({ status: "failed", attempts: 3 });
  });

  it("o admin geral pode, mesmo sem ser o dono", async () => {
    state.profile = { id: "admin", isSuperAdmin: true, active: true };
    const t = setup();
    expect(await retryMeeting(M)).toMatchObject({ ok: true });
    expect(t.tables.meetings[0].status).toBe("waiting_transcript");
    expect(await discardMeeting(M)).toMatchObject({ ok: false }); // waiting_transcript não se descarta
  });

  it("sem can_edit_meeting, nem o dono passa", async () => {
    state.canEdit = false;
    setup();
    expect(await retryMeeting(M)).toEqual({ ok: false, error: "Você não tem permissão para esta ação." });
  });
});

describe("discardMeeting", () => {
  it("apaga transcrição, notas e sugestões e vira ignored", async () => {
    const t = setup(
      tables({
        meetings: [meeting({ status: "unlinked", attempts: 0, last_error: null })],
        meeting_transcripts: [{ meeting_id: M, entries: [], text: "x" }],
        meeting_notes: [{ meeting_id: M, summary: "s" }],
        meeting_suggestions: [{ id: "s1", meeting_id: M, kind: "stage", status: "pending" }],
      }),
    );
    expect(await discardMeeting(M)).toEqual({ ok: true, data: undefined });
    expect(t.tables.meetings[0].status).toBe("ignored");
    expect(t.tables.meeting_transcripts).toHaveLength(0);
    expect(t.tables.meeting_notes).toHaveLength(0);
    expect(t.tables.meeting_suggestions).toHaveLength(0);
  });

  it("marca como lido o aviso de reunião sem vínculo", async () => {
    const t = setup(
      tables({
        meetings: [meeting({ status: "unlinked", attempts: 0, last_error: null })],
        notifications: [
          { id: 1, user_id: "u1", kind: "meeting_unlinked", meeting_id: M, read_at: null },
          { id: 2, user_id: "u1", kind: "activity_reminder", meeting_id: null, read_at: null },
        ],
      }),
    );
    expect(await discardMeeting(M)).toMatchObject({ ok: true });
    expect(Number.isNaN(Date.parse(t.tables.notifications[0].read_at as string))).toBe(false);
    expect(t.tables.notifications[1].read_at).toBeNull();
  });
});
