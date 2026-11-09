import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { GmailApiError, GmailAuthError, GmailNetworkError, GmailRateLimitError } from "@/lib/gmail/client";
import { fakeDb, type Row, type Tables } from "@/lib/meet/fake-db.test-support";
import type { CalendarClient, CalendarEvent } from "./google";
import { MAX_CALENDAR_ATTEMPTS, calendarAccountFor, pushActivity, type CalendarDeps } from "./push";

// ---- Agenda falsa --------------------------------------------------------------------------------------------

type Op = "insert" | "patch" | "delete";
type Call = { account: string; op: Op; id?: string; ev?: Partial<CalendarEvent>; opts: Record<string, unknown> };

/** Cliente falso por caixa: registra cada chamada com a caixa usada. `fail` faz a operação lançar o erro. */
function fakeGoogle(
  fail: Partial<Record<Op, Error>> = {},
  replies: { insert?: Partial<CalendarEvent>; patch?: Partial<CalendarEvent> } = {},
) {
  const calls: Call[] = [];
  const clientFor = (account: string) =>
    ({
      insertEvent: async (ev: Partial<CalendarEvent>, opts: Record<string, unknown>) => {
        calls.push({ account, op: "insert", ev, opts });
        if (fail.insert) throw fail.insert;
        return { id: "ev-new", etag: '"etag-new"', hangoutLink: "https://meet.google.com/abc-defg-hij", ...replies.insert };
      },
      patchEvent: async (id: string, ev: Partial<CalendarEvent>, opts: Record<string, unknown>) => {
        calls.push({ account, op: "patch", id, ev, opts });
        if (fail.patch) throw fail.patch;
        return { id, etag: '"etag-patched"', ...replies.patch };
      },
      deleteEvent: async (id: string, opts: Record<string, unknown>) => {
        calls.push({ account, op: "delete", id, opts });
        if (fail.delete) throw fail.delete;
      },
    }) as unknown as CalendarClient;
  return { calls, clientFor };
}

// ---- dados de base -------------------------------------------------------------------------------------------

const SCOPE = "https://www.googleapis.com/auth/calendar.events";
const NOW = new Date("2026-11-09T15:00:00.000Z");

const account = (over: Row = {}): Row => ({
  id: "acc-1",
  user_id: "u-1",
  company_id: "co-1",
  email: "caio@oxyn.com.br",
  status: "active",
  scopes: ["https://www.googleapis.com/auth/gmail.readonly", SCOPE],
  created_at: "2026-11-01T00:00:00Z",
  ...over,
});

const activity = (over: Row = {}): Row => ({
  id: "a-1",
  company_id: "co-1",
  owner_id: "u-1",
  type_id: "t-meet",
  person_id: "p-1",
  deal_id: "d-1",
  lead_id: "l-1",
  organization_id: "o-1",
  subject: "Demo com a Acme",
  description: "Levar a proposta",
  due_at: "2026-11-10T17:00:00+00:00",
  duration_minutes: 45,
  done: false,
  meeting_outcome: null,
  deleted_at: null,
  updated_at: "2026-11-09T14:00:00+00:00",
  calendar_account_id: null,
  calendar_event_id: null,
  calendar_etag: null,
  calendar_state: "pending",
  calendar_error: null,
  calendar_attempts: 0,
  meet_url: null,
  ...over,
});

const PERSON: Row = {
  id: "p-1",
  deleted_at: null,
  emails: [{ value: "financeiro@acme.com", label: "trabalho" }, { value: "cliente@acme.com", primary: true }],
};

function setup(
  o: {
    activity?: Row;
    accounts?: Row[];
    persons?: Row[];
    settings?: unknown;
    fail?: Partial<Record<Op, Error>>;
    replies?: { insert?: Partial<CalendarEvent>; patch?: Partial<CalendarEvent> };
    appUrl?: string;
  } = {},
) {
  const tables: Tables = {
    companies: [
      {
        id: "co-1",
        slug: "acme",
        settings: "settings" in o ? o.settings : { calendar_sync: { enabled: true, enabled_at: "2026-11-09T12:00:00Z" } },
      },
    ],
    activity_types: [
      { id: "t-meet", is_meeting: true },
      { id: "t-task", is_meeting: false },
    ],
    persons: o.persons ?? [PERSON],
    email_accounts: o.accounts ?? [account()],
    activities: [activity(o.activity)],
  };
  const { db, log } = fakeDb(tables);
  const google = fakeGoogle(o.fail, o.replies);
  const deps: CalendarDeps = { db, clientFor: google.clientFor, now: () => NOW, appUrl: o.appUrl ?? "https://crm.oxyn.app/" };
  return { tables, log, deps, calls: google.calls, row: () => tables.activities[0] };
}

type Log = ReturnType<typeof fakeDb>["log"];
const markCalls = (log: Log) => log.filter((l) => l.op === "rpc" && l.table === "calendar_mark_synced");
/** Gravação direta em `activities` (sem a marca de sessão: o gatilho marcaria a atividade como pendente de novo). */
const directWrites = (log: Log) => log.filter((l) => l.table === "activities" && l.op !== "select");

// ---- quando não envia ----------------------------------------------------------------------------------------

describe("pushActivity: quando não envia", () => {
  it.each([
    ["sem configuração", {}],
    ["desligada", { calendar_sync: { enabled: false } }],
    ["ligada só como texto", { calendar_sync: { enabled: "true" } }],
    ["configuração nula", null],
  ])("empresa com a Agenda %s: skipped sem chamar o Google", async (_, settings) => {
    const t = setup({ settings });
    expect(await pushActivity(t.deps, "a-1")).toBe("skipped");
    expect(t.calls).toEqual([]);
    expect(markCalls(t.log)).toEqual([]);
    expect(t.row().calendar_state).toBe("pending");
  });

  it("atividade que não existe: skipped", async () => {
    const t = setup();
    expect(await pushActivity(t.deps, "outra")).toBe("skipped");
    expect(t.calls).toEqual([]);
  });

  it.each([
    ["o dono não tem caixa", []],
    ["a caixa do dono está em reconectar", [account({ status: "reconnect" })]],
    ["a caixa do dono não tem o escopo da Agenda", [account({ scopes: ["https://www.googleapis.com/auth/calendar.events.readonly"] })]],
    ["a caixa é de outra pessoa", [account({ user_id: "u-2" })]],
  ])("sem caixa (%s): skipped e a atividade continua pending", async (_, accounts) => {
    const t = setup({ accounts });
    expect(await pushActivity(t.deps, "a-1")).toBe("skipped");
    expect(t.calls).toEqual([]);
    expect(markCalls(t.log)).toEqual([]);
    expect(t.row()).toMatchObject({ calendar_state: "pending", calendar_attempts: 0, calendar_event_id: null });
  });

  it("atividade já em dia (synced) não é reenviada", async () => {
    const t = setup({ activity: { calendar_state: "synced", calendar_account_id: "acc-1", calendar_event_id: "ev-1" } });
    expect(await pushActivity(t.deps, "a-1")).toBe("skipped");
    expect(t.calls).toEqual([]);
  });
});

// ---- caixa da atividade --------------------------------------------------------------------------------------

describe("calendarAccountFor", () => {
  const pick = (accounts: Row[]) => calendarAccountFor(fakeDb({ email_accounts: accounts }).db, "u-1", "co-1");

  it("prefere a caixa do dono na empresa da atividade, mesmo havendo outra mais antiga", async () => {
    const r = await pick([
      account({ id: "acc-velha", company_id: "co-2", email: "caio@outra.com", created_at: "2026-01-01T00:00:00Z" }),
      account(),
    ]);
    expect(r).toEqual({ id: "acc-1", email: "caio@oxyn.com.br" });
  });

  it("sem caixa na empresa, usa a mais antiga do dono", async () => {
    const r = await pick([
      account({ id: "acc-b", company_id: "co-3", email: "b@x.com", created_at: "2026-06-01T00:00:00Z" }),
      account({ id: "acc-a", company_id: "co-2", email: "a@x.com", created_at: "2026-01-01T00:00:00Z" }),
      account({ id: "acc-z", user_id: "u-2", company_id: "co-1", email: "z@x.com" }),
    ]);
    expect(r).toEqual({ id: "acc-a", email: "a@x.com" });
  });

  it("caixa escolhida em reconectar ou sem escopo: null, sem passar para outra caixa", async () => {
    const other = account({ id: "acc-2", company_id: "co-2", email: "caio@outra.com", created_at: "2026-01-01T00:00:00Z" });
    expect(await pick([account({ status: "reconnect" }), other])).toBeNull();
    expect(await pick([account({ scopes: null }), other])).toBeNull();
  });

  it("sem nenhuma caixa: null", async () => {
    expect(await pick([])).toBeNull();
  });
});

// ---- criação -------------------------------------------------------------------------------------------------

describe("pushActivity: criação", () => {
  it("reunião com cliente: convida, pede o Meet e grava o evento pela função da Agenda", async () => {
    const t = setup({ activity: { calendar_state: "error", calendar_error: "falha antiga", calendar_attempts: 2 } });
    expect(await pushActivity(t.deps, "a-1")).toBe("synced");

    expect(t.calls).toHaveLength(1);
    const call = t.calls[0];
    expect(call).toMatchObject({ account: "acc-1", op: "insert", opts: { sendUpdates: "all", withMeet: true } });
    expect(call.ev).toMatchObject({
      summary: "Demo com a Acme",
      description: "Levar a proposta\n\nNo CRM: https://crm.oxyn.app/acme/negocios/d-1",
      start: { dateTime: "2026-11-10T17:00:00+00:00", timeZone: "America/Sao_Paulo" },
      end: { dateTime: "2026-11-10T17:45:00.000Z", timeZone: "America/Sao_Paulo" },
      attendees: [{ email: "cliente@acme.com" }],
      extendedProperties: { private: { oxynActivityId: "a-1" } },
    });

    expect(t.row()).toMatchObject({
      calendar_account_id: "acc-1",
      calendar_event_id: "ev-new",
      calendar_etag: '"etag-new"',
      meet_url: "https://meet.google.com/abc-defg-hij",
      calendar_state: "synced",
      calendar_error: null,
      calendar_attempts: 0,
    });
    // Gravado pela função com a marca de sessão (oxyn.calendar_inbound), nunca por update direto.
    expect(markCalls(t.log)).toHaveLength(1);
    expect(markCalls(t.log)[0].values).toMatchObject({ p_activity: "a-1" });
    expect(directWrites(t.log)).toEqual([]);
  });

  it("com invite false (primeira rodada): cria sem convidado, sem Meet e sem avisar ninguém", async () => {
    const t = setup({ replies: { insert: { hangoutLink: undefined } } });
    expect(await pushActivity(t.deps, "a-1", { invite: false })).toBe("synced");
    expect(t.calls[0].opts).toEqual({ sendUpdates: "none", withMeet: false });
    expect(t.calls[0].ev?.attendees).toBeUndefined();
    expect(t.row()).toMatchObject({ calendar_event_id: "ev-new", meet_url: null, calendar_state: "synced" });
  });

  it("tarefa: sem convite e sem Meet", async () => {
    const t = setup({ activity: { type_id: "t-task" }, replies: { insert: { hangoutLink: undefined } } });
    expect(await pushActivity(t.deps, "a-1")).toBe("synced");
    expect(t.calls[0].opts).toEqual({ sendUpdates: "none", withMeet: false });
    expect(t.calls[0].ev?.attendees).toBeUndefined();
  });

  it("reunião que já terminou não convida o cliente (registro de reunião passada)", async () => {
    const t = setup({ activity: { due_at: "2026-11-09T14:00:00+00:00", duration_minutes: 45 } });
    expect(await pushActivity(t.deps, "a-1")).toBe("synced");
    expect(t.calls[0].opts).toEqual({ sendUpdates: "none", withMeet: false });
    expect(t.calls[0].ev?.attendees).toBeUndefined();
  });

  it("reunião em andamento ainda convida", async () => {
    const t = setup({ activity: { due_at: "2026-11-09T14:30:00+00:00", duration_minutes: 45 } });
    await pushActivity(t.deps, "a-1");
    expect(t.calls[0].opts).toEqual({ sendUpdates: "all", withMeet: true });
  });

  it.each([
    ["o marcado como principal", [{ value: "outro@acme.com" }, { value: "Cliente@Acme.com ", primary: true }], "Cliente@Acme.com"],
    ["sem principal, o primeiro", [{ value: "primeiro@acme.com" }, { value: "segundo@acme.com" }], "primeiro@acme.com"],
  ])("e-mail convidado: %s", async (_, emails, expected) => {
    const t = setup({ persons: [{ id: "p-1", deleted_at: null, emails }] });
    await pushActivity(t.deps, "a-1");
    expect(t.calls[0].ev?.attendees).toEqual([{ email: expected }]);
  });

  it.each([
    ["pessoa sem e-mail", [{ id: "p-1", deleted_at: null, emails: [] }]],
    ["pessoa na lixeira", [{ ...PERSON, deleted_at: "2026-11-08T00:00:00Z" }]],
  ])("%s: reunião criada sem convite", async (_, persons) => {
    const t = setup({ persons });
    await pushActivity(t.deps, "a-1");
    expect(t.calls[0].opts).toEqual({ sendUpdates: "none", withMeet: false });
  });

  it.each([
    ["negócio", {}, "https://crm.oxyn.app/acme/negocios/d-1"],
    ["lead", { deal_id: null }, "https://crm.oxyn.app/acme/leads/l-1"],
    ["pessoa", { deal_id: null, lead_id: null }, "https://crm.oxyn.app/acme/contatos/pessoas/p-1"],
    ["organização", { deal_id: null, lead_id: null, person_id: null }, "https://crm.oxyn.app/acme/contatos/organizacoes/o-1"],
  ])("link do registro pelo vínculo de maior precedência: %s", async (_, over, url) => {
    const t = setup({ activity: over });
    await pushActivity(t.deps, "a-1");
    expect(t.calls[0].ev?.description).toBe(`Levar a proposta\n\nNo CRM: ${url}`);
  });

  it("sem vínculo (evento vindo da Agenda) ou sem URL do app: descrição sem link", async () => {
    const solta = setup({ activity: { deal_id: null, lead_id: null, person_id: null, organization_id: null } });
    await pushActivity(solta.deps, "a-1");
    expect(solta.calls[0].ev?.description).toBe("Levar a proposta");

    const semUrl = setup({ appUrl: "" });
    await pushActivity(semUrl.deps, "a-1");
    expect(semUrl.calls[0].ev?.description).toBe("Levar a proposta");
  });
});

// ---- dono trocado --------------------------------------------------------------------------------------------

describe("pushActivity: dono trocado", () => {
  const OLD = account({ id: "acc-velha", user_id: "u-0", email: "antigo@oxyn.com.br" });

  it("apaga o evento na caixa antiga (avisando o cliente) e cria na nova", async () => {
    const t = setup({
      accounts: [OLD, account()],
      activity: { calendar_account_id: "acc-velha", calendar_event_id: "ev-velho", calendar_etag: '"e0"', meet_url: "https://meet.google.com/velho" },
    });
    expect(await pushActivity(t.deps, "a-1")).toBe("synced");
    expect(t.calls.map((c) => [c.account, c.op, c.id ?? null, c.opts.sendUpdates])).toEqual([
      ["acc-velha", "delete", "ev-velho", "all"],
      ["acc-1", "insert", null, "all"],
    ]);
    expect(t.row()).toMatchObject({
      calendar_account_id: "acc-1",
      calendar_event_id: "ev-new",
      calendar_etag: '"etag-new"',
      meet_url: "https://meet.google.com/abc-defg-hij",
      calendar_state: "synced",
    });
  });

  it("caixa antiga desconectada (sem caixa ou sem a linha): só cria na nova", async () => {
    for (const calendar_account_id of [null, "acc-apagada"]) {
      const t = setup({ activity: { calendar_account_id, calendar_event_id: "ev-velho" } });
      expect(await pushActivity(t.deps, "a-1")).toBe("synced");
      expect(t.calls.map((c) => [c.account, c.op])).toEqual([["acc-1", "insert"]]);
      expect(t.row()).toMatchObject({ calendar_account_id: "acc-1", calendar_event_id: "ev-new" });
    }
  });

  it("criação falhou depois de apagar na caixa antiga: o vínculo com o evento apagado já foi desfeito", async () => {
    const t = setup({
      accounts: [OLD, account()],
      activity: { calendar_account_id: "acc-velha", calendar_event_id: "ev-velho", meet_url: "https://meet.google.com/velho" },
      fail: { insert: new GmailApiError(400, "Bad Request") },
    });
    expect(await pushActivity(t.deps, "a-1")).toBe("error");
    expect(t.row()).toMatchObject({
      calendar_account_id: null,
      calendar_event_id: null,
      meet_url: null,
      calendar_state: "error",
      calendar_attempts: 1,
    });

    const limit = setup({
      accounts: [OLD, account()],
      activity: { calendar_account_id: "acc-velha", calendar_event_id: "ev-velho" },
      fail: { insert: new GmailRateLimitError() },
    });
    expect(await pushActivity(limit.deps, "a-1")).toBe("deferred");
    expect(limit.row()).toMatchObject({ calendar_event_id: null, calendar_state: "pending", calendar_attempts: 0 });
  });

  it("erro do banco ao desfazer o vínculo sobe para quem chamou, sem virar erro da Agenda", async () => {
    const t = setup({ accounts: [OLD, account()], activity: { calendar_account_id: "acc-velha", calendar_event_id: "ev-velho" } });
    // Só a primeira gravação falha: um erro do banco tratado como erro do Google gravaria `error` na segunda.
    let failed = false;
    const rpc = t.deps.db.rpc.bind(t.deps.db);
    const db = {
      ...t.deps.db,
      rpc: (...args: Parameters<typeof rpc>) =>
        failed ? rpc(...args) : ((failed = true), Promise.resolve({ data: null, error: { message: "conexão perdida" } })),
    };
    const deps = { ...t.deps, db: db as unknown as CalendarDeps["db"] };
    await expect(pushActivity(deps, "a-1")).rejects.toThrow("conexão perdida");
    expect(t.calls.map((c) => c.op)).toEqual(["delete"]);
    expect(t.row()).toMatchObject({ calendar_state: "pending", calendar_attempts: 0, calendar_error: null });
  });

  it("token inválido na caixa antiga: a caixa antiga vai para reconectar e a atividade fica pendente", async () => {
    const t = setup({
      accounts: [OLD, account()],
      activity: { calendar_account_id: "acc-velha", calendar_event_id: "ev-velho" },
      fail: { delete: new GmailAuthError("O Google recusou o token renovado") },
    });
    expect(await pushActivity(t.deps, "a-1")).toBe("deferred");
    expect(t.calls.map((c) => c.op)).toEqual(["delete"]);
    const status = Object.fromEntries(t.tables.email_accounts.map((a) => [a.id, a.status]));
    expect(status).toEqual({ "acc-velha": "reconnect", "acc-1": "active" });
    expect(t.row()).toMatchObject({ calendar_state: "pending", calendar_event_id: "ev-velho" });
  });
});

// ---- atualização ---------------------------------------------------------------------------------------------

describe("pushActivity: atualização", () => {
  const linked = { calendar_account_id: "acc-1", calendar_event_id: "ev-1", calendar_etag: '"e0"', meet_url: "https://meet.google.com/abc" };

  it("reunião com cliente: patch com os campos da atividade e aviso aos convidados", async () => {
    const t = setup({ activity: { ...linked, subject: "Demo remarcada", due_at: "2026-11-11T13:00:00+00:00" } });
    expect(await pushActivity(t.deps, "a-1")).toBe("synced");
    expect(t.calls).toHaveLength(1);
    expect(t.calls[0]).toMatchObject({ account: "acc-1", op: "patch", id: "ev-1", opts: { sendUpdates: "all" } });
    expect(t.calls[0].ev).toMatchObject({
      summary: "Demo remarcada",
      description: "Levar a proposta\n\nNo CRM: https://crm.oxyn.app/acme/negocios/d-1",
      start: { dateTime: "2026-11-11T13:00:00+00:00" },
      end: { dateTime: "2026-11-11T13:45:00.000Z" },
      extendedProperties: { private: { oxynActivityId: "a-1" } },
    });
    // Convidados e Meet só na criação: o patch não leva as chaves, e o Google mantém os do evento.
    expect(t.calls[0].ev).not.toHaveProperty("attendees");
    expect(t.calls[0].ev).not.toHaveProperty("conferenceData");
    // O link do Meet que o Google não devolveu no patch continua o mesmo.
    expect(t.row()).toMatchObject({
      calendar_account_id: "acc-1",
      calendar_event_id: "ev-1",
      calendar_etag: '"etag-patched"',
      meet_url: "https://meet.google.com/abc",
      calendar_state: "synced",
      calendar_attempts: 0,
    });
    expect(directWrites(t.log)).toEqual([]);
  });

  it("reunião criada sem convite (primeira rodada): a edição no CRM não convida o cliente", async () => {
    const t = setup({ activity: { ...linked, meet_url: null, subject: "Demo (nova pauta)" } });
    expect(await pushActivity(t.deps, "a-1")).toBe("synced");
    expect(t.calls.map((c) => c.op)).toEqual(["patch"]);
    expect(t.calls[0].ev).not.toHaveProperty("attendees");
    expect(t.calls[0].ev).not.toHaveProperty("conferenceData");
    expect(t.row().meet_url).toBeNull();
  });

  it.each([
    ["tarefa", { type_id: "t-task" }, undefined],
    ["invite false", {}, { invite: false }],
    ["reunião que já terminou", { due_at: "2026-11-09T14:00:00+00:00", duration_minutes: 45 }, undefined],
    ["pessoa sem e-mail", { person_id: null }, undefined],
  ])("%s: patch sem convidados e sem aviso", async (_, over, opts) => {
    const t = setup({ activity: { ...linked, ...over } });
    await pushActivity(t.deps, "a-1", opts);
    expect(t.calls[0]).toMatchObject({ op: "patch", opts: { sendUpdates: "none" } });
    expect(t.calls[0].ev).not.toHaveProperty("attendees");
  });

  it.each([404, 410])("evento apagado de vez no Google (%i): cria de novo na mesma caixa", async (status) => {
    const t = setup({ activity: linked, fail: { patch: new GmailApiError(status, "Not Found") } });
    expect(await pushActivity(t.deps, "a-1")).toBe("synced");
    expect(t.calls.map((c) => [c.account, c.op])).toEqual([
      ["acc-1", "patch"],
      ["acc-1", "insert"],
    ]);
    // Recriar é criar: o patch não leva convidados, a criação leva.
    expect(t.calls[0].ev).not.toHaveProperty("attendees");
    expect(t.calls[1].opts).toEqual({ sendUpdates: "all", withMeet: true });
    expect(t.calls[1].ev?.attendees).toEqual([{ email: "cliente@acme.com" }]);
    expect(t.row()).toMatchObject({ calendar_event_id: "ev-new", calendar_etag: '"etag-new"', calendar_state: "synced" });
  });

  it("o link do Meet devolvido no patch é gravado", async () => {
    const t = setup({ activity: linked, replies: { patch: { hangoutLink: "https://meet.google.com/novo" } } });
    await pushActivity(t.deps, "a-1");
    expect(t.row().meet_url).toBe("https://meet.google.com/novo");
  });
});

// ---- apagar --------------------------------------------------------------------------------------------------

describe("pushActivity: apagar", () => {
  const linked = { calendar_account_id: "acc-1", calendar_event_id: "ev-1", calendar_etag: '"e0"', meet_url: "https://meet.google.com/abc" };
  const cleared = {
    calendar_account_id: null,
    calendar_event_id: null,
    calendar_etag: null,
    meet_url: null,
    calendar_state: "synced",
    calendar_error: null,
    calendar_attempts: 0,
  };

  it.each([
    ["na lixeira", { deleted_at: "2026-11-09T14:59:00Z" }],
    ["reunião concluída como cancelada", { done: true, meeting_outcome: "canceled" }],
  ])("%s: apaga o evento avisando o cliente e limpa o vínculo", async (_, over) => {
    const t = setup({ activity: { ...linked, ...over } });
    expect(await pushActivity(t.deps, "a-1")).toBe("synced");
    expect(t.calls).toEqual([{ account: "acc-1", op: "delete", id: "ev-1", opts: { sendUpdates: "all" } }]);
    expect(t.row()).toMatchObject(cleared);
    expect(directWrites(t.log)).toEqual([]);
  });

  it("tarefa na lixeira: apaga sem avisar ninguém", async () => {
    const t = setup({ activity: { ...linked, type_id: "t-task", deleted_at: "2026-11-09T14:59:00Z" } });
    await pushActivity(t.deps, "a-1");
    expect(t.calls[0].opts).toEqual({ sendUpdates: "none" });
  });

  it("reunião passada na lixeira: apaga sem mandar cancelamento ao cliente", async () => {
    const t = setup({ activity: { ...linked, due_at: "2026-11-02T13:00:00+00:00", deleted_at: "2026-11-09T14:59:00Z" } });
    await pushActivity(t.deps, "a-1");
    expect(t.calls[0].opts).toEqual({ sendUpdates: "none" });
  });

  it("apaga na caixa do evento, mesmo que o dono tenha mudado", async () => {
    const t = setup({
      accounts: [account({ id: "acc-velha", user_id: "u-0", email: "antigo@oxyn.com.br" }), account()],
      activity: { ...linked, calendar_account_id: "acc-velha", deleted_at: "2026-11-09T14:59:00Z" },
    });
    await pushActivity(t.deps, "a-1");
    expect(t.calls.map((c) => [c.account, c.op])).toEqual([["acc-velha", "delete"]]);
  });

  it("evento numa caixa desconectada: só limpa o vínculo", async () => {
    const t = setup({ accounts: [], activity: { ...linked, deleted_at: "2026-11-09T14:59:00Z" } });
    expect(await pushActivity(t.deps, "a-1")).toBe("synced");
    expect(t.calls).toEqual([]);
    expect(t.row()).toMatchObject(cleared);
  });

  it("na lixeira sem evento: nada na Agenda, sai da fila", async () => {
    const t = setup({ activity: { deleted_at: "2026-11-09T14:59:00Z" } });
    expect(await pushActivity(t.deps, "a-1")).toBe("synced");
    expect(t.calls).toEqual([]);
    expect(t.row()).toMatchObject({ calendar_state: "synced", calendar_event_id: null });
  });

  it("concluída (realizada): o evento fica como histórico e a atividade sai da fila", async () => {
    const t = setup({ activity: { ...linked, done: true, meeting_outcome: "held" } });
    expect(await pushActivity(t.deps, "a-1")).toBe("synced");
    expect(t.calls).toEqual([]);
    expect(t.row()).toMatchObject({ calendar_state: "synced", calendar_event_id: "ev-1", meet_url: "https://meet.google.com/abc" });
  });
});

// ---- erros do Google -----------------------------------------------------------------------------------------

describe("pushActivity: erro do Google", () => {
  it("erro do Google: grava error com a mensagem e conta a tentativa", async () => {
    const t = setup({ activity: { calendar_state: "error", calendar_attempts: 1 }, fail: { insert: new GmailApiError(400, "Invalid start time") } });
    expect(await pushActivity(t.deps, "a-1")).toBe("error");
    expect(t.row()).toMatchObject({
      calendar_state: "error",
      calendar_error: "Invalid start time",
      calendar_attempts: 2,
      calendar_event_id: null,
    });
    expect(markCalls(t.log)).toHaveLength(1);
    expect(directWrites(t.log)).toEqual([]);
  });

  it("erro no patch também conta a tentativa e mantém o evento", async () => {
    const t = setup({
      activity: { calendar_account_id: "acc-1", calendar_event_id: "ev-1" },
      fail: { patch: new GmailApiError(403, "Forbidden") },
    });
    expect(await pushActivity(t.deps, "a-1")).toBe("error");
    expect(t.row()).toMatchObject({ calendar_state: "error", calendar_error: "Forbidden", calendar_attempts: 1, calendar_event_id: "ev-1" });
  });

  it.each([
    ["limite de uso", new GmailRateLimitError()],
    ["falha de rede", new GmailNetworkError()],
  ])("%s: não conta tentativa e fica pending", async (_, err) => {
    const t = setup({ activity: { calendar_attempts: 1 }, fail: { insert: err } });
    expect(await pushActivity(t.deps, "a-1")).toBe("deferred");
    expect(t.row()).toMatchObject({ calendar_state: "pending", calendar_attempts: 1, calendar_error: null });
    expect(markCalls(t.log)).toEqual([]);
  });

  it("token inválido depois de renovar: fica pending, sem contar tentativa, e a caixa vai para reconectar", async () => {
    const t = setup({ activity: { calendar_attempts: 1 }, fail: { insert: new GmailAuthError("O Google recusou o token renovado") } });
    expect(await pushActivity(t.deps, "a-1")).toBe("deferred");
    expect(t.row()).toMatchObject({ calendar_state: "pending", calendar_attempts: 1 });
    expect(t.tables.email_accounts[0]).toMatchObject({ status: "reconnect", last_error: "O Google recusou o token renovado" });
  });

  it("três tentativas antes de ficar só no Tentar de novo", () => {
    expect(MAX_CALENDAR_ATTEMPTS).toBe(3);
  });
});

// ---- sem eco -------------------------------------------------------------------------------------------------

describe("pushActivity: sem eco", () => {
  it("o etag devolvido pelo Google é gravado, para a entrada reconhecer o próprio evento", async () => {
    const t = setup({ replies: { insert: { etag: '"3418123456789000"' } } });
    await pushActivity(t.deps, "a-1");
    expect(t.row().calendar_etag).toBe('"3418123456789000"');
    expect(markCalls(t.log)[0].values).toMatchObject({
      p_activity: "a-1",
      p_fields: { calendar_etag: '"3418123456789000"', calendar_state: "synced" },
    });
  });
});
