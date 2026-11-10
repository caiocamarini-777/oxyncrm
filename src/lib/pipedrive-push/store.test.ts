import { beforeEach, describe, expect, it } from "vitest";
import type { PdFieldDef, PdItem } from "@/lib/import/pipedrive/types";
import { fakeDb, resetSeq, type Tables } from "@/lib/meet/fake-db.test-support";
import { MIRROR_GUARD_MS, supabasePushStore, type PushMetaClient } from "./store";

const C1 = "11111111-1111-4111-8111-111111111111";
const C2 = "22222222-2222-4222-8222-222222222222";
const U1 = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const U2 = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const ORG = "0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a0a";
const PER = "0b0b0b0b-0b0b-4b0b-8b0b-0b0b0b0b0b0b";
const NEW_PER = "0e0e0e0e-0e0e-4e0e-8e0e-0e0e0e0e0e0e";
const DEAL = "0d0d0d0d-0d0d-4d0d-8d0d-0d0d0d0d0d0d";
const STAGE_MAPPED = "0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f";
const STAGE_CACHED = "10101010-1010-4010-8010-101010101010";
const STAGE_NEW = "12121212-1212-4212-8212-121212121212";

const CURSOR = "2026-11-09T12:00:00.000Z";
const NOW = new Date("2026-11-09T15:00:00.000Z");

/** Ids que ordenam como texto na ordem dos números (o banco ordena uuid do mesmo jeito). */
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function client(over: Partial<{ deal: PdFieldDef[]; activity: PdFieldDef[]; types: PdItem[] }> = {}): PushMetaClient {
  return {
    dealFields: async () =>
      over.deal ?? [
        { key: "hash_setup", name: "Setup", field_type: "monetary" },
        { key: "hash_temp", name: "Temperatura", field_type: "enum", options: [{ id: 7, label: "Quente" }, { id: 8, label: "Frio" }] },
        { key: "hash_obs", name: "Observação", field_type: "varchar" },
      ],
    activityFields: async () =>
      over.activity ?? [
        { key: "subject", name: "Assunto", field_type: "varchar" },
        {
          key: "outcome",
          name: "Resultado",
          field_type: "enum",
          options: [{ id: 21, label: "Concluída qualificada" }, { id: 22, label: "Não compareceu" }],
        },
      ],
    activityTypes: async () =>
      over.types ?? [
        { name: "Reunião", key_string: "meeting", active_flag: true },
        { name: "Chamada", key_string: "call", active_flag: true },
        { name: "WhatsApp", key_string: "whatsapp", active_flag: true },
        { name: "Visita", key_string: "visita", active_flag: false },
      ],
  };
}

function importJob(over: Record<string, unknown> = {}) {
  return {
    id: "job-ultimo",
    source: "pipedrive",
    status: "done",
    mirror: false,
    finished_at: "2026-11-08T10:00:00.000Z",
    mappings: {
      users: { "5": U1, "9": U1, "6": U2 },
      pipelines: { "1": { companyId: C1, pipelineId: "p1", stages: { "10": STAGE_MAPPED, "11": null } } },
      leadLabelCompany: { "label-velha": C2, "label-c1": C1, "label-c2": C2 },
      ignoreLeadLabels: ["label-velha"],
      customFields: {
        hash_setup: { target: "native:setup_total" },
        hash_temp: { target: "custom", customFieldKey: "temperatura" },
        hash_obs: { target: "custom", customFieldKey: "observacao" },
        hash_pessoa: { target: "custom", customFieldKey: "aniversario" }, // campo de pessoa: não vai
      },
    },
    cursor: { cache: { pipelines: { "2": { pipelineId: "p2", stages: { "20": STAGE_CACHED } } } } },
    ...over,
  };
}

function setup(tables: Tables = {}, meta: PushMetaClient = client()) {
  const base: Tables = {
    pipedrive_push_settings: [{ id: 1, enabled: false, enabled_at: null, cursor: null }],
    pipedrive_push_runs: [],
    pipedrive_push_retry: [],
    external_ids: [],
    import_jobs: [importJob()],
    ...tables,
  };
  const { db, log } = fakeDb(base, () => NOW);
  return { store: supabasePushStore(db, meta), tables: base, log };
}

beforeEach(() => resetSeq());

describe("settings e liga/desliga", () => {
  it("lê a configuração; sem a linha, desligada e sem cursor", async () => {
    const { store } = setup({ pipedrive_push_settings: [{ id: 1, enabled: true, enabled_at: CURSOR, cursor: CURSOR }] });
    expect(await store.settings()).toEqual({ enabled: true, cursor: CURSOR });
    expect(await setup({ pipedrive_push_settings: [] }).store.settings()).toEqual({ enabled: false, cursor: null });
  });

  it("ligar grava enabled_at e o cursor no momento em que foi ligado", async () => {
    const { store, tables } = setup();
    await store.setEnabled(true, NOW);
    expect(tables.pipedrive_push_settings[0]).toEqual({
      id: 1,
      enabled: true,
      enabled_at: NOW.toISOString(),
      cursor: NOW.toISOString(),
    });
  });

  it("ligar de novo a rotina já ligada não mexe no cursor", async () => {
    const { store, tables } = setup({
      pipedrive_push_settings: [{ id: 1, enabled: true, enabled_at: CURSOR, cursor: CURSOR }],
    });
    await store.setEnabled(true, NOW);
    expect(tables.pipedrive_push_settings[0]).toMatchObject({ enabled: true, enabled_at: CURSOR, cursor: CURSOR });
  });

  it("desligar só desliga (o cursor fica para consulta)", async () => {
    const { store, tables } = setup({
      pipedrive_push_settings: [{ id: 1, enabled: true, enabled_at: CURSOR, cursor: CURSOR }],
    });
    await store.setEnabled(false, NOW);
    expect(tables.pipedrive_push_settings[0]).toMatchObject({ enabled: false, cursor: CURSOR });
  });

  it("saveCursor grava o cursor", async () => {
    const { store, tables } = setup();
    await store.saveCursor("2026-11-09T14:00:00.000Z");
    expect(tables.pipedrive_push_settings[0].cursor).toBe("2026-11-09T14:00:00.000Z");
  });
});

describe("mirrorActive", () => {
  const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3600_000).toISOString();

  it("espelho concluído há menos de 48 h trava; há mais, não", async () => {
    expect(MIRROR_GUARD_MS).toBe(48 * 3600_000);
    const recent = setup({ import_jobs: [importJob({ mirror: true, finished_at: hoursAgo(47) })] });
    expect(await recent.store.mirrorActive(NOW)).toBe(true);
    const old = setup({ import_jobs: [importJob({ mirror: true, finished_at: hoursAgo(49) })] });
    expect(await old.store.mirrorActive(NOW)).toBe(false);
  });

  it("vale só o último job concluído: importação comum depois do espelho destrava", async () => {
    const { store } = setup({
      import_jobs: [
        importJob({ id: "a", mirror: true, finished_at: hoursAgo(10) }),
        importJob({ id: "b", mirror: false, finished_at: hoursAgo(2) }),
      ],
    });
    expect(await store.mirrorActive(NOW)).toBe(false);
  });

  it("ignora jobs não concluídos, de outra origem ou sem finished_at", async () => {
    const { store } = setup({
      import_jobs: [
        importJob({ id: "a", mirror: false, finished_at: hoursAgo(30) }),
        importJob({ id: "b", mirror: true, status: "running", finished_at: hoursAgo(1) }),
        importJob({ id: "c", mirror: true, status: "failed", finished_at: hoursAgo(1) }),
        importJob({ id: "d", mirror: true, source: "outro", finished_at: hoursAgo(1) }),
        importJob({ id: "e", mirror: true, finished_at: null }),
      ],
    });
    expect(await store.mirrorActive(NOW)).toBe(false);
  });

  it("sem importação nenhuma, não trava", async () => {
    expect(await setup({ import_jobs: [] }).store.mirrorActive(NOW)).toBe(false);
  });
});

describe("changed", () => {
  const org = (n: number, updated_at: string, deleted_at: string | null = null) => ({
    id: id(n),
    company_id: C1,
    name: `Org ${n}`,
    updated_at,
    deleted_at,
  });

  it("devolve o que mudou depois do cursor e não está na lixeira, por updated_at e id", async () => {
    const { store } = setup({
      organizations: [
        org(1, "2026-11-09T13:00:00.000Z"),
        org(2, "2026-11-09T12:30:00.000Z"),
        org(3, CURSOR), // igual ao cursor: já foi
        org(4, "2026-11-09T11:00:00.000Z"),
        org(5, "2026-11-09T13:30:00.000Z", "2026-11-09T13:30:00.000Z"), // na lixeira
        org(6, "2026-11-09T12:30:00.000Z"),
      ],
    });
    const rows = await store.changed("organizations", CURSOR, 10);
    expect(rows.map((r) => r.id)).toEqual([id(2), id(6), id(1)]);
  });

  it("pagina pelo par (updated_at, id): empate no updated_at não perde nem repete registro", async () => {
    const T = "2026-11-09T13:00:00.000Z";
    const { store } = setup({
      organizations: [org(1, T), org(2, T), org(3, T), org(4, "2026-11-09T14:00:00.000Z")],
    });
    const first = await store.changed("organizations", CURSOR, 2);
    expect(first.map((r) => r.id)).toEqual([id(1), id(2)]);
    const last = first[first.length - 1];
    const second = await store.changed("organizations", String(last.updated_at), 2, String(last.id));
    expect(second.map((r) => r.id)).toEqual([id(3), id(4)]);
  });

  it("carrega os ids do Pipedrive do registro e dos relacionados para o contexto", async () => {
    const { store } = setup({
      deals: [
        {
          id: DEAL,
          company_id: C1,
          person_id: PER,
          organization_id: ORG,
          updated_at: "2026-11-09T13:00:00.000Z",
          deleted_at: null,
        },
      ],
      external_ids: [
        { source: "pipedrive", entity: "persons", external_id: "7", company_id: C1, record_id: PER, imported_at: CURSOR },
        { source: "pipedrive", entity: "organizations", external_id: "8", company_id: C1, record_id: ORG, imported_at: CURSOR },
        { source: "pipedrive", entity: "deals", external_id: "100", company_id: C1, record_id: DEAL, imported_at: CURSOR },
      ],
    });
    const ctx = await store.buildContext();
    expect(ctx.pdIdOf("persons", PER)).toBeNull(); // ainda não carregado
    await store.changed("deals", CURSOR, 10);
    expect(ctx.pdIdOf("persons", PER)).toBe("7");
    expect(ctx.pdIdOf("organizations", ORG)).toBe("8");
    expect(ctx.pdIdOf("deals", DEAL)).toBe("100");
    expect(await store.pdIdOf("deals", DEAL)).toBe("100");
  });

  it("anotação carrega o id do registro vinculado", async () => {
    const { store } = setup({
      notes: [
        { id: id(1), company_id: C1, entity: "persons", record_id: PER, body: "oi", updated_at: "2026-11-09T13:00:00.000Z", deleted_at: null },
      ],
      external_ids: [
        { source: "pipedrive", entity: "persons", external_id: "7", company_id: C1, record_id: PER, imported_at: CURSOR },
      ],
    });
    const ctx = await store.buildContext();
    await store.changed("notes", CURSOR, 10);
    expect(ctx.pdIdOf("persons", PER)).toBe("7");
  });
});

describe("deleted", () => {
  it("devolve só o que foi para a lixeira depois do cursor, com a empresa", async () => {
    const { store } = setup({
      persons: [
        { id: id(1), company_id: C1, updated_at: "2026-11-09T13:00:00.000Z", deleted_at: "2026-11-09T13:00:00.000Z" },
        { id: id(2), company_id: C2, updated_at: "2026-11-09T14:00:00.000Z", deleted_at: "2026-11-09T14:00:00.000Z" },
        { id: id(3), company_id: C1, updated_at: "2026-11-09T11:00:00.000Z", deleted_at: "2026-11-09T11:00:00.000Z" }, // antes do cursor
        { id: id(4), company_id: C1, updated_at: "2026-11-09T13:30:00.000Z", deleted_at: null }, // restaurada
      ],
    });
    expect(await store.deleted("persons", CURSOR)).toEqual([
      { id: id(1), company_id: C1 },
      { id: id(2), company_id: C2 },
    ]);
  });

  it("lê todas as páginas", async () => {
    const many = Array.from({ length: 1203 }, (_, i) => ({
      id: id(i + 1),
      company_id: C1,
      updated_at: "2026-11-09T13:00:00.000Z",
      deleted_at: "2026-11-09T13:00:00.000Z",
    }));
    const { store } = setup({ activities: many });
    const rows = await store.deleted("activities", CURSOR);
    expect(rows).toHaveLength(1203);
    expect(new Set(rows.map((r) => r.id)).size).toBe(1203);
  });
});

describe("loadOne", () => {
  it("carrega a linha com os ids do Pipedrive dos relacionados", async () => {
    const { store } = setup({
      persons: [{ id: PER, company_id: C1, full_name: "Ana", organization_id: ORG, updated_at: CURSOR, deleted_at: null }],
      external_ids: [
        { source: "pipedrive", entity: "organizations", external_id: "8", company_id: C1, record_id: ORG, imported_at: CURSOR },
      ],
    });
    const ctx = await store.buildContext();
    expect(await store.loadOne("persons", PER)).toMatchObject({ id: PER, full_name: "Ana" });
    expect(ctx.pdIdOf("organizations", ORG)).toBe("8");
  });

  it("registro na lixeira ou que não existe: null", async () => {
    const { store } = setup({
      persons: [{ id: PER, company_id: C1, full_name: "Ana", updated_at: CURSOR, deleted_at: CURSOR }],
    });
    expect(await store.loadOne("persons", PER)).toBeNull();
    expect(await store.loadOne("persons", NEW_PER)).toBeNull();
  });
});

describe("vínculos", () => {
  it("link grava em external_ids pela função e já vale no contexto; unlink tira", async () => {
    const { store, tables, log } = setup({
      persons: [{ id: NEW_PER, company_id: C1, full_name: "Bia", updated_at: "2026-11-09T13:00:00.000Z", deleted_at: null }],
    });
    const ctx = await store.buildContext();
    expect(await store.pdIdOf("persons", NEW_PER)).toBeNull();

    await store.link("persons", "70", C1, NEW_PER);
    expect(log.find((l) => l.table === "rpc:pipedrive_push_link")?.values).toEqual({
      p_entity: "persons",
      p_external_id: "70",
      p_company: C1,
      p_record: NEW_PER,
    });
    expect(tables.external_ids).toEqual([
      expect.objectContaining({ entity: "persons", external_id: "70", company_id: C1, record_id: NEW_PER, job_id: null }),
    ]);
    expect(ctx.pdIdOf("persons", NEW_PER)).toBe("70");
    expect(await store.pdIdOf("persons", NEW_PER)).toBe("70");

    await store.unlink("persons", NEW_PER);
    expect(tables.external_ids).toEqual([]);
    expect(ctx.pdIdOf("persons", NEW_PER)).toBeNull();
    expect(await store.pdIdOf("persons", NEW_PER)).toBeNull();
  });

  it("pdIdOf consulta o banco quando o registro ainda não foi carregado", async () => {
    const { store } = setup({
      external_ids: [
        { source: "pipedrive", entity: "deals", external_id: "100", company_id: C1, record_id: DEAL, imported_at: CURSOR },
        { source: "pipedrive", entity: "persons", external_id: "999", company_id: C1, record_id: DEAL, imported_at: CURSOR },
      ],
    });
    expect(await store.pdIdOf("deals", DEAL)).toBe("100");
    expect(await store.pdIdOf("organizations", DEAL)).toBeNull();
  });

  it("falha da função vira erro", async () => {
    const { db } = fakeDb({});
    const broken = { ...db, rpc: async () => ({ data: null, error: { message: "sem permissão" } }) } as unknown as typeof db;
    const store = supabasePushStore(broken, client());
    await expect(store.link("persons", "70", C1, NEW_PER)).rejects.toThrow(/sem permissão/);
  });
});

describe("fila de retry", () => {
  it("queueRetry soma as tentativas e guarda o último erro; clearRetry tira da fila", async () => {
    const { store, tables } = setup();
    await store.queueRetry("deals", DEAL, C1, "pessoa ainda sem id no Pipedrive");
    expect(tables.pipedrive_push_retry).toEqual([
      expect.objectContaining({ entity: "deals", record_id: DEAL, company_id: C1, attempts: 1, last_error: "pessoa ainda sem id no Pipedrive" }),
    ]);
    await store.queueRetry("deals", DEAL, C1, "Pipedrive respondeu 500");
    await store.queueRetry("deals", DEAL, C1, "Pipedrive respondeu 502");
    expect(tables.pipedrive_push_retry).toHaveLength(1);
    expect(tables.pipedrive_push_retry[0]).toMatchObject({ attempts: 3, last_error: "Pipedrive respondeu 502" });

    await store.clearRetry("deals", DEAL);
    expect(tables.pipedrive_push_retry).toEqual([]);
  });

  it("corta o erro muito longo", async () => {
    const { store, tables } = setup();
    await store.queueRetry("persons", PER, C1, "x".repeat(5000));
    expect(String(tables.pipedrive_push_retry[0].last_error).length).toBeLessThanOrEqual(1000);
  });

  it("retryQueue lista a fila na ordem das dependências", async () => {
    const { store } = setup({
      pipedrive_push_retry: [
        { entity: "notes", record_id: id(1), company_id: C1, attempts: 1 },
        { entity: "deals", record_id: id(3), company_id: C1, attempts: 2 },
        { entity: "persons", record_id: id(2), company_id: C2, attempts: 4 },
        { entity: "deals", record_id: id(2), company_id: C1, attempts: 1 },
      ],
    });
    expect(await store.retryQueue()).toEqual([
      { entity: "persons", record_id: id(2), company_id: C2, attempts: 4 },
      { entity: "deals", record_id: id(2), company_id: C1, attempts: 1 },
      { entity: "deals", record_id: id(3), company_id: C1, attempts: 2 },
      { entity: "notes", record_id: id(1), company_id: C1, attempts: 1 },
    ]);
  });
});

describe("relatório das rodadas", () => {
  it("startRun abre a rodada e finishRun fecha com cursor, contadores e erros", async () => {
    const { store, tables } = setup();
    const runId = await store.startRun(CURSOR);
    expect(tables.pipedrive_push_runs).toEqual([expect.objectContaining({ id: runId, cursor_from: CURSOR, status: "running" })]);

    const counters = { organizations: { created: 1, updated: 0, deleted: 0, errors: 0 } };
    const errors = [{ entity: "deals", id: DEAL, reason: "etapa sem correspondente" }];
    await store.finishRun(runId, { status: "done", cursorTo: "2026-11-09T14:00:00.000Z", counters, errors });
    expect(tables.pipedrive_push_runs[0]).toMatchObject({
      status: "done",
      cursor_to: "2026-11-09T14:00:00.000Z",
      counters,
      errors,
    });
    expect(tables.pipedrive_push_runs[0].finished_at).toEqual(expect.any(String));
  });
});

describe("buildContext", () => {
  it("dono pelo mapa de usuários ao contrário; sem usuário, null", async () => {
    const ctx = await setup().store.buildContext();
    expect(ctx.pdUserOf(U1)).toBe(5);
    expect(ctx.pdUserOf(U2)).toBe(6);
    expect(ctx.pdUserOf("eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee")).toBeNull();
    expect(ctx.pdUserOf(null)).toBeNull();
  });

  it("etapa pelo mapeamento e pelo cache dos funis criados na importação; etapa nova, null", async () => {
    const ctx = await setup().store.buildContext();
    expect(ctx.pdStageOf(STAGE_MAPPED)).toBe(10);
    expect(ctx.pdStageOf(STAGE_CACHED)).toBe(20);
    expect(ctx.pdStageOf(STAGE_NEW)).toBeNull();
  });

  it("etiqueta de lead da empresa, sem as etiquetas ignoradas", async () => {
    const ctx = await setup().store.buildContext();
    expect(ctx.pdLeadLabelOf(C1)).toBe("label-c1");
    expect(ctx.pdLeadLabelOf(C2)).toBe("label-c2");
    expect(ctx.pdLeadLabelOf("eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee")).toBeNull();
  });

  it("campos personalizados ao contrário, só os do negócio, com o tipo e as opções do Pipedrive", async () => {
    const ctx = await setup().store.buildContext();
    expect(ctx.customFields).toEqual([
      { crmKey: "native:setup_total", pdKey: "hash_setup", type: "monetary" },
      { crmKey: "temperatura", pdKey: "hash_temp", type: "enum", options: { Quente: "7", Frio: "8" } },
      { crmKey: "observacao", pdKey: "hash_obs", type: "varchar" },
    ]);
  });

  it("tipo de atividade pelo nome, por apelido ou pelo padrão", async () => {
    const ctx = await setup().store.buildContext();
    expect(ctx.pdActivityTypeOf("reuniao", true)).toBe("meeting");
    expect(ctx.pdActivityTypeOf("WhatsApp", false)).toBe("whatsapp");
    expect(ctx.pdActivityTypeOf("Ligação", false)).toBe("call"); // apelido: o Pipedrive chama de "Chamada"
    expect(ctx.pdActivityTypeOf("Visita", false)).toBe("task"); // tipo inativo no Pipedrive
    expect(ctx.pdActivityTypeOf("Demonstração", true)).toBe("meeting");
    expect(ctx.pdActivityTypeOf("Follow-up", false)).toBe("task");
  });

  it("resultado pelo rótulo, sem acento e sem maiúsculas", async () => {
    const ctx = await setup().store.buildContext();
    expect(ctx.pdOutcomeOf("Concluída qualificada")).toBe(21);
    expect(ctx.pdOutcomeOf("nao compareceu")).toBe(22);
    expect(ctx.pdOutcomeOf("Remarcada")).toBeNull();
    expect(ctx.pdOutcomeOf(null)).toBeNull();
  });

  it("usa o último job concluído", async () => {
    const { store } = setup({
      import_jobs: [
        importJob({ id: "velho", finished_at: "2026-11-01T10:00:00.000Z", mappings: { users: { "77": U1 } } }),
        importJob(),
        importJob({ id: "rodando", status: "running", finished_at: null, mappings: { users: { "88": U1 } } }),
      ],
    });
    expect((await store.buildContext()).pdUserOf(U1)).toBe(5);
  });

  it("sem importação concluída, não dá para montar os mapas", async () => {
    await expect(setup({ import_jobs: [] }).store.buildContext()).rejects.toThrow(/importação do Pipedrive/);
  });
});
