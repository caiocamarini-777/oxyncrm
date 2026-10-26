import { describe, expect, it, vi } from "vitest";
import { CLI_ERRORS, prepareCliRun } from "./cli";
import type { ImportStore, JobRecord } from "./engine";
import { ImportMappings } from "./pipedrive/types";
import type { Discovery } from "./wizard";

vi.mock("server-only", () => ({}));

const A = "00000000-0000-4000-8000-00000000000a";
const U1 = "00000000-0000-4000-8000-000000000101";

const DISCOVERY: Discovery = {
  pipelines: [{ id: "1", name: "HARPIX" }, { id: "2", name: "IGN" }],
  stages: [],
  users: [],
  labels: [],
  fields: [],
};

const DRAFT = {
  pipelines: { "1": { companyId: A, pipelineId: null, stages: {} }, "2": { companyId: "", pipelineId: null, stages: {} } },
  users: {},
  fallbackOwnerId: U1,
  leadLabelCompany: {},
  defaultCompanyId: A,
  customFields: {},
  ignorePipelines: ["2"],
};

function storeWith(job: Partial<JobRecord> | null) {
  const record: JobRecord | null = job && { id: "job", status: "draft", mappings: DRAFT, cursor: {}, counters: {}, ...job };
  const writes: string[] = [];
  const write = (name: string) => async () => {
    writes.push(name);
    return true as never;
  };
  const store = {
    loadJob: async () => structuredClone(record),
    claim: write("claim"),
    release: write("release"),
    start: write("start"),
    saveCursor: write("saveCursor"),
    finish: write("finish"),
    upsert: write("upsert"),
    count: write("count"),
    log: write("log"),
  } as unknown as ImportStore;
  return { store, writes };
}

const discover = async () => ({ ok: true as const, data: DISCOVERY });

describe("prepareCliRun", () => {
  it("importação real de rascunho é recusada", async () => {
    const { store } = storeWith({ status: "draft" });
    expect(await prepareCliRun("job", { store, dryRun: false, discover })).toEqual({ ok: false, error: CLI_ERRORS.draft });
    expect(CLI_ERRORS.draft).toContain("Inicie a importação pelo assistente");
  });

  it("job inexistente", async () => {
    const { store } = storeWith(null);
    expect(await prepareCliRun("job", { store, dryRun: true, discover })).toEqual({ ok: false, error: CLI_ERRORS.notFound });
  });

  it("simulação de rascunho converte o rascunho como o assistente, sem gravar", async () => {
    const { store, writes } = storeWith({ status: "draft", cursor: { step: "persons", start: 4 }, counters: { persons: { created: 1 } } });
    const r = await prepareCliRun("job", { store, dryRun: true, discover });
    if (!r.ok) throw new Error(r.error);
    expect(r.dry).not.toBeNull();
    const job = await r.store.loadJob("job");
    // funil ignorado sai de pipelines; o resultado é um ImportMappings válido; começa do zero
    expect(ImportMappings.safeParse(job!.mappings).success).toBe(true);
    expect(Object.keys((job!.mappings as ImportMappings).pipelines)).toEqual(["1"]);
    expect(job).toMatchObject({ cursor: {}, counters: {} });
    expect(await r.store.start("job")).toBe(true);
    expect(writes).toEqual([]);
  });

  it("simulação de rascunho com problemas de validação não roda", async () => {
    const { store } = storeWith({ status: "draft", mappings: { ...DRAFT, defaultCompanyId: "" } });
    const r = await prepareCliRun("job", { store, dryRun: true, discover });
    expect(r).toEqual({ ok: false, error: "Escolha a empresa padrão." });
  });

  it("simulação de rascunho sem acesso ao Pipedrive devolve o erro", async () => {
    const { store } = storeWith({ status: "draft" });
    const r = await prepareCliRun("job", { store, dryRun: true, discover: async () => ({ ok: false, error: "sem token" }) });
    expect(r).toEqual({ ok: false, error: "sem token" });
  });

  it("job iniciado: importação real usa o armazenamento real; simulação, o de memória", async () => {
    const { store } = storeWith({ status: "running", mappings: {} });
    const real = await prepareCliRun("job", { store, dryRun: false, discover });
    expect(real).toEqual({ ok: true, store, dry: null });
    const dry = await prepareCliRun("job", { store, dryRun: true, discover });
    expect(dry.ok && dry.store !== store && dry.dry !== null).toBe(true);
  });
});
