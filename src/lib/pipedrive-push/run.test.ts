import { describe, expect, it, vi } from "vitest";
import { PipedriveAuthError, PipedriveError } from "@/lib/import/pipedrive/client";
import type { PushCtx, PushEntity } from "./mapping";
import { CURSOR_OVERLAP_MS, MAX_ATTEMPTS, runPipedrivePush } from "./run";
import { PUSH_ORDER, type PushCursors, type PushStore } from "./store";

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
const activity = (id: string, dealId: string | null, over: Partial<Row> = {}): Row =>
  base(id, {
    subject: `Atividade ${id}`,
    activity_type: { name: "Tarefa", is_meeting: false },
    channel: { name: "Não informado" },
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
  /** Outra rodada em andamento (trava de rodadas simultâneas). */
  running?: boolean;
  cursor?: string | null;
  cursors?: PushCursors;
  /** Avisos que o contexto manda para o relatório ao montar. */
  warnings?: string[];
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
  const settings: { enabled: boolean; cursor: string | null; cursors: PushCursors } = {
    enabled: init.enabled ?? true,
    cursor: init.cursor === undefined ? CURSOR : init.cursor,
    cursors: { ...init.cursors },
  };
  /** Como no store: registros vistos na lixeira (ou inexistentes) por `loadOne` e `deleted`. */
  const gone = new Set<string>();
  const calls: Call[] = [];
  /** Escritas no store, em ordem. */
  const events: string[] = [];
  const runs: { id: string; cursorFrom: string; finished?: Finished }[] = [];
  let nextPd = 100;

  const ctx: PushCtx = {
    pdUserOf: () => null,
    pdIdOf: (e, id) => (id ? (links.get(key(e, id)) ?? null) : null),
    isGone: (e, id) => gone.has(key(e, id)),
    pdStageOf: (stageId) => (stageId === STAGE ? PD_STAGE : null),
    pdLeadLabelOf: (company) => (company === C1 ? "label-c1" : null),
    customFields: [],
    pdActivityTypeOf: (_name, isMeeting, channel) => (isMeeting ? "meeting" : channel === "Telefone" ? "call" : "task"),
    pdOutcomeOf: () => null,
  };
  const byTime = (a: Row, b: Row) =>
    a.updated_at < b.updated_at ? -1 : a.updated_at > b.updated_at ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

  const store: PushStore = {
    settings: async () => ({ ...settings, cursors: { ...settings.cursors } }),
    mirrorActive: async () => init.mirror ?? false,
    runActive: async () => init.running ?? false,
    buildContext: async (warn) => {
      for (const w of init.warnings ?? []) warn?.(w);
      return ctx;
    },
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
    deleted: async (e, since) => {
      const out = tables[e].filter((r) => r.deleted_at !== null && r.deleted_at > since);
      for (const r of out) gone.add(key(e, r.id));
      return out.map((r) => ({ id: r.id, company_id: r.company_id }));
    },
    retryQueue: async () =>
      PUSH_ORDER.flatMap((e) =>
        [...retry.values()]
          .filter((r) => r.entity === e)
          .sort((a, b) => (a.record_id < b.record_id ? -1 : 1))
          .map(({ entity, record_id, company_id, attempts }) => ({ entity, record_id, company_id, attempts })),
      ),
    loadOne: async (e, id) => {
      const r = tables[e].find((x) => x.id === id && x.deleted_at === null);
      if (r) gone.delete(key(e, id));
      else gone.add(key(e, id));
      return r ? { ...r } : null;
    },
    pdIdOf: async (e, id) => links.get(key(e, id)) ?? null,
    link: async (e, pdId, _company, id) => {
      events.push(`link ${e} ${id} ${pdId}`);
      links.set(key(e, id), pdId);
      gone.delete(key(e, id));
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
    linkedChildren: async (e, id) => {
      const column = { organizations: "organization_id", persons: "person_id", leads: "lead_id", deals: "deal_id" }[
        e as string
      ];
      if (!column) return [];
      const acts = tables.activities.filter((a) => a.deleted_at === null && a[column] === id);
      const notes = tables.notes.filter((n) => n.deleted_at === null && n.entity === e && n.record_id === id);
      return [
        ...acts.filter((a) => links.has(key("activities", a.id))).map((a) => ({ entity: "activities" as const, id: a.id, company_id: a.company_id })),
        ...notes.filter((n) => links.has(key("notes", n.id))).map((n) => ({ entity: "notes" as const, id: n.id, company_id: n.company_id })),
      ];
    },
    requeue: async (e, id, company, reason) => {
      events.push(`requeue ${e} ${id}`);
      if (!retry.has(key(e, id))) retry.set(key(e, id), { entity: e, record_id: id, company_id: company, attempts: 0, last_error: reason });
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
    saveCursors: async (c) => {
      events.push(`cursors ${JSON.stringify(c)}`);
      settings.cursors = { ...c };
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
    /** Cursor gravado da entidade (sem o próprio: o inicial comum). */
    cursorOf: (e: PushEntity) => settings.cursors[e] ?? { at: settings.cursor },
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

  it("outra rodada em andamento (há menos de 55 min): skipped, sem abrir rodada nem chamar o Pipedrive", async () => {
    const w = world({ running: true, rows: { organizations: [org("o1")] } });
    const r = await w.run();
    expect(r.status).toBe("skipped");
    expect(r.reason).toMatch(/outra rodada em andamento.*55 min/);
    expect(w.calls).toEqual([]);
    expect(w.runs).toEqual([]);
    expect(w.events).toEqual([]);
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
    // a etiqueta da empresa vai só na criação: o PATCH trocaria as etiquetas do lead no Pipedrive
    expect(w.calls[2].body).not.toHaveProperty("label_ids");
    expect(w.calls[3].body).toMatchObject({ person_id: 201, stage_id: PD_STAGE });
    expect(w.calls[4].body).toMatchObject({ deal_id: 101 });
    expect(w.calls[5].body).toMatchObject({ deal_id: 101 });
    expect(w.events.filter((e) => e.startsWith("link"))).toEqual([
      "link organizations o1 100",
      "link deals d1 101",
      "link notes n1 102",
    ]);
    // o negócio é novo no Pipedrive: a atividade dele que já tinha id entra na fila e, como também mudou, sai na hora
    expect(w.events).toEqual(expect.arrayContaining(["requeue activities a1", "clear activities a1"]));
    expect(w.retry.size).toBe(0);
    expect(r.counters.organizations).toEqual({ created: 1, updated: 0, deleted: 0, errors: 0 });
    expect(r.counters.persons).toEqual({ created: 0, updated: 1, deleted: 0, errors: 0 });
    expect(r.counters.leads).toEqual({ created: 0, updated: 1, deleted: 0, errors: 0 });
    expect(r.counters.notes).toEqual({ created: 1, updated: 0, deleted: 0, errors: 0 });
    expect(r.errors).toEqual([]);
  });

  it("lead novo leva a etiqueta da empresa no POST", async () => {
    const w = world({ rows: { leads: [lead("l1", "p1")] }, links: [["persons", "p1", "201"]] });
    await w.run();
    expect(paths(w.calls)).toEqual(["post /v1/leads"]);
    expect(w.calls[0].body).toMatchObject({ title: "Lead l1", person_id: 201, label_ids: ["label-c1"] });
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
      fail: () => new PipedriveError("Pipedrive respondeu 400 em /v1/organizations: campo inválido", 400),
    });
    const r = await w.run();
    expect(r.status).toBe("done");
    expect(paths(w.calls)).toEqual(["post /v1/organizations", "post /v1/organizations"]);
    expect(w.events).toContain("clear organizations o1");
    expect([...w.retry.values()].map((x) => [x.record_id, x.attempts])).toEqual([["o2", 2]]);
    expect(r.errors).toEqual([
      { entity: "organizations", id: "o1", reason: expect.stringMatching(/400.*5 tentativas/) },
      { entity: "organizations", id: "o2", reason: expect.stringMatching(/400/) },
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
    expect(w.cursorOf("organizations")).toEqual({ at: START_CURSOR });
    expect(w.cursorOf("deals")).toEqual({ at: START_CURSOR });
  });

  it("404 no POST e 422 são do registro: fila com tentativa, e a rodada segue", async () => {
    const w = world({
      rows: { organizations: [org("o1"), org("o2", { updated_at: at("13:10") }), org("o3", { updated_at: at("13:20") })] },
      fail: (c) =>
        c.body?.name === "Org o1"
          ? new PipedriveError("Pipedrive respondeu 404 em /v1/organizations", 404)
          : c.body?.name === "Org o2"
            ? new PipedriveError("Pipedrive respondeu 422 em /v1/organizations", 422)
            : null,
    });
    const r = await w.run();
    expect(r.status).toBe("done");
    expect(paths(w.calls)).toHaveLength(3);
    expect([...w.retry.values()].map((x) => [x.record_id, x.attempts])).toEqual([
      ["o1", 1],
      ["o2", 1],
    ]);
    expect(r.counters.organizations).toEqual({ created: 1, updated: 0, deleted: 0, errors: 2 });
  });

  it("id que sumiu do Pipedrive (404 na atualização): post, unlink do antigo e link do novo", async () => {
    const w = world({
      rows: { organizations: [org("o1")] },
      links: [["organizations", "o1", "555"]],
      fail: (c) => (c.method === "put" ? new PipedriveError("Pipedrive respondeu 404 em /v1/organizations/555", 404) : null),
    });
    const r = await w.run();
    expect(paths(w.calls)).toEqual(["put /v1/organizations/555", "post /v1/organizations"]);
    expect(w.events.filter((e) => !e.startsWith("cursors"))).toEqual(["unlink organizations o1", "link organizations o1 100"]);
    expect(r.counters.organizations).toEqual({ created: 1, updated: 0, deleted: 0, errors: 0 });
  });
});

describe("rodada da atualização do Pipedrive: cursores e relatório", () => {
  const all = (w: ReturnType<typeof world>) => PUSH_ORDER.map((e) => w.cursorOf(e));

  it("dentro do tempo: o cursor de cada entidade vira o início da rodada menos 2 min; startRun e finishRun são chamados", async () => {
    const w = world({ rows: { organizations: [org("o1")] }, tickMs: 5 * 60_000 });
    const r = await w.run();
    expect(CURSOR_OVERLAP_MS).toBe(2 * 60_000);
    expect(START_CURSOR).toBe("2026-11-09T13:58:00.000Z");
    expect(r.status).toBe("done");
    expect(r.reason).toBeUndefined();
    expect(all(w)).toEqual(PUSH_ORDER.map(() => ({ at: START_CURSOR })));
    // o cursor inicial comum só muda ao ligar
    expect(w.settings.cursor).toBe(CURSOR);
    expect(w.runs).toHaveLength(1);
    expect(w.runs[0].cursorFrom).toBe(CURSOR);
    expect(w.runs[0].finished).toEqual({
      status: "done",
      cursorTo: START_CURSOR,
      counters: r.counters,
      errors: [],
      warnings: [],
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
    expect(w.cursorOf("organizations")).toEqual({ at: "2026-11-09T14:58:00.000Z" });
  });

  it("tempo esgotado no meio de uma entidade: ela para no último enviado, as anteriores andam e as seguintes esperam", async () => {
    const w = world({
      rows: {
        organizations: [org("o1", { updated_at: at("13:00") }), org("o2", { updated_at: at("13:10") }), org("o3", { updated_at: at("13:20") })],
        // mudou antes das organizações: com um cursor só, seguraria o cursor delas
        persons: [person("p1", "o1", { updated_at: at("12:30") })],
      },
      tickMs: 10 * 60_000,
    });
    // cada chamada leva 10 min: o1 e o2 cabem em 15 min, o3 não começa
    const r = await w.run(15 * 60_000);
    expect(r.status).toBe("done");
    expect(r.reason).toMatch(/tempo/);
    expect(paths(w.calls)).toEqual(["post /v1/organizations", "post /v1/organizations"]);
    expect(w.cursorOf("organizations")).toEqual({ at: at("13:10"), id: "o2" });
    expect(w.cursorOf("persons")).toEqual({ at: CURSOR });
    expect(w.runs[0].finished).toMatchObject({ status: "done", cursorTo: CURSOR });

    // a rodada seguinte continua de o3, sem reenviar o1 e o2, e segue para as pessoas
    w.setClock("2026-11-09T15:00:00.000Z");
    w.calls.length = 0;
    const r2 = await w.run();
    expect(r2.status).toBe("done");
    expect(paths(w.calls)).toEqual(["post /v1/organizations", "post /v1/persons"]);
    expect(w.calls[0].body).toMatchObject({ name: "Org o3" });
    expect(w.calls[1].body).toMatchObject({ org_id: 100 });
    expect(all(w)).toEqual(PUSH_ORDER.map(() => ({ at: "2026-11-09T14:58:00.000Z" })));
  });

  it("mudança em massa com o mesmo updated_at: a rodada seguinte continua do registro seguinte, pelo id", async () => {
    const T = at("13:00");
    const w = world({
      rows: { organizations: ["o1", "o2", "o3", "o4"].map((id) => org(id, { updated_at: T })) },
      tickMs: 10 * 60_000,
    });
    await w.run(15 * 60_000);
    expect(w.calls.map((c) => c.body?.name)).toEqual(["Org o1", "Org o2"]);
    expect(w.cursorOf("organizations")).toEqual({ at: T, id: "o2" });

    w.setClock("2026-11-09T15:00:00.000Z");
    w.calls.length = 0;
    await w.run(25 * 60_000);
    expect(w.calls.map((c) => c.body?.name)).toEqual(["Org o3", "Org o4"]);
    expect(w.cursorOf("organizations")).toEqual({ at: "2026-11-09T14:58:00.000Z" });
  });

  it("organizações acima do orçamento: atividades e anotações andam nas rodadas seguintes", async () => {
    const w = world({
      rows: {
        organizations: ["o1", "o2", "o3", "o4", "o5"].map((id, i) => org(id, { updated_at: at(`13:0${i}`) })),
        deals: [deal("d1", "p1", { updated_at: at("11:00") })],
        // mudaram antes das organizações
        activities: [activity("a1", "d1", { updated_at: at("12:30") })],
        notes: [note("n1", "d1", { updated_at: at("12:40") })],
      },
      links: [
        ["persons", "p1", "201"],
        ["deals", "d1", "700"],
      ],
      tickMs: 10 * 60_000,
    });
    // 25 min de orçamento: três chamadas por rodada
    await w.run(25 * 60_000);
    expect(w.calls.map((c) => c.body?.name)).toEqual(["Org o1", "Org o2", "Org o3"]);

    w.setClock("2026-11-09T15:00:00.000Z");
    w.calls.length = 0;
    await w.run(25 * 60_000);
    expect(paths(w.calls)).toEqual(["post /v1/organizations", "post /v1/organizations", "post /v1/activities"]);
    expect(w.calls[2].body).toMatchObject({ subject: "Atividade a1", deal_id: 700 });
    expect(w.cursorOf("activities")).toEqual({ at: "2026-11-09T14:58:00.000Z" });
    expect(w.cursorOf("notes")).toEqual({ at: CURSOR });

    w.setClock("2026-11-09T16:00:00.000Z");
    w.calls.length = 0;
    await w.run(25 * 60_000);
    expect(paths(w.calls)).toEqual(["post /v1/notes"]);
    expect(w.calls[0].body).toMatchObject({ deal_id: 700 });
    expect(all(w)).toEqual(PUSH_ORDER.map(() => ({ at: "2026-11-09T15:58:00.000Z" })));
    expect(w.retry.size).toBe(0);
  });

  it("o cursor não volta: entrada depois do início da rodada (relógio adiantado) fica onde estava", async () => {
    const ahead = "2026-11-09T14:30:00.000Z";
    const w = world({ cursor: ahead, rows: { organizations: [org("o1", { updated_at: at("14:40") })] } });
    const r = await w.run();
    expect(r.status).toBe("done");
    expect(paths(w.calls)).toEqual(["post /v1/organizations"]);
    expect(all(w)).toEqual(PUSH_ORDER.map(() => ({ at: ahead })));
    expect(w.events.some((e) => e.startsWith("cursors"))).toBe(false);
  });

  it("cursor próprio da entidade vale sobre o inicial comum", async () => {
    const w = world({
      rows: { organizations: [org("o1", { updated_at: at("12:30") }), org("o2", { updated_at: at("13:30") })] },
      cursors: { organizations: { at: at("13:00") } },
    });
    await w.run();
    expect(w.calls.map((c) => c.body?.name)).toEqual(["Org o2"]);
    expect(w.runs[0].cursorFrom).toBe(CURSOR);
  });

  it("tempo esgotado antes das mudanças: os cursores ficam onde estavam", async () => {
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
    expect(w.events.some((e) => e.startsWith("cursors"))).toBe(false);
    expect(all(w)).toEqual(PUSH_ORDER.map(() => ({ at: CURSOR })));
    expect(w.runs[0].finished).toMatchObject({ status: "done", cursorTo: CURSOR });
  });

  it("avisos do contexto vão para o relatório e para a rodada, sem repetir", async () => {
    const aviso = "etapa X do CRM corresponde a 2 etapas do Pipedrive (10, 20): vai a 10";
    const w = world({ warnings: [aviso, aviso] });
    const r = await w.run();
    expect(r.warnings).toEqual([aviso]);
    expect(w.runs[0].finished?.warnings).toEqual([aviso]);
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
    expect(w.events.some((e) => e.startsWith("cursors"))).toBe(false);
    expect(w.cursorOf("organizations")).toEqual({ at: CURSOR });
    expect(w.retry.size).toBe(0);
    expect(w.runs[0].finished).toMatchObject({ status: "failed", cursorTo: CURSOR });
  });
});

describe("rodada da atualização do Pipedrive: falha geral do Pipedrive", () => {
  const cases: [string, () => Error][] = [
    ["500", () => new PipedriveError("Pipedrive respondeu 500 em /v1/organizations", 500)],
    ["503", () => new PipedriveError("Pipedrive respondeu 503 em /v1/organizations", 503)],
    ["429 depois das esperas", () => new PipedriveError("Pipedrive respondeu 429 em /v1/organizations", 429)],
    ["403 (cota ou permissão)", () => new PipedriveError("Pipedrive respondeu 403 em /v1/organizations", 403)],
    ["402", () => new PipedriveError("Pipedrive respondeu 402 em /v1/organizations", 402)],
    ["409", () => new PipedriveError("Pipedrive respondeu 409 em /v1/organizations", 409)],
    ["rede ou timeout", () => new PipedriveError("Falha de rede ao chamar o Pipedrive em /v1/organizations")],
  ];

  it.each(cases)("%s: failed na hora, sem fila, sem tentativa e sem mexer no cursor", async (_name, error) => {
    const w = world({
      rows: { organizations: [org("o1", { updated_at: at("11:00") }), org("o2"), org("o3", { updated_at: at("13:10") })] },
      retry: [{ entity: "organizations", record_id: "o1", attempts: 2 }],
      fail: (c) => (c.body?.name === "Org o2" ? error() : null),
    });
    const r = await w.run();
    expect(r.status).toBe("failed");
    expect(r.reason).toMatch(/Pipedrive indisponível \(organizations o2\)/);
    // o1 (da fila) foi e saiu da fila; o2 parou a rodada; o3 não foi tentado
    expect(w.calls.map((c) => c.body?.name)).toEqual(["Org o1", "Org o2"]);
    expect(w.retry.size).toBe(0);
    expect(r.errors).toEqual([]);
    expect(w.events.some((e) => e.startsWith("cursors"))).toBe(false);
    expect(w.runs[0].finished).toMatchObject({ status: "failed", cursorTo: CURSOR });
  });

  it("registro da fila numa falha geral: não soma tentativa", async () => {
    const w = world({
      rows: { organizations: [org("o1", { updated_at: at("11:00") })] },
      retry: [{ entity: "organizations", record_id: "o1", attempts: 2 }],
      fail: () => new PipedriveError("Pipedrive respondeu 502 em /v1/organizations", 502),
    });
    const r = await w.run();
    expect(r.status).toBe("failed");
    expect([...w.retry.values()].map((x) => [x.record_id, x.attempts])).toEqual([["o1", 2]]);
  });

  it("falha geral depois de uma entidade terminada: o cursor dela fica, o da entidade que falhou não anda", async () => {
    const w = world({
      rows: { organizations: [org("o1")], persons: [person("p1", "o1")] },
      fail: (c) => (c.path === "/v1/persons" ? new PipedriveError("Pipedrive respondeu 503 em /v1/persons", 503) : null),
    });
    const r = await w.run();
    expect(r.status).toBe("failed");
    expect(w.cursorOf("organizations")).toEqual({ at: START_CURSOR });
    expect(w.cursorOf("persons")).toEqual({ at: CURSOR });
    expect(w.retry.size).toBe(0);
  });

  it("falha geral na exclusão: failed, o vínculo fica e nada vai para a fila", async () => {
    const w = world({
      rows: { deals: [deal("d1", null, { deleted_at: at("13:00") })] },
      links: [["deals", "d1", "77"]],
      fail: () => new PipedriveError("Pipedrive respondeu 500 em /v1/deals/77", 500),
    });
    const r = await w.run();
    expect(r.status).toBe("failed");
    expect(w.pdOf("deals", "d1")).toBe("77");
    expect(w.retry.size).toBe(0);
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
      fail: (c) => (c.path === "/v1/persons" ? new PipedriveError("Pipedrive respondeu 400 em /v1/persons", 400) : null),
    });
    const r = await w.run();
    expect(paths(w.calls)).toEqual(["post /v1/persons"]);
    expect([...w.retry.values()].map((x) => [x.entity, x.record_id, x.attempts])).toEqual([
      ["persons", "p1", 1],
      ["deals", "d1", 1],
    ]);
    expect(r.errors).toEqual([{ entity: "persons", id: "p1", reason: expect.stringMatching(/400/) }]);
    expect(r.counters.deals.errors).toBe(0);
    expect(w.retry.get("deals:d1")?.last_error).toMatch(/pessoa ainda sem id no Pipedrive.*persons p1: .*400/);
  });
});

describe("rodada da atualização do Pipedrive: relacionado na lixeira do CRM", () => {
  it("vira vínculo vazio e o registro vai: put do negócio já no Pipedrive, post do novo pelo outro vínculo", async () => {
    const w = world({
      rows: {
        organizations: [org("o1", { updated_at: at("11:00") })],
        // foi para a lixeira antes do cursor: já foi apagada no Pipedrive e perdeu o vínculo
        persons: [person("p1", null, { updated_at: at("11:00"), deleted_at: at("11:00") })],
        deals: [
          deal("d1", "p1", { status: "won" }),
          deal("d2", "p1", { organization_id: "o1", updated_at: at("13:10") }),
        ],
      },
      links: [
        ["organizations", "o1", "500"],
        ["deals", "d1", "900"],
      ],
    });
    const r = await w.run();
    expect(r.status).toBe("done");
    expect(paths(w.calls)).toEqual(["put /v1/deals/900", "post /v1/deals"]);
    // sem pessoa nem organização vivas: a atualização vai sem as duas chaves (o ganho chega ao Pipedrive)
    expect(w.calls[0].body).toMatchObject({ status: "won" });
    expect(w.calls[0].body).not.toHaveProperty("person_id");
    expect(w.calls[0].body).not.toHaveProperty("org_id");
    expect(w.calls[1].body).toMatchObject({ person_id: null, org_id: 500 });
    expect(w.retry.size).toBe(0);
    expect(r.errors).toEqual([]);
  });

  it("relacionado que foi para a lixeira nesta rodada: apagado no Pipedrive e o dependente vai sem ele", async () => {
    const w = world({
      rows: {
        persons: [person("p1", null, { deleted_at: at("13:00") })],
        deals: [deal("d1", "p1", { status: "won", organization_id: "o1", updated_at: at("13:30") })],
      },
      links: [
        ["organizations", "o1", "500"],
        ["persons", "p1", "201"],
        ["deals", "d1", "900"],
      ],
    });
    await w.run();
    expect(paths(w.calls)).toEqual(["del /v1/persons/201", "put /v1/deals/900"]);
    expect(w.calls[1].body).toMatchObject({ status: "won", person_id: null, org_id: 500 });
    expect(w.retry.size).toBe(0);
  });

  it("registro novo só com relacionados na lixeira: não dá para criar (erro do registro, na fila)", async () => {
    const w = world({
      rows: {
        persons: [person("p1", null, { updated_at: at("11:00"), deleted_at: at("11:00") })],
        deals: [deal("d1", "p1")],
      },
    });
    const r = await w.run();
    expect(w.calls).toEqual([]);
    expect(r.errors).toEqual([
      { entity: "deals", id: "d1", reason: "negócio sem pessoa nem organização (o Pipedrive exige um dos dois)" },
    ]);
    expect(w.retry.get("deals:d1")?.attempts).toBe(1);
  });

  it("nível além do sob demanda: o relacionado na lixeira também vira vínculo vazio", async () => {
    const w = world({
      rows: {
        organizations: [org("o1", { updated_at: at("11:00"), deleted_at: at("11:00") })],
        persons: [person("p1", "o1", { updated_at: at("11:00") })],
        deals: [deal("d1", "p1", { updated_at: at("11:00") })],
        activities: [activity("a1", "d1")],
      },
    });
    const r = await w.run();
    // atividade → negócio → pessoa: a organização da pessoa está na lixeira, então a pessoa vai sem ela
    expect(paths(w.calls)).toEqual(["post /v1/persons", "post /v1/deals", "post /v1/activities"]);
    expect(w.calls[0].body).toMatchObject({ org_id: null });
    expect(w.retry.size).toBe(0);
    expect(r.errors).toEqual([]);
  });
});

describe("rodada da atualização do Pipedrive: registro criado de novo no Pipedrive", () => {
  it("apagado lá (404): atividades e anotações dele que tinham id vão para a fila e saem na rodada seguinte", async () => {
    const w = world({
      rows: {
        deals: [deal("d1", "p1", { title: "Negócio novo" })],
        activities: [
          activity("a1", "d1", { updated_at: at("11:00"), done: true }),
          activity("a2", "d1", { updated_at: at("11:00") }), // nunca foi enviada: não é da cópia antiga
          activity("a3", "d1", { updated_at: at("11:00"), deleted_at: at("11:00") }),
        ],
        notes: [note("n1", "d1", { updated_at: at("11:00") })],
      },
      links: [
        ["persons", "p1", "201"],
        ["deals", "d1", "900"],
        ["activities", "a1", "301"],
        ["activities", "a3", "303"],
        ["notes", "n1", "401"],
      ],
      fail: (c) =>
        c.method === "put" ? new PipedriveError(`Pipedrive respondeu 404 em ${c.path}`, 404) : null,
    });
    await w.run();
    expect(paths(w.calls)).toEqual(["put /v1/deals/900", "post /v1/deals"]);
    expect([...w.retry.values()].map((x) => [x.entity, x.record_id, x.attempts])).toEqual([
      ["activities", "a1", 0],
      ["notes", "n1", 0],
    ]);

    w.setClock("2026-11-09T15:00:00.000Z");
    w.calls.length = 0;
    const r2 = await w.run();
    expect(paths(w.calls)).toEqual([
      "put /v1/activities/301",
      "post /v1/activities",
      "put /v1/notes/401",
      "post /v1/notes",
    ]);
    expect(w.calls[1].body).toMatchObject({ deal_id: 100 });
    expect(w.calls[3].body).toMatchObject({ deal_id: 100 });
    expect(w.retry.size).toBe(0);
    expect(r2.errors).toEqual([]);
  });

  it("restaurado da lixeira depois de apagado no Pipedrive: a anotação dele vai de novo, ligada à cópia nova", async () => {
    const w = world({
      rows: {
        deals: [deal("d1", "p1", { deleted_at: at("13:00") })],
        notes: [note("n1", "d1", { updated_at: at("11:00") })],
      },
      links: [
        ["persons", "p1", "201"],
        ["deals", "d1", "900"],
        ["notes", "n1", "401"],
      ],
      fail: (c) => (c.path === "/v1/notes/401" ? new PipedriveError("Pipedrive respondeu 404 em /v1/notes/401", 404) : null),
    });
    await w.run();
    expect(paths(w.calls)).toEqual(["del /v1/deals/900"]);

    w.tables.deals[0] = { ...w.tables.deals[0], deleted_at: null, updated_at: at("14:30") };
    w.setClock("2026-11-09T15:00:00.000Z");
    w.calls.length = 0;
    await w.run();
    expect(paths(w.calls)).toEqual(["post /v1/deals"]);
    expect(w.retry.get("notes:n1")).toMatchObject({ attempts: 0 });

    w.setClock("2026-11-09T16:00:00.000Z");
    w.calls.length = 0;
    await w.run();
    expect(paths(w.calls)).toEqual(["put /v1/notes/401", "post /v1/notes"]);
    expect(w.calls[1].body).toMatchObject({ deal_id: 100 });
    expect(w.retry.size).toBe(0);
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
      fail: (c) =>
        down && c.path === "/v1/persons" ? new PipedriveError("Pipedrive respondeu 400 em /v1/persons: e-mail inválido", 400) : null,
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
