import { describe, expect, it, vi } from "vitest";
import { PipedriveAuthError, PipedriveError } from "@/lib/import/pipedrive/client";
import type { PushCtx, PushEntity } from "./mapping";
import { CURSOR_OVERLAP_MS, MAX_ATTEMPTS, runPipedrivePush } from "./run";
import { PUSH_ORDER, type PushStore } from "./store";

vi.mock("server-only", () => ({}));

const C1 = "11111111-1111-4111-8111-111111111111";
const C2 = "22222222-2222-4222-8222-222222222222";
const STAGE = "0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f";
const PD_STAGE = 50;

const CURSOR = "2026-11-09T12:00:00.000Z";
/** Início da primeira rodada; o relógio só anda nas chamadas ao Pipedrive. */
const START = Date.parse("2026-11-09T14:00:00.000Z");
const HOUR = 3600_000;
const at = (hhmm: string) => `2026-11-09T${hhmm}:00.000Z`;
/** Cursor de uma rodada concluída que começou em START: o início menos a sobreposição de 2 min. */
const START_CURSOR = new Date(START - CURSOR_OVERLAP_MS).toISOString();

type Row = Record<string, unknown> & { id: string; company_id: string; updated_at: string; deleted_at: string | null };
type Call = { method: "post" | "put" | "patch" | "del"; path: string; body?: Record<string, unknown> };
type Finished = Parameters<PushStore["finishRun"]>[1];

const base = (id: string, over: Partial<Row>) => ({
  id,
  company_id: C1,
  updated_at: at("13:00"),
  deleted_at: null,
  owner_id: null,
  ...over,
});
const org = (id: string, over: Partial<Row> = {}): Row => base(id, { name: `Org ${id}`, ...over });
const person = (id: string, orgId: string | null, over: Partial<Row> = {}): Row =>
  base(id, { full_name: `Pessoa ${id}`, organization_id: orgId, emails: [], phones: [], ...over });
const lead = (id: string, personId: string, over: Partial<Row> = {}): Row =>
  base(id, { title: `Lead ${id}`, person_id: personId, organization_id: null, status: "open", ...over });
const deal = (id: string, personId: string | null, over: Partial<Row> = {}): Row =>
  base(id, {
    title: `Negócio ${id}`,
    stage_id: STAGE,
    status: "open",
    person_id: personId,
    organization_id: null,
    estimated_value: 1000,
    ...over,
  });
const activity = (id: string, dealId: string, over: Partial<Row> = {}): Row =>
  base(id, {
    subject: `Atividade ${id}`,
    activity_type: { name: "Tarefa", is_meeting: false },
    due_at: "2026-11-12T15:00:00.000Z",
    deal_id: dealId,
    done: false,
    ...over,
  });
const note = (id: string, dealId: string, over: Partial<Row> = {}): Row =>
  base(id, { body: `Anotação ${id}`, entity: "deals", record_id: dealId, ...over });

type Init = {
  rows?: Partial<Record<PushEntity, Row[]>>;
  links?: [PushEntity, string, string][];
  retry?: { entity: PushEntity; record_id: string; attempts: number }[];
  enabled?: boolean;
  mirror?: boolean;
  cursor?: string | null;
  /** Quanto o relógio anda a cada chamada ao Pipedrive. */
  tickMs?: number;
  /** Erro para a chamada (a chamada fica registrada antes de falhar). */
  fail?: (call: Call) => Error | null;
};

/** Banco e Pipedrive falsos: as consultas do store em cima de tabelas em memória, e as chamadas registradas. */
function world(init: Init = {}) {
  let clock = START;
  const key = (e: PushEntity, id: string) => `${e}:${id}`;
  const tables = Object.fromEntries(PUSH_ORDER.map((e) => [e, [...(init.rows?.[e] ?? [])]])) as Record<
    PushEntity,
    Row[]
  >;
  const links = new Map<string, string>((init.links ?? []).map(([e, id, pd]) => [key(e, id), pd]));
  const retry = new Map<string, { entity: PushEntity; record_id: string; company_id: string; attempts: number; last_error: string }>();
  for (const r of init.retry ?? []) {
    retry.set(key(r.entity, r.record_id), { ...r, company_id: C1, last_error: "antes" });
  }
  const settings = { enabled: init.enabled ?? true, cursor: init.cursor === undefined ? CURSOR : init.cursor };
  const calls: Call[] = [];
  /** Escritas no store, em ordem. */
  const events: string[] = [];
  const runs: { id: string; cursorFrom: string; finished?: Finished }[] = [];
  let nextPd = 100;

  const ctx: PushCtx = {
    pdUserOf: () => null,
    pdIdOf: (e, id) => (id ? (links.get(key(e, id)) ?? null) : null),
    pdStageOf: (stageId) => (stageId === STAGE ? PD_STAGE : null),
    pdLeadLabelOf: () => null,
    customFields: [],
    pdActivityTypeOf: (_name, isMeeting) => (isMeeting ? "meeting" : "task"),
    pdOutcomeOf: () => null,
  };
  const byTime = (a: Row, b: Row) =>
    a.updated_at < b.updated_at ? -1 : a.updated_at > b.updated_at ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

  const store: PushStore = {
    settings: async () => ({ ...settings }),
    mirrorActive: async () => init.mirror ?? false,
    buildContext: async () => ctx,
    changed: async (e, since, limit, after) =>
      tables[e]
        .filter(
          (r) =>
            r.deleted_at === null &&
            (r.updated_at > since || (after !== undefined && r.updated_at === since && r.id > after)),
        )
        .sort(byTime)
        .slice(0, limit)
        .map((r) => ({ ...r })),
    deleted: async (e, since) =>
      tables[e]
        .filter((r) => r.deleted_at !== null && r.deleted_at > since)
        .map((r) => ({ id: r.id, company_id: r.company_id })),
    retryQueue: async () =>
      PUSH_ORDER.flatMap((e) =>
        [...retry.values()]
          .filter((r) => r.entity === e)
          .sort((a, b) => (a.record_id < b.record_id ? -1 : 1))
          .map(({ entity, record_id, company_id, attempts }) => ({ entity, record_id, company_id, attempts })),
      ),
    loadOne: async (e, id) => {
      const r = tables[e].find((x) => x.id === id && x.deleted_at === null);
      return r ? { ...r } : null;
    },
    pdIdOf: async (e, id) => links.get(key(e, id)) ?? null,
    link: async (e, pdId, _company, id) => {
      events.push(`link ${e} ${id} ${pdId}`);
      links.set(key(e, id), pdId);
    },
    unlink: async (e, id) => {
      events.push(`unlink ${e} ${id}`);
      links.delete(key(e, id));
    },
    queueRetry: async (e, id, company, error) => {
      events.push(`retry ${e} ${id}`);
      const cur = retry.get(key(e, id));
      retry.set(key(e, id), { entity: e, record_id: id, company_id: company, attempts: (cur?.attempts ?? 0) + 1, last_error: error });
    },
    clearRetry: async (e, id) => {
      events.push(`clear ${e} ${id}`);
      retry.delete(key(e, id));
    },
    startRun: async (cursorFrom) => {
      const id = `run-${runs.length + 1}`;
      runs.push({ id, cursorFrom });
      return id;
    },
    finishRun: async (id, r) => {
      const run = runs.find((x) => x.id === id);
      if (!run) throw new Error(`rodada ${id} não aberta`);
      run.finished = r;
    },
    saveCursor: async (c) => {
      events.push(`cursor ${c}`);
      settings.cursor = c;
    },
    setEnabled: async () => {
      throw new Error("a rodada não liga nem desliga");
    },
  };

  async function call(c: Call): Promise<void> {
    clock += init.tickMs ?? 1000;
    calls.push(c);
    const err = init.fail?.(c);
    if (err) throw err;
  }
  const client = {
    post: async (path: string, body: unknown) => {
      await call({ method: "post", path, body: body as Record<string, unknown> });
      const id = nextPd++;
      return { id: path === "/v1/leads" ? `lead-pd-${id}` : id, title: "x" };
    },
    put: async (path: string, body: unknown) => {
      await call({ method: "put", path, body: body as Record<string, unknown> });
      return { id: Number(path.split("/").pop()) };
    },
    patch: async (path: string, body: unknown) => {
      await call({ method: "patch", path, body: body as Record<string, unknown> });
      return { id: path.split("/").pop() };
    },
    del: async (path: string) => {
      await call({ method: "del", path });
    },
  };

  return {
    tables,
    links,
    retry,
    settings,
    calls,
    events,
    runs,
    pdOf: (e: PushEntity, id: string) => links.get(key(e, id)),
    setClock: (iso: string) => {
      clock = Date.parse(iso);
    },
    run: (budgetMs = HOUR) => runPipedrivePush({ client, store, now: () => new Date(clock) }, { budgetMs }),
  };
}

const paths = (calls: Call[]) => calls.map((c) => `${c.method} ${c.path}`);

describe("rodada da atualização do Pipedrive: quando não roda", () => {
  it("rotina desligada: skipped, sem abrir rodada nem chamar o Pipedrive", async () => {
    const w = world({ enabled: false, rows: { organizations: [org("o1")] } });
    const r = await w.run();
    expect(r.status).toBe("skipped");
    expect(r.reason).toMatch(/desligada/);
    expect(w.calls).toEqual([]);
    expect(w.runs).toEqual([]);
    expect(w.events).toEqual([]);
  });

  it("espelho ativo: skipped com o motivo, nada roda e nada é enviado", async () => {
    const w = world({ mirror: true, rows: { organizations: [org("o1")] }, retry: [{ entity: "persons", record_id: "p1", attempts: 1 }] });
    const r = await w.run();
    expect(r.status).toBe("skipped");
    expect(r.reason).toMatch(/espelho/);
    expect(w.calls).toEqual([]);
    expect(w.runs).toEqual([]);
    expect(w.events).toEqual([]);
    expect(w.settings.cursor).toBe(CURSOR);
  });

  it("ligada sem cursor: skipped, sem mandar o CRM inteiro", async () => {
    const w = world({ cursor: null, rows: { organizations: [org("o1")] } });
    const r = await w.run();
    expect(r.status).toBe("skipped");
    expect(r.reason).toMatch(/cursor/);
    expect(w.calls).toEqual([]);
  });
});

describe("rodada da atualização do Pipedrive: a rodada", () => {
  it("sem id no Pipedrive: post e link; com id: put (lead: patch); na ordem organizações → anotações", async () => {
    const w = world({
      rows: {
        // a anotação mudou antes de todos: a ordem é a das dependências, não a do tempo
        notes: [note("n1", "d1", { updated_at: at("12:10") })],
        activities: [activity("a1", "d1")],
        deals: [deal("d1", "p1")],
        leads: [lead("l1", "p1")],
        persons: [person("p1", "o1")],
        organizations: [org("o1", { updated_at: at("13:50") })],
      },
      links: [
        ["persons", "p1", "201"],
        ["leads", "l1", "lead-pd-9"],
        ["activities", "a1", "301"],
      ],
    });
    const r = await w.run();

    expect(r.status).toBe("done");
    expect(paths(w.calls)).toEqual([
      "post /v1/organizations",
      "put /v1/persons/201",
      "patch /v1/leads/lead-pd-9",
      "post /v1/deals",
      "put /v1/activities/301",
      "post /v1/notes",
    ]);
    // os relacionados vão pelo id do Pipedrive, inclusive o recém-criado
    expect(w.calls[1].body).toMatchObject({ name: "Pessoa p1", org_id: 100 });
    expect(w.calls[3].body).toMatchObject({ person_id: 201, stage_id: PD_STAGE });
    expect(w.calls[4].body).toMatchObject({ deal_id: 101 });
    expect(w.calls[5].body).toMatchObject({ deal_id: 101 });
    expect(w.events.filter((e) => e.startsWith("link"))).toEqual([
      "link organizations o1 100",
      "link deals d1 101",
      "link notes n1 102",
    ]);
    expect(r.counters.organizations).toEqual({ created: 1, updated: 0, deleted: 0, errors: 0 });
    expect(r.counters.persons).toEqual({ created: 0, updated: 1, deleted: 0, errors: 0 });
    expect(r.counters.leads).toEqual({ created: 0, updated: 1, deleted: 0, errors: 0 });
    expect(r.counters.notes).toEqual({ created: 1, updated: 0, deleted: 0, errors: 0 });
    expect(r.errors).toEqual([]);
  });

  it("lê todas as páginas das mudanças", async () => {
    const orgs = Array.from({ length: 501 }, (_, i) => org(`o${String(i).padStart(3, "0")}`, { updated_at: at("13:00") }));
    const w = world({ rows: { organizations: orgs } });
    const r = await w.run();
    expect(r.counters.organizations.created).toBe(501);
    expect(new Set(w.calls.map((c) => c.body?.name)).size).toBe(501);
  });

  it("exclusões: del e unlink na ordem inversa; sem vínculo não há o que apagar", async () => {
    const w = world({
      rows: {
        organizations: [org("o9", { deleted_at: at("13:00") })],
        persons: [person("p9", null, { deleted_at: at("13:00") })],
        deals: [deal("d9", null, { deleted_at: at("13:10") })],
        notes: [note("n9", "d9", { deleted_at: at("12:30") }), note("n8", "d9", { deleted_at: at("11:00") })],
      },
      links: [
        ["organizations", "o9", "909"],
        ["deals", "d9", "919"],
        ["notes", "n9", "929"],
        ["notes", "n8", "928"],
      ],
    });
    const r = await w.run();
    expect(r.status).toBe("done");
    // n8 foi para a lixeira antes do cursor: já foi tratada numa rodada anterior
    expect(paths(w.calls)).toEqual(["del /v1/notes/929", "del /v1/deals/919", "del /v1/organizations/909"]);
    expect(w.events.filter((e) => e.startsWith("unlink"))).toEqual([
      "unlink notes n9",
      "unlink deals d9",
      "unlink organizations o9",
    ]);
    expect(w.pdOf("deals", "d9")).toBeUndefined();
    expect(r.counters.deals.deleted).toBe(1);
    expect(r.counters.persons.deleted).toBe(0);
  });

  it("a fila de retry vem antes das mudanças e o registro sai da fila quando dá certo", async () => {
    const w = world({
      rows: {
        organizations: [org("o1", { updated_at: at("11:00") }), org("o2", { updated_at: at("13:00") })],
        persons: [person("p1", "o1", { updated_at: at("11:00") })],
      },
      links: [["organizations", "o1", "501"]],
      retry: [{ entity: "persons", record_id: "p1", attempts: 2 }],
    });
    const r = await w.run();
    expect(paths(w.calls)).toEqual(["post /v1/persons", "post /v1/organizations"]);
    expect(w.calls[0].body).toMatchObject({ org_id: 501 });
    expect(w.events).toContain("clear persons p1");
    expect(w.retry.size).toBe(0);
    expect(r.counters.persons.created).toBe(1);
  });

  it("registro da fila que foi para a lixeira: apagado no Pipedrive (se tinha vínculo) e fora da fila", async () => {
    const w = world({
      rows: {
        deals: [deal("d1", null, { deleted_at: at("11:00") }), deal("d2", null, { deleted_at: at("11:00") })],
      },
      links: [["deals", "d1", "77"]],
      retry: [
        { entity: "deals", record_id: "d1", attempts: 1 },
        { entity: "deals", record_id: "d2", attempts: 3 },
      ],
    });
    const r = await w.run();
    expect(paths(w.calls)).toEqual(["del /v1/deals/77"]);
    expect(w.events).toEqual(expect.arrayContaining(["unlink deals d1", "clear deals d1", "clear deals d2"]));
    expect(w.retry.size).toBe(0);
    expect(r.counters.deals.deleted).toBe(1);
  });

  it(`na ${MAX_ATTEMPTS}ª falha o registro sai da fila e fica só no relatório`, async () => {
    const w = world({
      rows: { organizations: [org("o1", { updated_at: at("11:00") }), org("o2", { updated_at: at("11:00") })] },
      retry: [
        { entity: "organizations", record_id: "o1", attempts: MAX_ATTEMPTS - 1 },
        { entity: "organizations", record_id: "o2", attempts: 1 },
      ],
      fail: () => new PipedriveError("Pipedrive respondeu 500 em /v1/organizations", 500),
    });
    const r = await w.run();
    expect(r.status).toBe("done");
    expect(paths(w.calls)).toEqual(["post /v1/organizations", "post /v1/organizations"]);
    expect(w.events).toContain("clear organizations o1");
    expect([...w.retry.values()].map((x) => [x.record_id, x.attempts])).toEqual([["o2", 2]]);
    expect(r.errors).toEqual([
      { entity: "organizations", id: "o1", reason: expect.stringMatching(/500.*5 tentativas/) },
      { entity: "organizations", id: "o2", reason: expect.stringMatching(/500/) },
    ]);
    expect(r.counters.organizations.errors).toBe(2);
  });

  it("a falha de um registro (no Pipedrive ou na conversão) vai para a fila e não para a rodada", async () => {
    const w = world({
      rows: {
        organizations: [org("o1"), org("o2", { updated_at: at("13:10") })],
        deals: [deal("d1", null, { organization_id: "o2", stage_id: "etapa-nova" }), deal("d2", null, { organization_id: "o2" })],
      },
      fail: (c) =>
        c.method === "post" && c.body?.name === "Org o1"
          ? new PipedriveError("Pipedrive respondeu 400 em /v1/organizations: nome inválido", 400)
          : null,
    });
    const r = await w.run();
    expect(r.status).toBe("done");
    expect(paths(w.calls)).toEqual(["post /v1/organizations", "post /v1/organizations", "post /v1/deals"]);
    expect([...w.retry.values()].map((x) => [x.entity, x.record_id, x.attempts])).toEqual([
      ["organizations", "o1", 1],
      ["deals", "d1", 1],
    ]);
    expect(r.errors).toEqual([
      { entity: "organizations", id: "o1", reason: expect.stringMatching(/nome inválido/) },
      { entity: "deals", id: "d1", reason: expect.stringMatching(/etapa etapa-nova sem correspondente/) },
    ]);
    expect(r.counters.organizations).toEqual({ created: 1, updated: 0, deleted: 0, errors: 1 });
    expect(w.settings.cursor).toBe(START_CURSOR);
  });

  it("id que sumiu do Pipedrive (404 na atualização): post, unlink do antigo e link do novo", async () => {
    const w = world({
      rows: { organizations: [org("o1")] },
      links: [["organizations", "o1", "555"]],
      fail: (c) => (c.method === "put" ? new PipedriveError("Pipedrive respondeu 404 em /v1/organizations/555", 404) : null),
    });
    const r = await w.run();
    expect(paths(w.calls)).toEqual(["put /v1/organizations/555", "post /v1/organizations"]);
    expect(w.events).toEqual(["unlink organizations o1", "link organizations o1 100", `cursor ${START_CURSOR}`]);
    expect(r.counters.organizations).toEqual({ created: 1, updated: 0, deleted: 0, errors: 0 });
  });
});

describe("rodada da atualização do Pipedrive: cursor e relatório", () => {
  it("dentro do tempo: o cursor vira o início da rodada menos 2 min; startRun e finishRun são chamados", async () => {
    const w = world({ rows: { organizations: [org("o1")] }, tickMs: 5 * 60_000 });
    const r = await w.run();
    expect(CURSOR_OVERLAP_MS).toBe(2 * 60_000);
    expect(START_CURSOR).toBe("2026-11-09T13:58:00.000Z");
    expect(r.status).toBe("done");
    expect(r.reason).toBeUndefined();
    expect(w.settings.cursor).toBe(START_CURSOR);
    expect(w.runs).toHaveLength(1);
    expect(w.runs[0].cursorFrom).toBe(CURSOR);
    expect(w.runs[0].finished).toEqual({
      status: "done",
      cursorTo: START_CURSOR,
      counters: r.counters,
      errors: [],
    });
  });

  it("a sobreposição relê o que mudou logo antes do cursor: o registro já vinculado só leva outro put", async () => {
    const w = world({ rows: { organizations: [org("o1", { updated_at: at("13:59") })] } });
    await w.run();
    expect(paths(w.calls)).toEqual(["post /v1/organizations"]);
    w.setClock("2026-11-09T15:00:00.000Z");
    w.calls.length = 0;
    await w.run();
    expect(paths(w.calls)).toEqual(["put /v1/organizations/100"]);
    expect(w.settings.cursor).toBe("2026-11-09T14:58:00.000Z");
  });

  it("tempo esgotado: o cursor vira o updated_at do último concluído antes de tudo o que ficou de fora", async () => {
    const w = world({
      rows: {
        organizations: [org("o1", { updated_at: at("13:00") }), org("o2", { updated_at: at("13:10") })],
        persons: [person("p1", "o1", { updated_at: at("13:05") }), person("p2", "o1", { updated_at: at("13:20") })],
      },
      tickMs: 10 * 60_000,
    });
    // cada chamada leva 10 min: o1 e o2 cabem em 15 min, p1 não começa
    const r = await w.run(15 * 60_000);
    expect(r.status).toBe("done");
    expect(r.reason).toMatch(/tempo/);
    expect(paths(w.calls)).toEqual(["post /v1/organizations", "post /v1/organizations"]);
    // p1 (13:05) ficou de fora: o cursor não pode passar dele, então volta para o1 (13:00), e não o2 (13:10),
    // menos a sobreposição de 2 min
    expect(w.settings.cursor).toBe(at("12:58"));
    expect(w.runs[0].finished).toMatchObject({ status: "done", cursorTo: at("12:58") });

    // a rodada seguinte retoma: as organizações só são atualizadas (mesmo id), as pessoas são criadas
    w.setClock("2026-11-09T15:00:00.000Z");
    w.calls.length = 0;
    const r2 = await w.run();
    expect(r2.status).toBe("done");
    expect(paths(w.calls)).toEqual([
      "put /v1/organizations/100",
      "put /v1/organizations/101",
      "post /v1/persons",
      "post /v1/persons",
    ]);
    expect(w.settings.cursor).toBe("2026-11-09T14:58:00.000Z");
  });

  it("tempo esgotado com o último concluído abaixo do que ficou: o cursor é o updated_at dele", async () => {
    const w = world({
      rows: {
        organizations: [org("o1", { updated_at: at("13:00") }), org("o2", { updated_at: at("13:10") })],
        persons: [person("p1", "o1", { updated_at: at("13:05") }), person("p2", "o1", { updated_at: at("13:20") })],
      },
      tickMs: 10 * 60_000,
    });
    const r = await w.run(25 * 60_000);
    expect(paths(w.calls)).toEqual(["post /v1/organizations", "post /v1/organizations", "post /v1/persons"]);
    expect(r.reason).toMatch(/tempo/);
    expect(w.settings.cursor).toBe(at("13:08"));
  });

  it("tempo esgotado logo depois do cursor: a sobreposição não leva o cursor para antes do de entrada", async () => {
    const w = world({
      rows: {
        organizations: [org("o1", { updated_at: "2026-11-09T12:01:00.000Z" })],
        persons: [person("p1", "o1", { updated_at: at("12:30") })],
      },
      tickMs: 10 * 60_000,
    });
    const r = await w.run(5 * 60_000);
    expect(paths(w.calls)).toEqual(["post /v1/organizations"]);
    expect(r.reason).toMatch(/tempo/);
    expect(w.settings.cursor).toBe(CURSOR);
  });

  it("tempo esgotado antes das mudanças: o cursor fica onde estava", async () => {
    const w = world({
      rows: { organizations: [org("o1", { updated_at: at("11:00") }), org("o2", { updated_at: at("11:00") }), org("o3")] },
      retry: [
        { entity: "organizations", record_id: "o1", attempts: 1 },
        { entity: "organizations", record_id: "o2", attempts: 1 },
      ],
      tickMs: 10 * 60_000,
    });
    const r = await w.run(5 * 60_000);
    expect(paths(w.calls)).toEqual(["post /v1/organizations"]);
    expect(r.reason).toMatch(/tempo/);
    expect(w.settings.cursor).toBe(CURSOR);
    expect(w.runs[0].finished).toMatchObject({ status: "done", cursorTo: CURSOR });
  });

  it("PipedriveAuthError: failed, para na hora e não salva o cursor", async () => {
    const w = world({
      rows: { organizations: [org("o1"), org("o2", { updated_at: at("13:10") })] },
      fail: () => new PipedriveAuthError(),
    });
    const r = await w.run();
    expect(r.status).toBe("failed");
    expect(r.reason).toMatch(/401/);
    expect(paths(w.calls)).toEqual(["post /v1/organizations"]);
    expect(w.events.some((e) => e.startsWith("cursor"))).toBe(false);
    expect(w.settings.cursor).toBe(CURSOR);
    expect(w.retry.size).toBe(0);
    expect(w.runs[0].finished).toMatchObject({ status: "failed", cursorTo: CURSOR });
  });
});

describe("rodada da atualização do Pipedrive: relacionados sob demanda", () => {
  it("negócio cuja pessoa foi criada no CRM antes do cursor (nunca enviada): post e link da pessoa, depois post do negócio", async () => {
    const w = world({
      rows: { persons: [person("p1", null, { updated_at: at("11:00") })], deals: [deal("d1", "p1")] },
    });
    const r = await w.run();
    expect(paths(w.calls)).toEqual(["post /v1/persons", "post /v1/deals"]);
    expect(w.calls[1].body).toMatchObject({ person_id: 100 });
    expect(w.events.filter((e) => e.startsWith("link"))).toEqual(["link persons p1 100", "link deals d1 101"]);
    expect(r.counters.persons.created).toBe(1);
    expect(r.counters.deals.created).toBe(1);
    expect(w.retry.size).toBe(0);
    expect(r.errors).toEqual([]);
  });

  it("dois níveis: negócio → pessoa → organização", async () => {
    const w = world({
      rows: {
        organizations: [org("o1", { updated_at: at("11:00") })],
        persons: [person("p1", "o1", { updated_at: at("11:00") })],
        deals: [deal("d1", "p1")],
      },
    });
    const r = await w.run();
    expect(paths(w.calls)).toEqual(["post /v1/organizations", "post /v1/persons", "post /v1/deals"]);
    expect(w.calls[1].body).toMatchObject({ org_id: 100 });
    expect(w.calls[2].body).toMatchObject({ person_id: 101 });
    expect(r.counters.organizations.created).toBe(1);
    expect(w.retry.size).toBe(0);
  });

  it("além de dois níveis: tudo espera na fila e a rodada seguinte resolve pela ordem da fila", async () => {
    const w = world({
      rows: {
        organizations: [org("o1", { updated_at: at("11:00") })],
        persons: [person("p1", "o1", { updated_at: at("11:00") })],
        deals: [deal("d1", "p1", { updated_at: at("11:00") })],
        activities: [activity("a1", "d1")],
      },
    });
    const r = await w.run();
    // atividade → negócio → pessoa: a organização da pessoa seria o terceiro nível
    expect(w.calls).toEqual([]);
    expect([...w.retry.values()].map((x) => [x.entity, x.record_id, x.attempts])).toEqual([
      ["persons", "p1", 1],
      ["deals", "d1", 1],
      ["activities", "a1", 1],
    ]);
    expect(r.errors).toEqual([]);

    w.setClock("2026-11-09T15:00:00.000Z");
    await w.run();
    expect(paths(w.calls)).toEqual([
      "post /v1/organizations",
      "post /v1/persons",
      "post /v1/deals",
      "post /v1/activities",
    ]);
    expect(w.retry.size).toBe(0);
  });

  it("relacionado que falha: entra na fila com o próprio erro, e o dependente espera sem contar como erro", async () => {
    const w = world({
      rows: { persons: [person("p1", null, { updated_at: at("11:00") })], deals: [deal("d1", "p1")] },
      fail: (c) => (c.path === "/v1/persons" ? new PipedriveError("Pipedrive respondeu 500 em /v1/persons", 500) : null),
    });
    const r = await w.run();
    expect(paths(w.calls)).toEqual(["post /v1/persons"]);
    expect([...w.retry.values()].map((x) => [x.entity, x.record_id, x.attempts])).toEqual([
      ["persons", "p1", 1],
      ["deals", "d1", 1],
    ]);
    expect(r.errors).toEqual([{ entity: "persons", id: "p1", reason: expect.stringMatching(/500/) }]);
    expect(r.counters.deals.errors).toBe(0);
    expect(w.retry.get("deals:d1")?.last_error).toMatch(/pessoa ainda sem id no Pipedrive.*persons p1: .*500/);
  });

  it("relacionado na lixeira: o dependente vai para a fila com o motivo, sem chamar o Pipedrive", async () => {
    const w = world({
      rows: {
        persons: [person("p1", null, { updated_at: at("11:00"), deleted_at: at("11:00") })],
        deals: [deal("d1", "p1")],
      },
    });
    const r = await w.run();
    expect(w.calls).toEqual([]);
    expect(w.retry.get("deals:d1")?.last_error).toMatch(/persons p1: na lixeira/);
    expect(r.errors).toEqual([]);
  });
});

describe("rodada da atualização do Pipedrive: casos do Review Focus", () => {
  it("criado e mudado de novo antes da rodada: um post só; nas rodadas seguintes, put no mesmo id", async () => {
    const w = world({
      // falhou numa rodada anterior (está na fila) e mudou de novo depois: aparece na fila e nas mudanças
      rows: { organizations: [org("o1", { name: "Nome novo", updated_at: at("13:30") })] },
      retry: [{ entity: "organizations", record_id: "o1", attempts: 1 }],
    });
    await w.run();
    expect(paths(w.calls)).toEqual(["post /v1/organizations"]);
    expect(w.calls[0].body).toMatchObject({ name: "Nome novo" });
    expect(w.pdOf("organizations", "o1")).toBe("100");
    expect(w.retry.size).toBe(0);

    w.tables.organizations[0] = { ...w.tables.organizations[0], name: "Outro nome", updated_at: at("14:30") };
    w.setClock("2026-11-09T15:00:00.000Z");
    w.calls.length = 0;
    await w.run();
    expect(paths(w.calls)).toEqual(["put /v1/organizations/100"]);
    expect(w.calls[0].body).toMatchObject({ name: "Outro nome" });
  });

  it("pessoa falha: o negócio dela vai para o retry sem post e entra na rodada seguinte, depois da pessoa", async () => {
    let down = true;
    const w = world({
      rows: { persons: [person("p1", null)], deals: [deal("d1", "p1")] },
      fail: (c) => (down && c.path === "/v1/persons" ? new PipedriveError("Falha de rede ao chamar o Pipedrive em /v1/persons") : null),
    });
    const r = await w.run();
    expect(paths(w.calls)).toEqual(["post /v1/persons"]);
    expect([...w.retry.values()].map((x) => [x.entity, x.record_id, x.attempts])).toEqual([
      ["persons", "p1", 1],
      ["deals", "d1", 1],
    ]);
    // só a pessoa é erro: o negócio está esperando por ela
    expect(r.errors.map((e) => e.id)).toEqual(["p1"]);
    expect(r.counters.deals.errors).toBe(0);

    down = false;
    w.setClock("2026-11-09T15:00:00.000Z");
    w.calls.length = 0;
    const r2 = await w.run();
    expect(paths(w.calls)).toEqual(["post /v1/persons", "post /v1/deals"]);
    expect(w.calls[1].body).toMatchObject({ person_id: 100 });
    expect(w.retry.size).toBe(0);
    expect(r2.counters.deals.created).toBe(1);
  });

  it("apagado e restaurado antes da rodada: só put", async () => {
    const w = world({
      rows: { organizations: [org("o1", { updated_at: at("13:30"), deleted_at: null })] },
      links: [["organizations", "o1", "700"]],
    });
    await w.run();
    expect(paths(w.calls)).toEqual(["put /v1/organizations/700"]);
    expect(w.events.some((e) => e.includes("unlink"))).toBe(false);
  });

  it("restaurado depois de apagado no Pipedrive (sem vínculo): post e link de novo", async () => {
    const w = world({
      rows: { organizations: [org("o1", { updated_at: at("13:00"), deleted_at: at("13:00") })] },
      links: [["organizations", "o1", "700"]],
    });
    await w.run();
    expect(paths(w.calls)).toEqual(["del /v1/organizations/700"]);
    expect(w.pdOf("organizations", "o1")).toBeUndefined();

    w.tables.organizations[0] = { ...w.tables.organizations[0], deleted_at: null, updated_at: at("14:30") };
    w.setClock("2026-11-09T15:00:00.000Z");
    w.calls.length = 0;
    w.events.length = 0;
    await w.run();
    expect(paths(w.calls)).toEqual(["post /v1/organizations"]);
    expect(w.events).toContain("link organizations o1 100");
    expect(w.pdOf("organizations", "o1")).toBe("100");
  });

  it("o mesmo id do Pipedrive em duas empresas: só a versão com o updated_at mais recente é enviada", async () => {
    const w = world({
      rows: {
        persons: [
          person("p-a", null, { company_id: C2, full_name: "Versão nova", updated_at: at("13:40") }),
          person("p-b", null, { company_id: C1, full_name: "Versão velha", updated_at: at("13:10") }),
        ],
      },
      links: [
        ["persons", "p-a", "900"],
        ["persons", "p-b", "900"],
      ],
    });
    const r = await w.run();
    expect(paths(w.calls)).toEqual(["put /v1/persons/900"]);
    expect(w.calls[0].body).toMatchObject({ name: "Versão nova" });
    expect(r.counters.persons.updated).toBe(1);
  });
});
