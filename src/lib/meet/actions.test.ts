import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const state = vi.hoisted(() => ({
  profile: { id: "u1", isSuperAdmin: false, active: true },
  /** Resposta de `can_edit_meeting` (a permissão pelo registro vinculado). */
  canEdit: true,
  db: null as unknown,
  /**
   * Cliente do USUÁRIO (`createServerClient`): o mesmo banco falso do cliente administrativo, mas outro objeto,
   * com `can_edit_meeting` e `can_edit_record` respondidos por `canEdit`.
   */
  userClient: null as unknown,
  /** O que `processMeeting` faz com a reunião (por padrão, conclui). */
  onProcess: null as ((id: string) => void) | null,
}));

vi.mock("@/lib/auth/session", () => ({ requireUser: async () => state.profile }));
vi.mock("@/lib/supabase/server", () => ({ createServerClient: async () => state.userClient }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => state.db }));
// Espiões que chamam a implementação de verdade: as gravações no CRM acontecem no banco falso.
vi.mock("./crm-sink", async () => {
  const actual = await vi.importActual<typeof import("./crm-sink")>("./crm-sink");
  return {
    ...actual,
    completeCrmMeeting: vi.fn(actual.completeCrmMeeting),
    createCrmActivity: vi.fn(actual.createCrmActivity),
    moveCrmStage: vi.fn(actual.moveCrmStage),
  };
});
vi.mock("./sink", async () => {
  const actual = await vi.importActual<typeof import("./sink")>("./sink");
  return { ...actual, pipedriveSink: vi.fn(actual.pipedriveSink), pipedriveUserFor: vi.fn(actual.pipedriveUserFor) };
});
vi.mock("@/lib/import/pipedrive/client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/import/pipedrive/client")>("@/lib/import/pipedrive/client");
  return { ...actual, createPipedriveClient: vi.fn(actual.createPipedriveClient) };
});
vi.mock("./run", async () => {
  const actual = await vi.importActual<typeof import("./run")>("./run");
  return {
    ...actual,
    defaultMeetDeps: () => ({}),
    processMeeting: vi.fn(async (_deps: unknown, id: string) => state.onProcess?.(id)),
  };
});

import { MEET_SCOPES } from "@/lib/gmail/connect";
import { createPipedriveClient } from "@/lib/import/pipedrive/client";
import { confirmSuggestion, discardMeeting, linkMeeting, retryMeeting } from "./actions";
import { completeCrmMeeting, createCrmActivity, moveCrmStage } from "./crm-sink";
import { fakeDb, resetSeq, type Row, type Tables } from "./fake-db.test-support";
import { processMeeting } from "./run";
import { pipedriveSink, pipedriveUserFor } from "./sink";
import { MIRROR_ACTIVE_ERROR } from "./sink-mode";

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
  const permission = new Set(["can_edit_meeting", "can_edit_record"]);
  state.userClient = {
    from: (table: string) => fake.db.from(table),
    rpc: (name: string, args?: Row) =>
      permission.has(name) ? Promise.resolve({ data: state.canEdit, error: null }) : fake.db.rpc(name, args),
  };
  return fake;
}

beforeEach(() => {
  resetSeq();
  state.profile = { id: "u1", isSuperAdmin: false, active: true };
  state.canEdit = true;
  state.onProcess = null;
  state.userClient = null;
  for (const fn of [processMeeting, completeCrmMeeting, createCrmActivity, moveCrmStage, pipedriveSink, pipedriveUserFor, createPipedriveClient]) {
    vi.mocked(fn).mockClear();
  }
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("retryMeeting", () => {
  it("sem transcrição guardada: volta a esperar a transcrição, zera as tentativas e não processa", async () => {
    const t = setup();
    const res = await retryMeeting(M);
    expect(res).toEqual({ ok: true, data: { message: "Vamos buscar a transcrição (ou as anotações do Gemini) de novo na próxima rodada." } });
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

// ---- sugestões confirmadas ---------------------------------------------------------------------------------------

const S = "22222222-2222-4222-8222-222222222222";
const ANCHOR = "anc1";
const DEAL_TARGET = { companyId: "co", entity: "deals", recordId: "d1" };

function suggestion(kind: string, payload: Row, over: Row = {}): Row {
  return { id: S, meeting_id: M, kind, payload, status: "pending", last_error: null, decided_by: null, decided_at: null, ...over };
}

/** Reunião concluída no negócio d1, com a âncora aberta, e o CRM com tipos, canais e etapas. Espelho desligado. */
function crmTables(over: Tables = {}): Tables {
  return tables({
    meetings: [
      meeting({ status: "done", attempts: 0, last_error: null, entity: "deals", record_id: "d1", anchor_activity_id: ANCHOR }),
    ],
    import_jobs: [{ id: "j1", source: "pipedrive", status: "done", mirror: false, finished_at: "2026-11-05T13:00:00.000Z" }],
    deals: [{ id: "d1", company_id: "co", pipeline_id: "pl1", stage_id: "st1", status: "open", deleted_at: null, expected_close_date: null }],
    organizations: [{ id: "o1", company_id: "co", name: "Acme", deleted_at: null }],
    stages: [
      { id: "st1", pipeline_id: "pl1", name: "Qualificação", archived_at: null, required_fields: [] },
      { id: "st2", pipeline_id: "pl1", name: "Proposta", archived_at: null, required_fields: [] },
      { id: "st3", pipeline_id: "pl1", name: "Contrato", archived_at: null, required_fields: ["expected_close_date"] },
    ],
    activity_types: [
      { id: "t-meet", company_id: "co", name: "Reunião", is_meeting: true, active: true, position: 0 },
      { id: "t-call", company_id: "co", name: "Ligação", is_meeting: false, active: true, position: 1 },
      { id: "t-visit", company_id: "co", name: "Visita", is_meeting: false, active: false, position: 2 },
    ],
    activity_channels: [
      { id: "ch-phone", company_id: "co", name: "Telefone", position: 0, active: true, is_legacy: false },
      { id: "ch-video", company_id: "co", name: "Videochamada", position: 1, active: true, is_legacy: false },
    ],
    activities: [
      {
        id: ANCHOR,
        company_id: "co",
        owner_id: "u1",
        type_id: "t-meet",
        channel_id: "ch-phone",
        subject: "Reunião agendada",
        due_at: "2026-11-05T14:00:00.000Z",
        duration_minutes: 30,
        done: false,
        completed_at: null,
        outcome_id: null,
        meeting_outcome: null,
        deleted_at: null,
        deal_id: "d1",
        lead_id: null,
        person_id: null,
        organization_id: null,
      },
    ],
    ...over,
  });
}

const NEXT = { type: "Ligação", subject: "Retornar com a proposta", due_date: "2026-11-10", due_time: "10:30" };

/** Modo CRM sem o token do Pipedrive e com `fetch` vigiado: qualquer chamada ao Pipedrive aparece. */
function crmMode() {
  vi.stubEnv("MEETING_SINK", "crm");
  vi.stubEnv("PIPEDRIVE_API_TOKEN", "");
  const fetchSpy = vi.fn(async () => new Response("{}", { status: 500 }));
  vi.stubGlobal("fetch", fetchSpy);
  return fetchSpy;
}

function expectNoPipedrive(fetchSpy: ReturnType<typeof vi.fn>) {
  expect(fetchSpy).not.toHaveBeenCalled();
  expect(pipedriveSink).not.toHaveBeenCalled();
  expect(pipedriveUserFor).not.toHaveBeenCalled();
  expect(createPipedriveClient).not.toHaveBeenCalled();
}

describe("confirmSuggestion no modo CRM", () => {
  it("resultado da reunião: conclui a âncora com o cliente admin e confirma a sugestão", async () => {
    const fetchSpy = crmMode();
    const t = setup(crmTables({ meeting_suggestions: [suggestion("meeting_outcome", { outcome: "Realizada" })] }));
    expect(await confirmSuggestion(S)).toEqual({ ok: true, data: undefined });
    expect(completeCrmMeeting).toHaveBeenCalledWith(state.db, DEAL_TARGET, {
      anchorActivityId: ANCHOR,
      outcomeLabel: "Realizada",
      subject: "Apresentação Acme",
      startedAt: "2026-11-05T14:00:00.000Z",
      ownerId: "u1",
      actorId: "u1",
    });
    expect(t.tables.activities[0]).toMatchObject({ id: ANCHOR, done: true, meeting_outcome: "held" });
    expect(t.tables.meetings[0].anchor_activity_id).toBe(ANCHOR);
    expect(t.tables.meeting_suggestions[0]).toMatchObject({ status: "confirmed", last_error: null, decided_by: "u1" });
    expectNoPipedrive(fetchSpy);
  });

  it("próxima atividade: cria a atividade no CRM, com o canal da âncora, e confirma", async () => {
    const fetchSpy = crmMode();
    const t = setup(crmTables({ meeting_suggestions: [suggestion("next_activity", NEXT)] }));
    expect(await confirmSuggestion(S)).toEqual({ ok: true, data: undefined });
    expect(createCrmActivity).toHaveBeenCalledWith(state.db, DEAL_TARGET, {
      type: "Ligação",
      subject: "Retornar com a proposta",
      dueDate: "2026-11-10",
      dueTime: "10:30",
      ownerId: "u1",
      actorId: "u1",
      anchorActivityId: ANCHOR,
    });
    expect(t.tables.activities).toHaveLength(2);
    expect(t.tables.activities[1]).toMatchObject({
      type_id: "t-call",
      channel_id: "ch-phone",
      deal_id: "d1",
      owner_id: "u1",
      created_by: "u1",
      done: false,
    });
    expect(t.tables.meeting_suggestions[0]).toMatchObject({ status: "confirmed" });
    expectNoPipedrive(fetchSpy);
  });

  it("conteúdo editado: grava o editado e guarda no payload", async () => {
    crmMode();
    const t = setup(crmTables({ meeting_suggestions: [suggestion("next_activity", NEXT)] }));
    const edited = { ...NEXT, subject: "Enviar contrato", due_time: null };
    expect(await confirmSuggestion(S, edited)).toMatchObject({ ok: true });
    expect(t.tables.activities[1]).toMatchObject({ subject: "Enviar contrato" });
    expect(t.tables.meeting_suggestions[0]).toMatchObject({ status: "confirmed", payload: edited });
  });

  it("etapa: move o negócio no CRM com o cliente admin e confirma", async () => {
    const fetchSpy = crmMode();
    const t = setup(crmTables({ meeting_suggestions: [suggestion("stage", { stage: "Proposta" })] }));
    expect(await confirmSuggestion(S)).toEqual({ ok: true, data: undefined });
    expect(moveCrmStage).toHaveBeenCalledWith(state.db, "d1", "Proposta");
    expect(t.tables.deals[0]).toMatchObject({ stage_id: "st2", position: 0 });
    expect(t.tables.meeting_suggestions[0]).toMatchObject({ status: "confirmed" });
    expectNoPipedrive(fetchSpy);
  });

  it("etapa com campo obrigatório faltando: a sugestão fica failed com a lista, sem mudar o negócio", async () => {
    crmMode();
    const t = setup(crmTables({ meeting_suggestions: [suggestion("stage", { stage: "Contrato" })] }));
    expect(await confirmSuggestion(S)).toEqual({
      ok: false,
      error: "Não foi possível gravar no CRM: Faltam campos para esta etapa: Data de fechamento esperada.",
    });
    expect(t.tables.deals[0].stage_id).toBe("st1");
    expect(t.tables.meeting_suggestions[0]).toMatchObject({
      status: "failed",
      last_error: "Faltam campos para esta etapa: Data de fechamento esperada.",
      decided_by: "u1",
    });
  });

  it("CrmSinkUserError (tipo que não existe mais no CRM): failed com a mensagem; confirmar de novo, editado, grava", async () => {
    crmMode();
    const t = setup(crmTables({ meeting_suggestions: [suggestion("next_activity", { ...NEXT, type: "Visita" })] }));
    expect(await confirmSuggestion(S)).toEqual({
      ok: false,
      error: 'Não foi possível gravar no CRM: O tipo "Visita" não existe no CRM.',
    });
    expect(t.tables.meeting_suggestions[0]).toMatchObject({ status: "failed", last_error: 'O tipo "Visita" não existe no CRM.' });
    expect(t.tables.activities).toHaveLength(1);

    expect(await confirmSuggestion(S, NEXT)).toMatchObject({ ok: true });
    expect(t.tables.meeting_suggestions[0]).toMatchObject({ status: "confirmed", last_error: null, payload: NEXT });
    expect(t.tables.activities).toHaveLength(2);
  });

  it("falha técnica ao gravar: a sugestão segue pendente e o vendedor pode tentar de novo", async () => {
    crmMode();
    const t = setup(crmTables({ meeting_suggestions: [suggestion("stage", { stage: "Proposta" })] }));
    vi.mocked(moveCrmStage).mockRejectedValueOnce(new Error("Falha ao ler o negócio: conexão perdida"));
    expect(await confirmSuggestion(S)).toEqual({ ok: false, error: "Não foi possível gravar no CRM. Tente novamente." });
    expect(t.tables.meeting_suggestions[0]).toMatchObject({ status: "pending", last_error: null });
  });

  it("com o espelho ativo: responde o aviso, não grava nada e a sugestão fica pendente", async () => {
    const fetchSpy = crmMode();
    const t = setup(
      crmTables({
        // A ação usa o relógio de verdade: espelho que terminou há 2 h.
        import_jobs: [
          { id: "j1", source: "pipedrive", status: "done", mirror: true, finished_at: new Date(Date.now() - 2 * 3600_000).toISOString() },
        ],
        meeting_suggestions: [suggestion("meeting_outcome", { outcome: "Realizada" })],
      }),
    );
    expect(await confirmSuggestion(S)).toEqual({ ok: false, error: MIRROR_ACTIVE_ERROR });
    expect(completeCrmMeeting).not.toHaveBeenCalled();
    expect(t.tables.activities[0]).toMatchObject({ done: false });
    expect(t.tables.meeting_suggestions[0]).toMatchObject({ status: "pending", last_error: null, decided_by: null });
    expectNoPipedrive(fetchSpy);
  });

  it("registro vinculado na lixeira: avisa e a sugestão fica pendente", async () => {
    crmMode();
    const t = setup(
      crmTables({
        deals: [{ id: "d1", company_id: "co", pipeline_id: "pl1", stage_id: "st1", status: "open", deleted_at: "2026-11-05T14:55:00.000Z" }],
        meeting_suggestions: [suggestion("meeting_outcome", { outcome: "Realizada" })],
      }),
    );
    expect(await confirmSuggestion(S)).toEqual({ ok: false, error: "O registro não existe ou está na lixeira." });
    expect(completeCrmMeeting).not.toHaveBeenCalled();
    expect(t.tables.meeting_suggestions[0]).toMatchObject({ status: "pending" });
  });

  it("reunião de outro dono, confirmada por quem edita o registro: conclui a âncora do dono e cria a próxima atividade em nome dele", async () => {
    crmMode();
    // O SDR (u1) agendou a reunião; o closer (u2), dono do negócio, confirma.
    state.profile = { id: "u2", isSuperAdmin: false, active: true };
    const t = setup(
      crmTables({
        meeting_suggestions: [
          suggestion("meeting_outcome", { outcome: "Realizada" }),
          suggestion("next_activity", NEXT, { id: "33333333-3333-4333-8333-333333333333" }),
        ],
      }),
    );
    expect(await confirmSuggestion(S)).toEqual({ ok: true, data: undefined });
    expect(await confirmSuggestion("33333333-3333-4333-8333-333333333333")).toEqual({ ok: true, data: undefined });
    expect(t.tables.activities).toHaveLength(2);
    expect(t.tables.activities[0]).toMatchObject({ id: ANCHOR, owner_id: "u1", done: true, meeting_outcome: "held" });
    expect(t.tables.activities[1]).toMatchObject({ owner_id: "u1", created_by: "u2", done: false });
    expect(t.tables.meeting_suggestions.map((s) => [s.status, s.decided_by])).toEqual([
      ["confirmed", "u2"],
      ["confirmed", "u2"],
    ]);
  });

  it("sem âncora: cria a reunião concluída, que vira a âncora; confirmar de novo (confirmação não registrada) não cria outra", async () => {
    crmMode();
    const t = setup(
      crmTables({
        meetings: [meeting({ status: "done", attempts: 0, last_error: null, entity: "deals", record_id: "d1", anchor_activity_id: null })],
        activities: [],
        meeting_suggestions: [suggestion("meeting_outcome", { outcome: "Realizada" })],
      }),
    );
    expect(await confirmSuggestion(S)).toEqual({ ok: true, data: undefined });
    expect(t.tables.activities).toHaveLength(1);
    const created = t.tables.activities[0];
    expect(created).toMatchObject({ deal_id: "d1", owner_id: "u1", created_by: "u1", done: true, meeting_outcome: "held" });
    expect(t.tables.meetings[0].anchor_activity_id).toBe(created.id);

    // A gravação aconteceu, mas a sugestão ficou pendente (o registro da confirmação falhou): repetir não duplica.
    Object.assign(t.tables.meeting_suggestions[0], { status: "pending", decided_by: null, decided_at: null });
    expect(await confirmSuggestion(S)).toEqual({ ok: true, data: undefined });
    expect(t.tables.activities).toHaveLength(1);
    expect(t.tables.meeting_suggestions[0]).toMatchObject({ status: "confirmed" });
  });

  it("âncora já concluída com outro resultado: a sugestão fica failed com o resultado gravado, sem criar outra reunião", async () => {
    crmMode();
    const t = setup(crmTables({ meeting_suggestions: [suggestion("meeting_outcome", { outcome: "Realizada" })] }));
    Object.assign(t.tables.activities[0], { done: true, completed_at: "2026-11-05T14:40:00.000Z", meeting_outcome: "no_show" });
    expect(await confirmSuggestion(S)).toEqual({
      ok: false,
      error: 'Não foi possível gravar no CRM: Esta reunião já foi concluída como "No-show".',
    });
    expect(t.tables.activities).toHaveLength(1);
    expect(t.tables.activities[0]).toMatchObject({ meeting_outcome: "no_show" });
    expect(t.tables.meeting_suggestions[0]).toMatchObject({ status: "failed", last_error: 'Esta reunião já foi concluída como "No-show".' });
  });

  it("sem permissão para editar o registro vinculado: não grava nada e a sugestão fica pendente", async () => {
    crmMode();
    const t = setup(crmTables({ meeting_suggestions: [suggestion("next_activity", NEXT)] }));
    const userClient = state.userClient as { rpc: (name: string, args?: Row) => Promise<unknown> };
    const rpc = userClient.rpc;
    userClient.rpc = (name, args) => (name === "can_edit_record" ? Promise.resolve({ data: false, error: null }) : rpc(name, args));
    expect(await confirmSuggestion(S)).toEqual({ ok: false, error: "Você não tem permissão para esta ação." });
    expect(createCrmActivity).not.toHaveBeenCalled();
    expect(t.tables.activities).toHaveLength(1);
    expect(t.tables.meeting_suggestions[0]).toMatchObject({ status: "pending", decided_by: null });
  });

  describe("reunião vinculada a uma organização", () => {
    const orgMeeting = () =>
      meeting({ status: "done", attempts: 0, last_error: null, entity: "organizations", record_id: "o1", anchor_activity_id: null });
    const ORG_TARGET = { companyId: "co", entity: "organizations", recordId: "o1" };

    it("resultado da reunião: cria a reunião concluída na organização", async () => {
      crmMode();
      const t = setup(
        crmTables({ meetings: [orgMeeting()], activities: [], meeting_suggestions: [suggestion("meeting_outcome", { outcome: "No-show" })] }),
      );
      expect(await confirmSuggestion(S)).toEqual({ ok: true, data: undefined });
      expect(completeCrmMeeting).toHaveBeenCalledWith(state.db, ORG_TARGET, expect.objectContaining({ anchorActivityId: null }));
      expect(t.tables.activities).toHaveLength(1);
      expect(t.tables.activities[0]).toMatchObject({ organization_id: "o1", type_id: "t-meet", done: true, meeting_outcome: "no_show" });
      expect(t.tables.meeting_suggestions[0]).toMatchObject({ status: "confirmed" });
    });

    it("próxima atividade: cria a atividade na organização", async () => {
      crmMode();
      const t = setup(crmTables({ meetings: [orgMeeting()], activities: [], meeting_suggestions: [suggestion("next_activity", NEXT)] }));
      expect(await confirmSuggestion(S)).toEqual({ ok: true, data: undefined });
      expect(createCrmActivity).toHaveBeenCalledWith(state.db, ORG_TARGET, expect.objectContaining({ type: "Ligação" }));
      expect(t.tables.activities[0]).toMatchObject({ organization_id: "o1", type_id: "t-call", channel_id: "ch-video" });
    });

    it("etapa: só em negócio (a sugestão fica pendente)", async () => {
      crmMode();
      const t = setup(crmTables({ meetings: [orgMeeting()], meeting_suggestions: [suggestion("stage", { stage: "Proposta" })] }));
      expect(await confirmSuggestion(S)).toEqual({ ok: false, error: "A etapa só pode ser movida em um negócio." });
      expect(moveCrmStage).not.toHaveBeenCalled();
      expect(t.tables.meeting_suggestions[0]).toMatchObject({ status: "pending" });
    });
  });
});

describe("confirmSuggestion no modo Pipedrive (padrão)", () => {
  it("sem MEETING_SINK, segue pelo Pipedrive e não toca no CRM", async () => {
    vi.stubEnv("MEETING_SINK", "");
    vi.stubEnv("PIPEDRIVE_API_TOKEN", "");
    const t = setup(crmTables({ meeting_suggestions: [suggestion("stage", { stage: "Proposta" })] }));
    expect(await confirmSuggestion(S)).toEqual({ ok: false, error: "Não foi possível consultar o Pipedrive. Tente novamente." });
    expect(moveCrmStage).not.toHaveBeenCalled();
    expect(t.tables.deals[0].stage_id).toBe("st1");
    expect(t.tables.meeting_suggestions[0]).toMatchObject({ status: "pending" });
  });
});

describe("linkMeeting", () => {
  const OLD = "33333333-3333-4333-8333-333333333333";
  const NEW = "44444444-4444-4444-8444-444444444444";

  /** Reunião concluída cujo negócio foi para a lixeira, com a anotação já gravada (no CRM e no Pipedrive). */
  function relinkTables(): Tables {
    return crmTables({
      meetings: [meeting({ status: "done", attempts: 0, last_error: null, entity: "deals", record_id: OLD })],
      deals: [
        { id: OLD, company_id: "co", pipeline_id: "pl1", stage_id: "st1", status: "open", deleted_at: "2026-11-05T14:55:00.000Z" },
        { id: NEW, company_id: "co", pipeline_id: "pl1", stage_id: "st1", status: "open", deleted_at: null },
      ],
      external_ids: [],
      notes: [{ id: "n-antiga", company_id: "co", entity: "deals", record_id: OLD, body: "<p>Resumo</p>", deleted_at: null }],
      meeting_notes: [{ meeting_id: M, summary: "s", pipedrive_note_id: 555, crm_note_id: "n-antiga", written_at: "2026-11-05T14:50:00.000Z" }],
      meeting_suggestions: [
        suggestion("stage", { stage: "Proposta" }),
        { id: "s-ok", meeting_id: M, kind: "meeting_outcome", payload: { outcome: "Realizada" }, status: "confirmed" },
      ],
    });
  }

  it("modo CRM: vincula a registro sem id no Pipedrive, manda a anotação antiga para a lixeira, solta os ids e processa", async () => {
    const fetchSpy = crmMode();
    const t = setup(relinkTables());
    let seen: Row | null = null;
    state.onProcess = () => {
      seen = { ...t.tables.meetings[0] };
      Object.assign(t.tables.meetings[0], { status: "done" });
    };
    expect(await linkMeeting(M, "deals", NEW)).toEqual({ ok: true, data: undefined });
    expect(seen).toMatchObject({ status: "processing", entity: "deals", record_id: NEW, anchor_activity_id: null });
    // As duas colunas: no modo CRM, `pipedrive_note_id` preenchido também conta como anotação gravada.
    expect(t.tables.meeting_notes[0]).toMatchObject({ crm_note_id: null, written_at: null, pipedrive_note_id: null });
    expect(t.tables.notes[0].deleted_at).toEqual(expect.any(String));
    expect(t.tables.meeting_suggestions.map((s) => s.id)).toEqual(["s-ok"]);
    expect(processMeeting).toHaveBeenCalledTimes(1);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("modo Pipedrive: registro sem id no Pipedrive não recebe a reunião (nada muda)", async () => {
    vi.stubEnv("MEETING_SINK", "pipedrive");
    const t = setup(relinkTables());
    expect(await linkMeeting(M, "deals", NEW)).toEqual({
      ok: false,
      error: "Este registro ainda não pode receber a reunião: O registro vinculado não tem id no Pipedrive.",
    });
    expect(t.tables.meetings[0]).toMatchObject({ status: "done", record_id: OLD });
    expect(t.tables.meeting_notes[0]).toMatchObject({ crm_note_id: "n-antiga", pipedrive_note_id: 555 });
    expect(t.tables.notes[0].deleted_at).toBeNull();
    expect(processMeeting).not.toHaveBeenCalled();
  });

  it("modo Pipedrive: solta só o pipedrive_note_id e não mexe nas anotações do CRM", async () => {
    vi.stubEnv("MEETING_SINK", "pipedrive");
    const t = setup({ ...relinkTables(), external_ids: [{ company_id: "co", entity: "deals", record_id: NEW, source: "pipedrive", external_id: "77" }] });
    state.onProcess = () => Object.assign(t.tables.meetings[0], { status: "done" });
    expect(await linkMeeting(M, "deals", NEW)).toEqual({ ok: true, data: undefined });
    expect(t.tables.meeting_notes[0]).toMatchObject({ pipedrive_note_id: null, crm_note_id: "n-antiga", written_at: null });
    expect(t.tables.notes[0].deleted_at).toBeNull();
  });
});
