import { describe, expect, it, vi } from "vitest";
import { PipedriveAuthError } from "./pipedrive/client";
import type { PdItem, PdPageEntity } from "./pipedrive/types";
import {
  STEPS,
  createDryRunStore,
  runImportSlice,
  runImportToEnd,
  type CustomFieldDef,
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
const P1 = "00000000-0000-4000-8000-000000000201";
const S11 = "00000000-0000-4000-8000-000000000211";

const MAPPINGS = {
  pipelines: {
    "1": { companyId: A, pipelineId: P1, stages: { "11": S11 } },
    "2": { companyId: B, pipelineId: null, stages: {} },
    "3": { companyId: B, pipelineId: null, stages: {} },
  },
  users: { "100": U1, "101": U2 },
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
    { id: 1, title: "D1", pipeline_id: 1, stage_id: 11, status: "open", person_id: 1, org_id: 1, user_id: 100 },
    { id: 2, title: "D2", pipeline_id: 2, stage_id: 21, status: "won", person_id: 1, user_id: 101, abc: 1 },
    { id: 3, title: "D3", pipeline_id: 3, stage_id: 31, status: "open", person_id: 9 },
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
  ],
  notes: [{ id: 1, content: "N1", deal_id: 2, user_id: 100 }],
  products: [],
};

type FakeOpts = { pageSize?: number; failOn?: (entity: PdPageEntity, start: number) => Error | null };

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
    stages: async () => [
      { id: 22, name: "Ganho", pipeline_id: 2, order_nr: 2, deal_probability: 90 },
      { id: 21, name: "Novo", pipeline_id: 2, order_nr: 1, deal_probability: 10 },
      { id: 31, name: "X", pipeline_id: 3, order_nr: 1 },
    ],
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

function fakeStore(init: Partial<JobRecord> = {}, members: Record<string, string[]> = { [A]: [U1, U2], [B]: [U1] }) {
  const job: JobRecord = { id: "job", status: "draft", mappings: MAPPINGS, cursor: {}, counters: {}, ...init };
  const events: string[] = [];
  const upserts: { entity: string; rows: Record<string, unknown>[] }[] = [];
  const logs: LogItem[] = [];
  const defs: CustomFieldDef[] = [{ id: "def-a", company_id: A, entity: "deals", key: "temperatura", type: "select", options: ["Quente"] }];
  const pipelines: { id: string; company_id: string; name: string; stages: { id: string; name: string }[] }[] = [];
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
    async start() {
      if (job.status !== "draft" && job.status !== "running") return false;
      job.status = "running";
      events.push("start");
      return true;
    },
    async saveCursor(_id, cursor) {
      if (job.status !== "running" && job.status !== "paused") return false;
      job.cursor = structuredClone(cursor);
      return job.status === "running";
    },
    async finish(_id, status) {
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
      return { active, userNames: { [U1]: "Ana", [U2]: "Bruno" }, companyNames: { [A]: "Alfa", [B]: "Beta" } };
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
      return pipelines.find((p) => p.company_id === companyId && p.name === name) ?? null;
    },
    async createPipeline(companyId, name) {
      const id = `pipe-${++seq}`;
      pipelines.push({ id, company_id: companyId, name, stages: [] });
      events.push(`pipeline:${name}`);
      return id;
    },
    async createStage(pipelineId, _companyId, s) {
      const id = `stage-${++seq}`;
      pipelines.find((p) => p.id === pipelineId)!.stages.push({ id, name: s.name });
      events.push(`stage:${s.name}:${s.position}:${s.probability}`);
      return id;
    },
  };
  return { store, job, events, upserts, logs, defs };
}

const rowsOf = (upserts: { entity: string; rows: Record<string, unknown>[] }[], entity: string) =>
  upserts.filter((u) => u.entity === entity).flatMap((u) => u.rows);

describe("motor de importação", () => {
  it("tem a ordem fixa de etapas", () => {
    expect(STEPS).toEqual([
      "users_check", "index", "custom_fields", "products", "organizations", "persons", "leads",
      "archived_leads", "deals", "derivatives", "activities", "notes", "done",
    ]);
  });

  it("fatia com orçamento curto para no meio e grava o cursor; a seguinte continua sem repetir a página", async () => {
    const { client, calls } = fakeClient();
    const f = fakeStore();
    const deps = { client, store: f.store };
    let r = await runImportSlice("job", { budgetMs: 0, deps });
    expect(r).toMatchObject({ status: "running", done: false });
    for (let i = 0; i < 30 && !(f.job.cursor.step === "persons" && f.job.cursor.start === 2); i++) {
      r = await runImportSlice("job", { budgetMs: 0, deps });
    }
    expect(f.job.cursor).toMatchObject({ step: "persons", start: 2 });
    expect(rowsOf(f.upserts, "persons").map((p) => p.external_id)).toEqual(["1", "1", "2"]);

    r = await runImportSlice("job", { budgetMs: 0, deps });
    expect(r.step).toBe("leads");
    expect(calls.filter((c) => c.startsWith("persons@"))).toEqual(["persons@0", "persons@2"]);
    // pessoa 1 em duas empresas; pessoa sem nome vira erro do mapeador
    const persons = rowsOf(f.upserts, "persons");
    expect(persons.map((p) => `${p.external_id}:${p.company_id === A ? "A" : "B"}`)).toEqual(["1:A", "1:B", "2:B", "3:A"]);
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
    expect(f.events.filter((e) => e.startsWith("pipeline:") || e.startsWith("stage:"))).toEqual([
      "pipeline:OXYN", "stage:Novo:0:10", "stage:Ganho:1:90",
    ]);
    // negócios: funil ignorado conta como pulado; dono sem acesso à empresa vira o dono padrão com aviso
    const deals = rowsOf(f.upserts, "deals");
    expect(deals.map((d) => d.external_id)).toEqual(["1", "2"]);
    expect(deals[1]).toMatchObject({ company_id: B, owner_id: U1, custom_fields: { temperatura: "Quente" } });
    expect(String(deals[1].pipeline_id)).toMatch(/^pipe-/);
    expect(String(deals[1].stage_id)).toMatch(/^stage-/);
    expect(f.job.counters.deals).toMatchObject({ created: 2, skipped: 1 });
    expect(f.logs.some((l) => l.entity === "deals" && l.external_id === "2" && l.reason.startsWith("aviso:"))).toBe(true);

    // leads e arquivados
    expect(rowsOf(f.upserts, "leads").map((l) => `${l.external_id}:${l.status}:${l.company_id === A ? "A" : "B"}`))
      .toEqual(["l1:open:B", "la1:archived:A"]);
    // atividades: empresa pelo negócio, pelo lead ou uma linha por empresa do contato
    expect(rowsOf(f.upserts, "activities").map((a) => `${a.external_id}:${a.company_id === A ? "A" : "B"}`))
      .toEqual(["1:A", "2:A", "2:B", "3:B"]);
    expect(rowsOf(f.upserts, "notes").map((n) => `${n.external_id}:${n.company_id === A ? "A" : "B"}`)).toEqual(["1:B"]);
    // contadores não recebem errors pelo motor (o banco já conta)
    expect(f.job.counters.persons).toEqual({ created: 4, updated: 0, skipped: 0, unchanged: 0, errors: 1 });
  });

  it("cria campos personalizados com o tipo mapeado e reaproveita os existentes", async () => {
    const { client } = fakeClient();
    const f = fakeStore();
    await runImportToEnd("job", { client, store: f.store });
    const defs = f.events.filter((e) => e.startsWith("def:") || e.startsWith("options:"));
    expect(defs).toEqual([
      "options:def-a:Quente|Frio",
      "def:A:leads:temperatura:select",
      "def:B:deals:temperatura:select",
      "def:B:leads:temperatura:select",
    ]);
    expect(f.defs.find((d) => d.company_id === B && d.entity === "deals")?.options).toEqual(["Quente", "Frio"]);
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
  });

  it("users_check falha com a lista de quem falta", async () => {
    const { client, calls } = fakeClient();
    const f = fakeStore({}, { [A]: [U1], [B]: [] });
    const r = await runImportSlice("job", { deps: { client, store: f.store } });
    expect(r).toMatchObject({ status: "failed", done: true, step: "users_check" });
    const reason = f.logs.at(-1)!.reason;
    expect(reason).toContain("Ana (Beta)");
    expect(reason).toContain("Bruno");
    expect(f.upserts).toEqual([]);
    expect(calls).toEqual([]);
  });

  it("mapeamentos inválidos marcam o job como failed", async () => {
    const { client } = fakeClient();
    const f = fakeStore({ mappings: { pipelines: {} } });
    const r = await runImportSlice("job", { deps: { client, store: f.store } });
    expect(r.status).toBe("failed");
    expect(f.logs.at(-1)!.reason).toContain("Mapeamentos inválidos");
  });

  it("job pausado, concluído ou com falha não roda", async () => {
    for (const status of ["paused", "done", "failed"] as const) {
      const { client, calls } = fakeClient();
      const f = fakeStore({ status, cursor: { step: "persons", start: 0 } });
      const r = await runImportSlice("job", { deps: { client, store: f.store } });
      expect(r).toMatchObject({ status, done: true, step: "persons" });
      expect(calls).toEqual([]);
      expect(f.events).toEqual([]);
    }
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
    expect(r).toMatchObject({ status: "paused", done: true, step: "persons", });
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

  it("rodar de novo a partir do mesmo cursor não duplica páginas", async () => {
    const { client } = fakeClient();
    const f = fakeStore({ status: "running", cursor: { step: "persons", start: 2 } });
    // cache vazio: índice é reconstruído? Não: a etapa atual já passou do índice e usa o que houver
    await runImportSlice("job", { budgetMs: 0, deps: { client, store: f.store } });
    const snapshot = structuredClone(f.job.cursor);
    f.job.cursor = { step: "persons", start: 2 };
    await runImportSlice("job", { budgetMs: 0, deps: { client, store: f.store } });
    expect(f.job.cursor).toEqual(snapshot);
    expect(rowsOf(f.upserts, "persons").map((p) => p.external_id)).toEqual(["3", "3"]);
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
    expect(dry.rows.persons).toBe(4);
    expect(r.counters.persons).toMatchObject({ created: 4, errors: 1 });
  });
});
