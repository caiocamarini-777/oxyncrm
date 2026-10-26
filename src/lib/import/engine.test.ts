import { describe, expect, it, vi } from "vitest";
import { PipedriveAuthError } from "./pipedrive/client";
import type { PdItem, PdPageEntity } from "./pipedrive/types";
import {
  LEASE_SECONDS,
  STEPS,
  createDryRunStore,
  runImportSlice,
  runImportToEnd,
  type CustomFieldDef,
  type ExistingPipeline,
  type ImportCache,
  type ImportSource,
  type ImportStore,
  type JobRecord,
  type LogItem,
  type UpsertCounts,
} from "./engine";

vi.mock("server-only", () => ({}));

const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";
const U1 = "00000000-0000-4000-8000-000000000101";
const U2 = "00000000-0000-4000-8000-000000000102";
const U3 = "00000000-0000-4000-8000-000000000103";
const P1 = "00000000-0000-4000-8000-000000000201";
const S11 = "00000000-0000-4000-8000-000000000211";

const MAPPINGS = {
  pipelines: {
    "1": { companyId: A, pipelineId: P1, stages: { "11": S11 } },
    "2": { companyId: B, pipelineId: null, stages: {} },
    "3": { companyId: B, pipelineId: null, stages: {} },
  },
  users: { "100": U1, "101": U2, "102": U3 },
  fallbackOwnerId: U1,
  leadLabelCompany: { "10": B },
  defaultCompanyId: A,
  customFields: {
    abc: { target: "custom", customFieldKey: "temperatura" },
    mrr: { target: "native:mrr" },
  },
  ignorePipelines: ["3"],
};

const DATA: Partial<Record<PdPageEntity, PdItem[]>> = {
  deals: [
    { id: 1, title: "D1", pipeline_id: 1, stage_id: 11, status: "open", person_id: 1, org_id: 1, user_id: 100, abc: 2 },
    { id: 2, title: "D2", pipeline_id: 2, stage_id: 21, status: "won", person_id: 1, user_id: 101, abc: 1 },
    { id: 3, title: "D3", pipeline_id: 3, stage_id: 31, status: "open", person_id: 9, user_id: 102 },
    { id: 4, title: "D4", pipeline_id: 4, stage_id: 41, status: "open", user_id: 102 },
  ],
  leads: [{ id: "l1", title: "L1", label_ids: [10], person_id: 2, owner_id: 100 }],
  archivedLeads: [{ id: "la1", title: "LA1", label_ids: [], person_id: 3, owner_id: 100 }],
  organizations: [{ id: 1, name: "Org 1", owner_id: 100 }],
  persons: [
    { id: 1, name: "Pessoa 1", owner_id: 100 },
    { id: 2, name: "Pessoa 2", owner_id: 100 },
    { id: 3, name: "Pessoa 3", owner_id: 100 },
    { id: 4, name: "", owner_id: 100 },
  ],
  activities: [
    { id: 1, type: "call", subject: "A1", deal_id: 1, person_id: 1, user_id: 100 },
    { id: 2, type: "call", subject: "A2", person_id: 1, user_id: 100 },
    { id: 3, type: "call", subject: "A3", lead_id: "l1", user_id: 100 },
    { id: 4, type: "call", subject: "A4", deal_id: 3, person_id: 1, user_id: 100 },
    { id: 5, type: "call", subject: "A5", deal_id: 4, user_id: 100 },
    { id: 6, type: "call", subject: "A6", person_id: 2, org_id: 1, user_id: 100 },
  ],
  notes: [
    { id: 1, content: "N1", deal_id: 2, user_id: 100 },
    { id: 2, content: "N2", deal_id: 3, person_id: 1, user_id: 100 },
  ],
  products: [],
};

const STAGES: PdItem[] = [
  { id: 22, name: "Ganho", pipeline_id: 2, order_nr: 2, deal_probability: 90 },
  { id: 21, name: "Novo", pipeline_id: 2, order_nr: 1, deal_probability: 10 },
  { id: 31, name: "X", pipeline_id: 3, order_nr: 1 },
];

type FakeOpts = { pageSize?: number; stages?: PdItem[]; failOn?: (entity: PdPageEntity, start: number) => Error | null };

function fakeClient(data = DATA, opts: FakeOpts = {}) {
  const size = opts.pageSize ?? 2;
  const calls: string[] = [];
  const client: ImportSource = {
    async page(entity, start) {
      calls.push(`${entity}@${start}`);
      const err = opts.failOn?.(entity, start);
      if (err) throw err;
      const all = data[entity] ?? [];
      const items = all.slice(start, start + size);
      return { items, nextStart: start + size < all.length ? start + size : null };
    },
    pipelines: async () => [{ id: 1, name: "HARPIX" }, { id: 2, name: " OXYN " }, { id: 3, name: "IGN" }],
    stages: async () => opts.stages ?? STAGES,
    activityTypes: async () => [{ key_string: "call", name: "Ligação" }],
    leadLabels: async () => [{ id: 10, name: "OXYN" }],
    dealFields: async () => [
      { key: "abc", name: "Temperatura", field_type: "enum", options: [{ id: 1, label: "Quente" }, { id: 2, label: "Frio" }] },
      { key: "mrr", name: "MRR contratado", field_type: "monetary" },
    ],
    personFields: async () => [],
    organizationFields: async () => [],
  };
  return { client, calls };
}

type FakePipe = ExistingPipeline & { company_id: string; name: string };
type StoreInit = {
  job?: Partial<JobRecord>;
  members?: Record<string, string[]>;
  defs?: CustomFieldDef[];
  pipelines?: FakePipe[];
};

function fakeStore(init: StoreInit = {}) {
  const members = init.members ?? { [A]: [U1, U2, U3], [B]: [U1, U2] };
  const job: JobRecord = { id: "job", status: "draft", mappings: MAPPINGS, cursor: {}, counters: {}, ...init.job };
  const lease: { owner: string | null; until: number; claims: number[] } = { owner: null, until: 0, claims: [] };
  const events: string[] = [];
  const upserts: { entity: string; rows: Record<string, unknown>[] }[] = [];
  const logs: LogItem[] = [];
  const defs: CustomFieldDef[] = init.defs ?? [
    { id: "def-a", company_id: A, entity: "deals", key: "temperatura", type: "select", options: ["Quente"] },
  ];
  const pipelines: FakePipe[] = init.pipelines ?? [];
  let seq = 0;
  const bump = (entity: string, c: Partial<UpsertCounts>) => {
    const cur = { ...(job.counters[entity] ?? {}) };
    for (const [k, v] of Object.entries(c)) cur[k] = (cur[k] ?? 0) + (v ?? 0);
    job.counters = { ...job.counters, [entity]: cur };
  };
  const store: ImportStore = {
    async loadJob() {
      return structuredClone(job);
    },
    async claim(_id, token, seconds) {
      lease.claims.push(seconds);
      if (job.status !== "draft" && job.status !== "running") return false;
      if (lease.owner && lease.owner !== token && lease.until > Date.now()) return false;
      lease.owner = token;
      lease.until = Date.now() + seconds * 1000;
      return true;
    },
    async release(_id, token) {
      if (lease.owner === token) lease.owner = null;
    },
    async start() {
      if (job.status !== "draft" && job.status !== "running") return false;
      job.status = "running";
      events.push("start");
      return true;
    },
    async saveCursor(_id, token, cursor) {
      if (lease.owner !== token) return false;
      if (job.status !== "running" && job.status !== "paused") return false;
      job.cursor = structuredClone(cursor);
      return job.status === "running";
    },
    async finish(_id, token, status) {
      if (lease.owner !== token || job.status !== "running") return;
      job.status = status;
      events.push(`finish:${status}`);
    },
    async upsert(_id, entity, rows) {
      if (job.status !== "running") throw new Error("OXYN_IMPORT_NOT_RUNNING");
      events.push(`upsert:${entity}`);
      upserts.push({ entity, rows });
      return { created: rows.length, updated: 0, skipped: 0, unchanged: 0, errors: 0 };
    },
    async count(_id, entity, counts) {
      bump(entity, counts);
    },
    async log(_id, items) {
      logs.push(...items);
      for (const i of items) bump(i.entity, { [i.reason.startsWith("aviso:") ? "warnings" : "errors"]: 1 } as Partial<UpsertCounts>);
    },
    async rebuildDerivatives() {
      events.push("rebuild");
    },
    async members(companyIds) {
      const active: Record<string, string[]> = {};
      for (const c of companyIds) active[c] = members[c] ?? [];
      return { active, userNames: { [U1]: "Ana", [U2]: "Bruno", [U3]: "Carla" }, companyNames: { [A]: "Alfa", [B]: "Beta" } };
    },
    async customFieldDefs() {
      return structuredClone(defs);
    },
    async createCustomFieldDef(def) {
      events.push(`def:${def.company_id === A ? "A" : "B"}:${def.entity}:${def.key}:${def.type}`);
      defs.push({ ...def, id: `def-${++seq}` });
    },
    async setCustomFieldOptions(id, options) {
      events.push(`options:${id}:${options.join("|")}`);
    },
    async findPipeline(companyId, name) {
      return structuredClone(pipelines.find((p) => p.company_id === companyId && p.name === name) ?? null);
    },
    async createPipeline(companyId, name) {
      const id = `pipe-${++seq}`;
      pipelines.push({ id, company_id: companyId, name, archived: false, stages: [] });
      events.push(`pipeline:${name}`);
      return id;
    },
    async createStage(pipelineId, _companyId, s) {
      const id = `stage-${++seq}`;
      pipelines.find((p) => p.id === pipelineId)!.stages.push({ id, name: s.name, position: s.position, archived: false });
      events.push(`stage:${s.name}:${s.position}:${s.probability}`);
      return id;
    },
  };
  return { store, job, lease, events, upserts, logs, defs };
}

const rowsOf = (upserts: { entity: string; rows: Record<string, unknown>[] }[], entity: string) =>
  upserts.filter((u) => u.entity === entity).flatMap((u) => u.rows);
const ab = (c: unknown) => (c === A ? "A" : c === B ? "B" : String(c));
const structural = (events: string[]) => events.filter((e) => e.startsWith("pipeline:") || e.startsWith("stage:"));

describe("motor de importação", () => {
  it("tem a ordem fixa de etapas", () => {
    expect(STEPS).toEqual([
      "index", "users_check", "custom_fields", "products", "organizations", "persons", "leads",
      "archived_leads", "deals", "derivatives", "activities", "notes", "done",
    ]);
  });

  it("fatia com orçamento curto para no meio e grava o cursor; a seguinte continua sem repetir a página", async () => {
    const { client, calls } = fakeClient();
    const f = fakeStore();
    const deps = { client, store: f.store };
    let r = await runImportSlice("job", { budgetMs: 0, deps });
    expect(r).toMatchObject({ status: "running", done: false, step: "index" });
    for (let i = 0; i < 30 && !(f.job.cursor.step === "persons" && f.job.cursor.start === 2); i++) {
      r = await runImportSlice("job", { budgetMs: 0, deps });
    }
    expect(f.job.cursor).toMatchObject({ step: "persons", start: 2 });
    expect(rowsOf(f.upserts, "persons").map((p) => p.external_id)).toEqual(["1", "1", "2"]);

    r = await runImportSlice("job", { budgetMs: 0, deps });
    expect(r.step).toBe("leads");
    expect(calls.filter((c) => c.startsWith("persons@"))).toEqual(["persons@0", "persons@2"]);
    const persons = rowsOf(f.upserts, "persons");
    expect(persons.map((p) => `${p.external_id}:${ab(p.company_id)}`)).toEqual(["1:A", "1:B", "2:B", "3:A"]);
    expect(f.logs).toContainEqual({ entity: "persons", external_id: "4", reason: "pessoa sem nome" });
  });

  it("roda até o fim respeitando a ordem e as regras de empresa", async () => {
    const { client } = fakeClient();
    const f = fakeStore();
    const progress: string[] = [];
    const r = await runImportToEnd("job", { client, store: f.store }, (s) => progress.push(s.step));
    expect(r).toMatchObject({ status: "done", done: true, step: "done" });
    expect(progress.at(-1)).toBe("done");

    const order = f.events.filter((e) => e.startsWith("upsert:") || e === "rebuild");
    const firstIdx = (e: string) => order.indexOf(e);
    expect(firstIdx("upsert:organizations")).toBeLessThan(firstIdx("upsert:persons"));
    expect(firstIdx("upsert:persons")).toBeLessThan(firstIdx("upsert:leads"));
    expect(firstIdx("upsert:leads")).toBeLessThan(firstIdx("upsert:deals"));
    expect(order.lastIndexOf("upsert:deals")).toBeLessThan(firstIdx("rebuild"));
    expect(firstIdx("rebuild")).toBeLessThan(firstIdx("upsert:activities"));
    expect(order.lastIndexOf("upsert:activities")).toBeLessThan(firstIdx("upsert:notes"));
    expect(f.events.at(-1)).toBe("finish:done");

    // funil 2 criado com as etapas na ordem; funil ignorado não é criado
    expect(structural(f.events)).toEqual(["pipeline:OXYN", "stage:Novo:0:10", "stage:Ganho:1:90"]);
    // negócios: funil ignorado conta como pulado; funil sem mapeamento é erro; dono do negócio não é trocado
    const deals = rowsOf(f.upserts, "deals");
    expect(deals.map((d) => d.external_id)).toEqual(["1", "2"]);
    expect(deals[1]).toMatchObject({ company_id: B, owner_id: U2, custom_fields: { temperatura: "Quente" } });
    expect(String(deals[1].pipeline_id)).toMatch(/^pipe-/);
    expect(String(deals[1].stage_id)).toMatch(/^stage-/);
    expect(f.job.counters.deals).toMatchObject({ created: 2, skipped: 1, errors: 1 });
    expect(f.logs).toContainEqual({ entity: "deals", external_id: "4", reason: "funil 4 sem mapeamento" });

    // leads e arquivados
    expect(rowsOf(f.upserts, "leads").map((l) => `${l.external_id}:${l.status}:${ab(l.company_id)}`))
      .toEqual(["l1:open:B", "la1:archived:A"]);
    // atividades: empresa pelo negócio, pelo lead ou pelas empresas da pessoa (organização só sem pessoa);
    // negócio de funil ignorado (4) ou sem mapeamento (5) pula a atividade
    expect(rowsOf(f.upserts, "activities").map((a) => `${a.external_id}:${ab(a.company_id)}`))
      .toEqual(["1:A", "2:A", "2:B", "3:B", "6:B"]);
    expect(f.job.counters.activities).toMatchObject({ created: 5, skipped: 2 });
    expect(rowsOf(f.upserts, "notes").map((n) => `${n.external_id}:${ab(n.company_id)}`)).toEqual(["1:B"]);
    expect(f.job.counters.notes).toMatchObject({ created: 1, skipped: 1 });
    expect(f.logs.filter((l) => l.entity === "activities" || l.entity === "notes")).toEqual([]);
    // contadores não recebem errors pelo motor (o banco já conta)
    expect(f.job.counters.persons).toEqual({ created: 4, updated: 0, skipped: 0, unchanged: 0, errors: 1 });
  });

  it("organização entra na empresa da atividade só quando não há pessoa", async () => {
    const data = { ...DATA, activities: [{ id: 7, type: "call", subject: "A7", org_id: 1, user_id: 100 }] };
    const { client } = fakeClient(data);
    const f = fakeStore();
    await runImportToEnd("job", { client, store: f.store });
    expect(rowsOf(f.upserts, "activities").map((a) => `${a.external_id}:${ab(a.company_id)}`)).toEqual(["7:A"]);
  });

  it("cria campos personalizados com o tipo mapeado e reaproveita os existentes", async () => {
    const { client } = fakeClient();
    const f = fakeStore();
    await runImportToEnd("job", { client, store: f.store });
    expect(f.events.filter((e) => e.startsWith("def:") || e.startsWith("options:"))).toEqual([
      "options:def-a:Quente|Frio",
      "def:A:leads:temperatura:select",
      "def:B:deals:temperatura:select",
      "def:B:leads:temperatura:select",
    ]);
    expect(f.defs.find((d) => d.company_id === B && d.entity === "deals")?.options).toEqual(["Quente", "Frio"]);
    expect(f.job.cursor.cache!.fieldTypes).toEqual({
      "0:deals:temperatura": "select",
      "0:leads:temperatura": "select",
      "1:deals:temperatura": "select",
      "1:leads:temperatura": "select",
    });
  });

  it("tipo do campo é o da empresa e entidade de cada registro", async () => {
    const { client } = fakeClient();
    const f = fakeStore({
      defs: [{ id: "def-a", company_id: A, entity: "deals", key: "temperatura", type: "multiselect", options: ["Quente", "Frio"] }],
    });
    await runImportToEnd("job", { client, store: f.store });
    const deals = rowsOf(f.upserts, "deals");
    expect(deals[0]).toMatchObject({ company_id: A, custom_fields: { temperatura: ["Frio"] } });
    expect(deals[1]).toMatchObject({ company_id: B, custom_fields: { temperatura: "Quente" } });
  });

  it("guarda só ids compactos no cache do cursor", async () => {
    const { client } = fakeClient();
    const f = fakeStore();
    for (let i = 0; i < 10 && f.job.cursor.step !== "custom_fields"; i++) {
      await runImportSlice("job", { budgetMs: 0, deps: { client, store: f.store } });
    }
    const cache = f.job.cursor.cache!;
    expect(cache.companies).toEqual([A, B]);
    expect(cache.deals).toEqual({ "1": 0, "2": 1 });
    expect(cache.ignoredDeals).toEqual({ "3": 1, "4": 1 });
    expect(cache.dealOwners).toEqual({ "100": [0], "101": [1] });
    expect(cache.leads).toEqual({ l1: 1, la1: 0 });
    expect(cache.contacts).toEqual({ "person:1": [0, 1], "org:1": [0], "person:2": [1], "person:3": [0] });
  });

  it("PipedriveAuthError marca o job como failed com o erro", async () => {
    const { client } = fakeClient(DATA, { failOn: (e) => (e === "persons" ? new PipedriveAuthError() : null) });
    const f = fakeStore();
    const r = await runImportToEnd("job", { client, store: f.store });
    expect(r).toMatchObject({ status: "failed", done: true, step: "persons" });
    expect(f.logs.at(-1)).toMatchObject({ entity: "job", reason: expect.stringContaining("401") });
    expect(f.events.at(-1)).toBe("finish:failed");
    expect(f.lease.owner).toBeNull();
  });

  it("erro genérico relança e deixa o job retomável do último cursor", async () => {
    let fail = true;
    const { client } = fakeClient(DATA, {
      failOn: (e, start) => (e === "persons" && start === 2 && fail ? new Error("rede caiu") : null),
    });
    const f = fakeStore();
    await expect(runImportToEnd("job", { client, store: f.store })).rejects.toThrow("rede caiu");
    expect(f.job.status).toBe("running");
    expect(f.job.cursor).toMatchObject({ step: "persons", start: 2 });
    expect(f.lease.owner).toBeNull();

    fail = false;
    const r = await runImportToEnd("job", { client, store: f.store });
    expect(r.status).toBe("done");
    expect(rowsOf(f.upserts, "persons").map((p) => p.external_id)).toEqual(["1", "1", "2", "3"]);
  });

  it("users_check exige acesso do dono de cada negócio à empresa do funil e do dono padrão a todas", async () => {
    const { client, calls } = fakeClient();
    const f = fakeStore({ members: { [A]: [U1, U2], [B]: [] } });
    const r = await runImportToEnd("job", { client, store: f.store });
    expect(r).toMatchObject({ status: "failed", done: true, step: "users_check" });
    const reason = f.logs.at(-1)!.reason;
    expect(reason).toContain("Ana (Beta)");
    expect(reason).toContain("Bruno (Beta)");
    expect(reason).not.toContain("Alfa");
    // Carla só é dona de negócios de funil ignorado ou sem mapeamento: não é exigida
    expect(reason).not.toContain("Carla");
    expect(f.upserts).toEqual([]);
    expect(calls.every((c) => /^(deals|leads|archivedLeads)@/.test(c))).toBe(true);
  });

  it("dono sem acesso só é trocado em cópia de contato em empresa secundária, com aviso agregado", async () => {
    const data = {
      persons: [
        { id: 1, name: "P1", owner_id: 102 },
        { id: 2, name: "P2", owner_id: 102 },
        { id: 3, name: "P3", owner_id: 102 },
      ],
    };
    const cache: ImportCache = {
      companies: [A, B], deals: {}, ignoredDeals: {}, leads: {}, dealOwners: {},
      contacts: { "person:1": [0, 1], "person:2": [0, 1], "person:3": [1, 0] },
    };
    const { client } = fakeClient(data);
    const f = fakeStore({ job: { status: "running", cursor: { step: "persons", start: 0, cache } } });
    await runImportToEnd("job", { client, store: f.store });
    expect(rowsOf(f.upserts, "persons").map((p) => `${p.external_id}:${ab(p.company_id)}:${p.owner_id === U1 ? "padrão" : "Carla"}`))
      .toEqual(["1:A:Carla", "1:B:padrão", "2:A:Carla", "2:B:padrão", "3:B:Carla", "3:A:Carla"]);
    const warnings = f.logs.filter((l) => l.entity === "persons");
    expect(warnings).toEqual([
      { entity: "persons", external_id: null, reason: "aviso: Carla sem acesso à empresa Beta; dono padrão usado em 2 registros" },
    ]);
    expect(f.job.cursor.cache!.ownerSwaps).toBeUndefined();
  });

  it("mapeamentos inválidos marcam o job como failed", async () => {
    const { client } = fakeClient();
    const f = fakeStore({ job: { mappings: { pipelines: {} } } });
    const r = await runImportSlice("job", { deps: { client, store: f.store } });
    expect(r.status).toBe("failed");
    expect(f.logs.at(-1)!.reason).toContain("Mapeamentos inválidos");
  });

  it("job pausado, concluído ou com falha não roda", async () => {
    for (const status of ["paused", "done", "failed"] as const) {
      const { client, calls } = fakeClient();
      const f = fakeStore({ job: { status, cursor: { step: "persons", start: 0 } } });
      const r = await runImportSlice("job", { deps: { client, store: f.store } });
      expect(r).toMatchObject({ status, done: true, step: "persons" });
      expect(calls).toEqual([]);
      expect(f.events).toEqual([]);
    }
  });

  describe("concessão do job", () => {
    it("toma a concessão de 120s e a libera no fim", async () => {
      const { client } = fakeClient();
      const f = fakeStore();
      await runImportSlice("job", { budgetMs: 0, deps: { client, store: f.store, token: () => "t1" } });
      expect(LEASE_SECONDS).toBe(120);
      expect(f.lease.claims).toEqual([120]);
      expect(f.lease.owner).toBeNull();
    });

    it("com a concessão de outra fatia não roda e devolve em andamento", async () => {
      const { client, calls } = fakeClient();
      const f = fakeStore({ job: { status: "running", cursor: { step: "persons", start: 0 } } });
      f.lease.owner = "outra";
      f.lease.until = Date.now() + 60_000;
      const r = await runImportSlice("job", { deps: { client, store: f.store } });
      expect(r).toMatchObject({ status: "running", done: false, busy: true, step: "persons" });
      expect(calls).toEqual([]);
      expect(f.events).toEqual([]);
      expect(f.lease.owner).toBe("outra");
      await expect(runImportToEnd("job", { client, store: f.store })).rejects.toThrow("Outra execução");
    });

    it("concessão vencida é tomada", async () => {
      const { client } = fakeClient();
      const f = fakeStore();
      f.lease.owner = "outra";
      f.lease.until = Date.now() - 1;
      const r = await runImportToEnd("job", { client, store: f.store });
      expect(r.status).toBe("done");
    });

    it("concessão perdida no meio da fatia: o cursor não é gravado e a fatia para", async () => {
      const { client, calls } = fakeClient();
      const f = fakeStore();
      const count = f.store.count;
      f.store.count = async (id, entity, c) => {
        await count(id, entity, c);
        if (entity === "persons") f.lease.owner = "outra";
      };
      await runImportSlice("job", { deps: { client, store: f.store } });
      expect(f.job.cursor).toMatchObject({ step: "persons", start: 0 });
      expect(calls).not.toContain("persons@2");
      expect(f.job.status).toBe("running");
    });
  });

  it("pausa no meio da fatia para sem erro e sem sobrescrever o status", async () => {
    const { client } = fakeClient(DATA, {
      failOn: (e, start) => {
        if (e === "persons" && start === 2) f.job.status = "paused";
        return null;
      },
    });
    const f = fakeStore();
    const r = await runImportSlice("job", { deps: { client, store: f.store } });
    expect(r).toMatchObject({ status: "paused", done: true, step: "persons" });
    expect(f.job.cursor).toMatchObject({ step: "persons", start: 2 });
  });

  it("pausa entre páginas: guarda o progresso e não busca a página seguinte", async () => {
    const { client, calls } = fakeClient();
    const f = fakeStore();
    const count = f.store.count;
    f.store.count = async (id, entity, c) => {
      await count(id, entity, c);
      if (entity === "persons") f.job.status = "paused";
    };
    const r = await runImportSlice("job", { deps: { client, store: f.store } });
    expect(r).toMatchObject({ status: "paused", done: true, step: "persons" });
    expect(f.job.cursor).toMatchObject({ step: "persons", start: 2 });
    expect(calls).not.toContain("persons@2");
  });

  it("rodar de novo a partir do mesmo cursor não duplica páginas nem refaz o índice", async () => {
    const { client, calls } = fakeClient();
    const f = fakeStore({ job: { status: "running", cursor: { step: "persons", start: 2 } } });
    await runImportSlice("job", { budgetMs: 0, deps: { client, store: f.store } });
    const snapshot = structuredClone(f.job.cursor);
    f.job.cursor = { step: "persons", start: 2 };
    await runImportSlice("job", { budgetMs: 0, deps: { client, store: f.store } });
    expect(f.job.cursor).toEqual(snapshot);
    // sem cache, a etapa já passou do índice: não volta a ele e manda os contatos para a empresa padrão
    expect(calls).toEqual(["persons@2", "persons@2"]);
    expect(rowsOf(f.upserts, "persons").map((p) => `${p.external_id}:${ab(p.company_id)}`)).toEqual(["3:A", "3:A"]);
  });

  describe("funis criados na importação", () => {
    it("rodar custom_fields de novo reaproveita funil e etapas", async () => {
      const { client } = fakeClient();
      const f = fakeStore();
      await runImportToEnd("job", { client, store: f.store });
      const before = structuredClone(f.job.cursor.cache!.pipelines);
      const events = f.events.length;
      f.job.status = "running";
      f.job.cursor = { step: "custom_fields", start: 0, cache: f.job.cursor.cache };
      await runImportSlice("job", { budgetMs: 0, deps: { client, store: f.store } });
      expect(f.job.cursor.step).toBe("products");
      expect(f.job.cursor.cache!.pipelines).toEqual(before);
      expect(structural(f.events.slice(events))).toEqual([]);
      expect(f.events.slice(events).filter((e) => e.startsWith("def:"))).toEqual([]);
    });

    it("funil arquivado com o mesmo nome não é reaproveitado", async () => {
      const { client } = fakeClient();
      const f = fakeStore({ pipelines: [{ id: "old", company_id: B, name: "OXYN", archived: true, stages: [] }] });
      await runImportToEnd("job", { client, store: f.store });
      expect(structural(f.events)).toEqual(["pipeline:OXYN (2)", "stage:Novo:0:10", "stage:Ganho:1:90"]);
    });

    it("funil existente: reaproveita etapa ativa e cria as novas depois da maior posição", async () => {
      const { client } = fakeClient();
      const f = fakeStore({
        pipelines: [{
          id: "act", company_id: B, name: "OXYN", archived: false,
          stages: [
            { id: "s-novo", name: "Novo", position: 0, archived: false },
            { id: "s-old", name: "Ganho", position: 5, archived: true },
          ],
        }],
      });
      await runImportToEnd("job", { client, store: f.store });
      expect(structural(f.events)).toEqual(["stage:Ganho (2):6:90"]);
      expect(rowsOf(f.upserts, "deals")[1]).toMatchObject({ pipeline_id: "act", stage_id: "s-novo" });
    });

    it("nomes de etapa que colidem depois de aparar ganham sufixo", async () => {
      const { client } = fakeClient(DATA, {
        stages: [...STAGES, { id: 23, name: "  Novo ", pipeline_id: 2, order_nr: 3 }, { id: 24, name: "x".repeat(70), pipeline_id: 2, order_nr: 4 }, { id: 25, name: "x".repeat(65), pipeline_id: 2, order_nr: 5 }],
      });
      const f = fakeStore();
      await runImportToEnd("job", { client, store: f.store });
      expect(structural(f.events)).toEqual([
        "pipeline:OXYN", "stage:Novo:0:10", "stage:Ganho:1:90", "stage:Novo (2):2:0",
        `stage:${"x".repeat(60)}:3:0`, `stage:${"x".repeat(56)} (2):4:0`,
      ]);
    });
  });

  it("modo de simulação mapeia sem gravar no armazenamento real", async () => {
    const { client } = fakeClient();
    const f = fakeStore();
    const dry = createDryRunStore(f.store);
    const r = await runImportToEnd("job", { client, store: dry.store });
    expect(r.status).toBe("done");
    expect(f.events).toEqual([]);
    expect(f.upserts).toEqual([]);
    expect(f.job.status).toBe("draft");
    expect(f.lease.claims).toEqual([]);
    expect(dry.rows.persons).toBe(4);
    expect(r.counters.persons).toMatchObject({ created: 4, errors: 1 });
  });
});
