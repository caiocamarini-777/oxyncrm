import { beforeEach, describe, expect, it } from "vitest";
import type { PdFieldDef, PdItem } from "@/lib/import/pipedrive/types";
import { fakeDb, resetSeq, type Tables } from "@/lib/meet/fake-db.test-support";
import {
  assertPushDisabled,
  MIRROR_GUARD_MS,
  PUSH_ENABLED_MESSAGE,
  RUN_LOCK_MS,
  supabasePushStore,
  type PushMetaClient,
} from "./store";

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

type MetaOver = Partial<{ deal: PdFieldDef[]; activity: PdFieldDef[]; types: PdItem[]; stages: PdItem[]; pipelines: PdItem[] }>;

function client(over: MetaOver = {}, calls: string[] = []): PushMetaClient {
  return {
    stages: async () => {
      calls.push("stages");
      return over.stages ?? [];
    },
    pipelines: async () => {
      calls.push("pipelines");
      return over.pipelines ?? [];
    },
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
        { name: "E-mail", key_string: "email", active_flag: true },
        { name: "Tarefa", key_string: "task", active_flag: true },
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
    created_at: "2026-11-08T08:59:00.000Z",
    started_at: "2026-11-08T09:00:00.000Z",
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
    pipedrive_push_settings: [{ id: 1, enabled: false, enabled_at: null, cursor: null, cursors: {} }],
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
  it("lê a configuração com os cursores por entidade; sem a linha, desligada e sem cursor", async () => {
    const T = "2026-11-09T13:00:00.123456+00:00";
    const { store } = setup({
      pipedrive_push_settings: [
        {
          id: 1,
          enabled: true,
          enabled_at: CURSOR,
          cursor: CURSOR,
          cursors: { organizations: { at: T, id: ORG }, persons: { at: T }, outra: { at: T }, deals: { id: DEAL } },
        },
      ],
    });
    expect(await store.settings()).toEqual({
      enabled: true,
      cursor: CURSOR,
      cursors: { organizations: { at: T, id: ORG }, persons: { at: T } },
    });
    expect(await setup({ pipedrive_push_settings: [] }).store.settings()).toEqual({ enabled: false, cursor: null, cursors: {} });
  });

  it("ligar grava enabled_at agora, o cursor no início da última importação concluída e zera os cursores", async () => {
    const { store, tables } = setup({
      pipedrive_push_settings: [
        { id: 1, enabled: false, enabled_at: null, cursor: CURSOR, cursors: { organizations: { at: CURSOR } } },
      ],
      import_jobs: [
        importJob({ id: "job-antigo", mirror: false, started_at: "2026-11-07T09:00:00.000Z", finished_at: "2026-11-07T10:00:00.000Z" }),
        importJob({ id: "job-ultimo", mirror: true, started_at: "2026-11-09T09:00:00.000Z", finished_at: "2026-11-09T09:30:00.000Z" }),
        importJob({ id: "job-rodando", status: "running", started_at: "2026-11-09T10:00:00.000Z", finished_at: null }),
        importJob({ id: "job-outra-fonte", source: "csv", finished_at: "2026-11-09T11:00:00.000Z" }),
      ],
    });
    await store.setEnabled(true, NOW);
    expect(tables.pipedrive_push_settings[0]).toEqual({
      id: 1,
      enabled: true,
      enabled_at: NOW.toISOString(),
      // o que entrou no CRM durante a sincronização final também vai
      cursor: "2026-11-09T09:00:00.000Z",
      cursors: {},
    });
  });

  it("ligar com a última importação sem started_at: usa o created_at dela", async () => {
    const { store, tables } = setup({ import_jobs: [importJob({ started_at: null })] });
    await store.setEnabled(true, NOW);
    expect(tables.pipedrive_push_settings[0].cursor).toBe("2026-11-08T08:59:00.000Z");
  });

  it("ligar sem nenhuma importação concluída: o cursor é o momento em que foi ligado", async () => {
    const { store, tables } = setup({ import_jobs: [importJob({ status: "failed" })] });
    await store.setEnabled(true, NOW);
    expect(tables.pipedrive_push_settings[0]).toMatchObject({ enabled_at: NOW.toISOString(), cursor: NOW.toISOString() });
  });

  it("ligar de novo a rotina já ligada não mexe nos cursores", async () => {
    const cursors = { organizations: { at: "2026-11-09T13:00:00.000Z" } };
    const { store, tables } = setup({
      pipedrive_push_settings: [{ id: 1, enabled: true, enabled_at: CURSOR, cursor: CURSOR, cursors }],
    });
    await store.setEnabled(true, NOW);
    expect(tables.pipedrive_push_settings[0]).toMatchObject({ enabled: true, enabled_at: CURSOR, cursor: CURSOR, cursors });
  });

  it("desligar só desliga (os cursores ficam para consulta)", async () => {
    const cursors = { organizations: { at: "2026-11-09T13:00:00.000Z" } };
    const { store, tables } = setup({
      pipedrive_push_settings: [{ id: 1, enabled: true, enabled_at: CURSOR, cursor: CURSOR, cursors }],
    });
    await store.setEnabled(false, NOW);
    expect(tables.pipedrive_push_settings[0]).toMatchObject({ enabled: false, cursor: CURSOR, cursors });
  });

  it("saveCursors grava os cursores por entidade, sem mexer no inicial", async () => {
    const { store, tables } = setup({
      pipedrive_push_settings: [{ id: 1, enabled: true, enabled_at: CURSOR, cursor: CURSOR, cursors: {} }],
    });
    const cursors = { organizations: { at: "2026-11-09T14:00:00.000Z" }, persons: { at: "2026-11-09T13:00:00.000Z", id: PER } };
    await store.saveCursors(cursors);
    expect(tables.pipedrive_push_settings[0]).toMatchObject({ cursor: CURSOR, cursors });
  });
});

describe("trava da sincronização do Pipedrive para o CRM (assertPushDisabled)", () => {
  it("com a atualização ligada, recusa com a mensagem; desligada ou sem a linha, deixa rodar", async () => {
    const on = fakeDb({ pipedrive_push_settings: [{ id: 1, enabled: true }] }).db;
    await expect(assertPushDisabled(on)).rejects.toThrow(PUSH_ENABLED_MESSAGE);
    expect(PUSH_ENABLED_MESSAGE).toBe(
      "A atualização do Pipedrive pelo CRM está ligada: a sincronização do Pipedrive para o CRM não pode rodar junto " +
        "(desligue com pnpm sync:crm-para-pipedrive --desligar).",
    );
    await expect(assertPushDisabled(fakeDb({ pipedrive_push_settings: [{ id: 1, enabled: false }] }).db)).resolves.toBeUndefined();
    await expect(assertPushDisabled(fakeDb({ pipedrive_push_settings: [] }).db)).resolves.toBeUndefined();
  });

  const failing = (error: { code?: string; message: string }) => {
    const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: null, error }) };
    return { from: () => query } as unknown as Parameters<typeof assertPushDisabled>[0];
  };

  it("tabela ainda não criada (migration não aplicada): a rotina não existe, deixa rodar", async () => {
    await expect(assertPushDisabled(failing({ code: "PGRST205", message: "Could not find the table" }))).resolves.toBeUndefined();
    await expect(assertPushDisabled(failing({ code: "42P01", message: "relation does not exist" }))).resolves.toBeUndefined();
  });

  it("outra falha ao ler a configuração: recusa (na dúvida, não sincroniza)", async () => {
    await expect(assertPushDisabled(failing({ code: "57014", message: "timeout" }))).rejects.toThrow(/conferir.*timeout/);
  });
});

describe("runActive (trava de rodadas simultâneas)", () => {
  const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000).toISOString();

  it("rodada running iniciada há menos de 55 min trava; mais antiga (morta) ou terminada, não", async () => {
    expect(RUN_LOCK_MS).toBe(55 * 60_000);
    const recent = setup({ pipedrive_push_runs: [{ id: "r1", status: "running", started_at: minutesAgo(10) }] });
    expect(await recent.store.runActive(NOW)).toBe(true);
    const stale = setup({ pipedrive_push_runs: [{ id: "r1", status: "running", started_at: minutesAgo(56) }] });
    expect(await stale.store.runActive(NOW)).toBe(false);
    const finished = setup({
      pipedrive_push_runs: [
        { id: "r1", status: "done", started_at: minutesAgo(5) },
        { id: "r2", status: "failed", started_at: minutesAgo(3) },
      ],
    });
    expect(await finished.store.runActive(NOW)).toBe(false);
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

  it("registro na lixeira ou que não existe: null, e o contexto passa a vê-lo em isGone", async () => {
    const { store } = setup({
      persons: [{ id: PER, company_id: C1, full_name: "Ana", updated_at: CURSOR, deleted_at: CURSOR }],
    });
    const ctx = await store.buildContext();
    expect(ctx.isGone("persons", PER)).toBe(false); // ainda não conferido
    expect(await store.loadOne("persons", PER)).toBeNull();
    expect(await store.loadOne("persons", NEW_PER)).toBeNull();
    expect(ctx.isGone("persons", PER)).toBe(true);
    expect(ctx.isGone("persons", NEW_PER)).toBe(true);
    expect(ctx.isGone("organizations", PER)).toBe(false);
  });

  it("isGone: as exclusões lidas também valem; registro vivo ou religado deixa de valer", async () => {
    const { store, tables } = setup({
      persons: [{ id: PER, company_id: C1, full_name: "Ana", updated_at: CURSOR, deleted_at: "2026-11-09T13:00:00.000Z" }],
    });
    const ctx = await store.buildContext();
    await store.deleted("persons", CURSOR);
    expect(ctx.isGone("persons", PER)).toBe(true);
    tables.persons[0].deleted_at = null; // restaurada
    await store.loadOne("persons", PER);
    expect(ctx.isGone("persons", PER)).toBe(false);
    await store.deleted("persons", CURSOR);
    await store.link("persons", "70", C1, PER);
    expect(ctx.isGone("persons", PER)).toBe(false);
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
    expect(log.find((l) => l.table === "pipedrive_push_link")?.values).toEqual({
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

describe("linkedChildren e requeue (registro criado de novo no Pipedrive)", () => {
  it("atividades e anotações vivas do registro que já têm id no Pipedrive", async () => {
    const act = (n: number, over: Record<string, unknown>) => ({ id: id(n), company_id: C1, deleted_at: null, deal_id: null, ...over });
    const { store } = setup({
      activities: [
        act(1, { deal_id: DEAL }), // com id
        act(2, { deal_id: DEAL }), // sem id
        act(3, { deal_id: DEAL, deleted_at: CURSOR }), // na lixeira
        act(4, { person_id: PER }), // de outro registro
      ],
      notes: [
        { id: id(11), company_id: C2, entity: "deals", record_id: DEAL, deleted_at: null },
        { id: id(12), company_id: C1, entity: "persons", record_id: DEAL, deleted_at: null },
      ],
      external_ids: [1, 3, 4, 11, 12].map((n) => ({
        source: "pipedrive",
        entity: n > 10 ? "notes" : "activities",
        external_id: String(300 + n),
        company_id: C1,
        record_id: id(n),
        imported_at: CURSOR,
      })),
    });
    expect(await store.linkedChildren("deals", DEAL)).toEqual([
      { entity: "activities", id: id(1), company_id: C1 },
      { entity: "notes", id: id(11), company_id: C2 },
    ]);
    expect(await store.linkedChildren("notes", DEAL)).toEqual([]);
  });

  it("requeue põe na fila sem contar tentativa; quem já está na fila fica como está", async () => {
    const { store, tables } = setup({
      pipedrive_push_retry: [{ entity: "notes", record_id: id(2), company_id: C1, attempts: 3, last_error: "400" }],
    });
    await store.requeue("activities", id(1), C1, "deals x criado de novo no Pipedrive");
    await store.requeue("notes", id(2), C1, "deals x criado de novo no Pipedrive");
    expect(tables.pipedrive_push_retry).toEqual([
      expect.objectContaining({ entity: "notes", record_id: id(2), attempts: 3, last_error: "400" }),
      expect.objectContaining({ entity: "activities", record_id: id(1), company_id: C1, attempts: 0, last_error: "deals x criado de novo no Pipedrive" }),
    ]);
    // a primeira falha depois do requeue conta como a primeira tentativa
    await store.queueRetry("activities", id(1), C1, "Pipedrive respondeu 400");
    expect(tables.pipedrive_push_retry[1]).toMatchObject({ attempts: 1 });
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
    const warnings = ["etapa x do CRM corresponde a 2 etapas do Pipedrive"];
    await store.finishRun(runId, { status: "done", cursorTo: "2026-11-09T14:00:00.000Z", counters, errors, warnings });
    expect(tables.pipedrive_push_runs[0]).toMatchObject({
      status: "done",
      cursor_to: "2026-11-09T14:00:00.000Z",
      counters,
      errors,
      warnings,
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
    const calls: string[] = [];
    const warnings: string[] = [];
    const ctx = await setup({}, client({}, calls)).store.buildContext((m) => warnings.push(m));
    expect(ctx.pdStageOf(STAGE_MAPPED)).toBe(10);
    expect(ctx.pdStageOf(STAGE_CACHED)).toBe(20);
    expect(ctx.pdStageOf(STAGE_NEW)).toBeNull();
    // sem ambiguidade: nem lê os funis do Pipedrive, nem avisa
    expect(calls).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it("várias etapas do Pipedrive na mesma do CRM: a primeira na ordem do funil, com um aviso por etapa", async () => {
    const calls: string[] = [];
    const warnings: string[] = [];
    const { store } = setup(
      {
        import_jobs: [
          importJob({
            mappings: {
              ...importJob().mappings,
              pipelines: {
                "1": { stages: { "10": STAGE_MAPPED, "12": STAGE_MAPPED } },
                "2": { stages: { "21": STAGE_MAPPED, "22": STAGE_NEW } },
              },
            },
            // o cache não vale para etapa que está no mapeamento
            cursor: { cache: { pipelines: { "3": { stages: { "5": STAGE_MAPPED, "30": STAGE_CACHED } } } } },
          }),
        ],
      },
      client(
        {
          // funil 2 antes do funil 1; no funil 2, a etapa 21 é a primeira
          pipelines: [{ id: 1, order_nr: 2 }, { id: 2, order_nr: 1 }],
          stages: [
            { id: 10, pipeline_id: 1, order_nr: 1 },
            { id: 12, pipeline_id: 1, order_nr: 2 },
            { id: 21, pipeline_id: 2, order_nr: 3 },
          ],
        },
        calls,
      ),
    );
    const ctx = await store.buildContext((m) => warnings.push(m));
    expect(calls.sort()).toEqual(["pipelines", "stages"]);
    expect(ctx.pdStageOf(STAGE_MAPPED)).toBe(21);
    expect(ctx.pdStageOf(STAGE_MAPPED)).toBe(21);
    expect(ctx.pdStageOf(STAGE_NEW)).toBe(22);
    expect(ctx.pdStageOf(STAGE_CACHED)).toBe(30);
    expect(warnings).toEqual([
      `etapa ${STAGE_MAPPED} do CRM corresponde a 3 etapas do Pipedrive (21, 10, 12): vai a 21, a primeira na ordem do funil no Pipedrive`,
    ]);
  });

  it("etapa ambígua sem as etapas no Pipedrive (apagadas lá): a de menor id, sempre a mesma", async () => {
    const { store } = setup({
      import_jobs: [
        importJob({
          mappings: { ...importJob().mappings, pipelines: { "1": { stages: { "40": STAGE_MAPPED, "11": STAGE_MAPPED } } } },
        }),
      ],
    });
    expect((await store.buildContext()).pdStageOf(STAGE_MAPPED)).toBe(11);
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
    expect(ctx.pdActivityTypeOf("reuniao", true, null)).toBe("meeting");
    expect(ctx.pdActivityTypeOf("WhatsApp", false, null)).toBe("whatsapp");
    expect(ctx.pdActivityTypeOf("Ligação", false, "Não informado")).toBe("call"); // apelido: o Pipedrive chama de "Chamada"
    expect(ctx.pdActivityTypeOf("Visita", false, null)).toBe("task"); // tipo inativo no Pipedrive
    expect(ctx.pdActivityTypeOf("Demonstração", true, null)).toBe("meeting");
    expect(ctx.pdActivityTypeOf("Follow-up", false, null)).toBe("task");
  });

  it("tipo pelo canal, o inverso da importação (que achata ligação, e-mail e WhatsApp em Tarefa)", async () => {
    const ctx = await setup().store.buildContext();
    // ligação, e-mail e WhatsApp importados: tipo "Tarefa" com o canal da origem
    expect(ctx.pdActivityTypeOf("Tarefa", false, "Telefone")).toBe("call");
    expect(ctx.pdActivityTypeOf("Tarefa", false, "E-mail")).toBe("email");
    expect(ctx.pdActivityTypeOf("Tarefa", false, "WhatsApp")).toBe("whatsapp");
    // tarefa (e prazo, tipos próprios...): canal "Não informado" → pelo nome do tipo
    expect(ctx.pdActivityTypeOf("Tarefa", false, "Não informado")).toBe("task");
    // reunião: o canal não muda o tipo
    expect(ctx.pdActivityTypeOf("Reunião", true, "Telefone")).toBe("meeting");
    // criada no CRM: "Mensagem" pelo WhatsApp
    expect(ctx.pdActivityTypeOf("Mensagem", false, "WhatsApp")).toBe("whatsapp");
    // canal sem tipo na conta (LinkedIn): pelo nome do tipo
    expect(ctx.pdActivityTypeOf("Tarefa", false, "LinkedIn")).toBe("task");
  });

  it("WhatsApp sem a key whatsapp na conta: o tipo chamado WhatsApp; sem ele, pelo nome do tipo", async () => {
    const own = await setup({}, client({ types: [{ name: "WhatsApp", key_string: "task", active_flag: true }, { name: "Chamada", key_string: "call" }] }))
      .store.buildContext();
    expect(own.pdActivityTypeOf("Tarefa", false, "WhatsApp")).toBe("task");
    const custom = await setup({}, client({ types: [{ name: "WhatsApp", key_string: "wpp_1", active_flag: true }] })).store.buildContext();
    expect(custom.pdActivityTypeOf("Tarefa", false, "WhatsApp")).toBe("wpp_1");
    const none = await setup({}, client({ types: [{ name: "Chamada", key_string: "call", active_flag: true }] })).store.buildContext();
    expect(none.pdActivityTypeOf("Ligação", false, "WhatsApp")).toBe("call");
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
