import { beforeEach, describe, expect, it, vi } from "vitest";
import { MEETING_OUTCOME_LABELS } from "@/lib/activities/schema";
import { toUtc } from "@/lib/activities/time";
import { fakeDb, resetSeq, type Row, type Tables } from "./fake-db.test-support";
import {
  completeCrmMeeting,
  createCrmActivity,
  CrmSinkUserError,
  type CrmTarget,
  loadCrmNames,
  moveCrmStage,
  writeCrmNote,
} from "./crm-sink";

const CO = "c1";
const OWNER = "u1";
/** Quem confirmou a sugestão (outro vendedor que edita o registro). */
const ACTOR = "u2";
const STARTED = "2026-11-12T13:00:00.000Z";
const deal: CrmTarget = { companyId: CO, entity: "deals", recordId: "d1" };

const LINKS = ["deal_id", "lead_id", "person_id", "organization_id"] as const;
const LINK_OF = { deals: "deal_id", leads: "lead_id", persons: "person_id", organizations: "organization_id" } as const;

function baseTables(): Tables {
  return {
    activity_types: [
      { id: "t-task", company_id: CO, name: "Tarefa", is_meeting: false, active: true, position: 0 },
      { id: "t-meet", company_id: CO, name: "Reunião", is_meeting: true, active: true, position: 2 },
      { id: "t-call", company_id: CO, name: "Ligação", is_meeting: false, active: true, position: 1 },
      { id: "t-meet-old", company_id: CO, name: "Reunião antiga", is_meeting: true, active: false, position: -1 },
      { id: "t-visit", company_id: CO, name: "Visita", is_meeting: false, active: false, position: 3 },
      { id: "t-demo", company_id: "c2", name: "Demo", is_meeting: false, active: true, position: 0 },
      { id: "t-meet-c2", company_id: "c2", name: "Reunião", is_meeting: true, active: true, position: -5 },
    ],
    activity_channels: [
      { id: "ch-email", company_id: CO, name: "E-mail", position: 0, active: true, is_legacy: false },
      { id: "ch-phone", company_id: CO, name: "Telefone", position: 1, active: true, is_legacy: false },
      { id: "ch-video", company_id: CO, name: "Videochamada", position: 4, active: true, is_legacy: false },
      { id: "ch-legacy", company_id: CO, name: "Não informado", position: 6, active: false, is_legacy: true },
      { id: "ch-video-c2", company_id: "c2", name: "Videochamada", position: 0, active: true, is_legacy: false },
    ],
    activities: [],
    notes: [],
  };
}

/** Atividade de reunião agendada (a âncora), aberta, no negócio d1. */
function anchor(over: Row = {}): Row {
  return {
    id: "anc1",
    company_id: CO,
    owner_id: OWNER,
    type_id: "t-meet",
    channel_id: "ch-phone",
    subject: "Reunião agendada",
    due_at: STARTED,
    done: false,
    completed_at: null,
    outcome_id: null,
    meeting_outcome: null,
    deleted_at: null,
    deal_id: "d1",
    lead_id: null,
    person_id: null,
    organization_id: null,
    ...over,
  };
}

const meetingArgs = (over: Partial<Parameters<typeof completeCrmMeeting>[2]> = {}) => ({
  anchorActivityId: null,
  outcomeLabel: "Realizada",
  subject: "Reunião com a Acme",
  startedAt: STARTED,
  ownerId: OWNER,
  actorId: ACTOR,
  ...over,
});

const activityArgs = (over: Partial<Parameters<typeof createCrmActivity>[2]> = {}) => ({
  type: "Ligação",
  subject: "Retornar a proposta",
  dueDate: "2026-11-12",
  dueTime: "14:30",
  ownerId: OWNER,
  actorId: ACTOR,
  anchorActivityId: null,
  ...over,
});

const rpcCalls = (log: { table: string; op: string; values?: unknown }[]) =>
  log.filter((e) => e.op === "rpc").map((e) => ({ name: e.table, args: e.values }));
const writes = (log: { table: string; op: string }[]) => log.filter((e) => e.op !== "select");

beforeEach(() => resetSeq());

// ---- writeCrmNote --------------------------------------------------------------------------------------------

describe("writeCrmNote", () => {
  it("insere a anotação com o dono como autor e devolve o id", async () => {
    const { db, tables } = fakeDb(baseTables());
    const id = await writeCrmNote(db, { companyId: CO, entity: "persons", recordId: "p1" }, "<p>Resumo</p>", OWNER);
    expect(tables.notes).toHaveLength(1);
    expect(tables.notes[0]).toMatchObject({
      company_id: CO,
      entity: "persons",
      record_id: "p1",
      body: "<p>Resumo</p>",
      created_by: OWNER,
    });
    expect(id).toBe(tables.notes[0].id);
    expect(typeof id).toBe("string");
  });

  it("corta o corpo em 10.000 caracteres", async () => {
    const { db, tables } = fakeDb(baseTables());
    await writeCrmNote(db, deal, "a".repeat(12_000), OWNER);
    expect(tables.notes[0].body).toBe("a".repeat(10_000));
  });

  it("o corte conta caracteres como o banco (um emoji é um caractere, sem partir ao meio)", async () => {
    const { db, tables } = fakeDb(baseTables());
    await writeCrmNote(db, deal, `${"a".repeat(9_999)}😀b`, OWNER);
    expect(tables.notes[0].body).toBe(`${"a".repeat(9_999)}😀`);
  });
});

// ---- completeCrmMeeting --------------------------------------------------------------------------------------

describe("completeCrmMeeting", () => {
  const ISO = expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/);
  const updates = (log: { table: string; op: string; values?: unknown }[]) =>
    log.filter((e) => e.table === "activities" && e.op === "update").map((e) => e.values);

  /**
   * Muda a âncora entre a leitura e a gravação (outra confirmação ou o vendedor), como se a outra escrita tivesse
   * chegado antes do update desta.
   */
  function changeBeforeUpdate(db: ReturnType<typeof fakeDb>["db"], tables: Tables, patch: Row) {
    const from = db.from.bind(db);
    vi.spyOn(db, "from").mockImplementation(((table: string) => {
      const chain = from(table) as unknown as Record<string, (...args: unknown[]) => unknown>;
      if (table === "activities") {
        const update = chain.update;
        chain.update = (v: unknown) => {
          Object.assign(tables.activities[0], patch);
          return update(v);
        };
      }
      return chain;
    }) as never);
  }

  /** A escrita (`op`) em `activities` devolve `error`, como o PostgREST; as leituras seguem o banco falso. */
  function failActivities(db: ReturnType<typeof fakeDb>["db"], op: "insert" | "update", error: Row) {
    const from = db.from.bind(db);
    vi.spyOn(db, "from").mockImplementation(((table: string) => {
      const chain = from(table) as unknown as Record<string, (...args: unknown[]) => unknown>;
      if (table !== "activities") return chain;
      const write = chain[op];
      const then = chain.then;
      let failing = false;
      chain[op] = (...args: unknown[]) => ((failing = true), write(...args));
      chain.then = (resolve: unknown, reject: unknown) =>
        failing ? (resolve as (v: unknown) => void)({ data: null, error }) : then(resolve, reject);
      return chain;
    }) as never);
  }

  it.each([
    ["Realizada", "held"],
    ["realizada", "held"],
    ["  REALIZADA ", "held"],
    ["No-show", "no_show"],
    ["no - show", "no_show"],
    ["remarcada", "rescheduled"],
    ["Cancelada", "canceled"],
  ])("o rótulo %j vira o código %s", async (label, code) => {
    const t = baseTables();
    t.activities.push(anchor());
    const { db, tables } = fakeDb(t);
    await completeCrmMeeting(db, deal, meetingArgs({ anchorActivityId: "anc1", outcomeLabel: label }));
    expect(tables.activities[0].meeting_outcome).toBe(code);
  });

  it("rótulo desconhecido lança CrmSinkUserError e não grava nada", async () => {
    const t = baseTables();
    t.activities.push(anchor());
    const { db, log } = fakeDb(t);
    const p = completeCrmMeeting(db, deal, meetingArgs({ anchorActivityId: "anc1", outcomeLabel: "Talvez" }));
    await expect(p).rejects.toBeInstanceOf(CrmSinkUserError);
    await expect(p).rejects.toThrow('O resultado "Talvez" não existe no CRM.');
    expect(writes(log)).toEqual([]);
  });

  it("com âncora aberta: conclui a âncora direto (done, completed_at, meeting_outcome), sem RPC nem insert", async () => {
    const t = baseTables();
    t.activities.push(anchor());
    const { db, log, tables } = fakeDb(t);
    const created = await completeCrmMeeting(db, deal, meetingArgs({ anchorActivityId: "anc1", outcomeLabel: "No-show" }));
    expect(created).toBeNull();
    expect(rpcCalls(log)).toEqual([]);
    expect(updates(log)).toEqual([[{ done: true, completed_at: ISO, meeting_outcome: "no_show" }]]);
    expect(log.some((e) => e.table === "activities" && e.op === "insert")).toBe(false);
    expect(tables.activities).toHaveLength(1);
    expect(tables.activities[0]).toMatchObject({ done: true, completed_at: ISO, meeting_outcome: "no_show", owner_id: OWNER });
  });

  it("remarcada com âncora: conclui sem criar a nova reunião (o vendedor a cria pela próxima atividade)", async () => {
    const t = baseTables();
    t.activities.push(anchor());
    const { db, tables } = fakeDb(t);
    await completeCrmMeeting(db, deal, meetingArgs({ anchorActivityId: "anc1", outcomeLabel: "Remarcada" }));
    expect(tables.activities).toHaveLength(1);
    expect(tables.activities[0]).toMatchObject({ done: true, meeting_outcome: "rescheduled" });
  });

  it("sem âncora: cria a reunião JÁ CONCLUÍDA num único insert (dono da reunião, autoria de quem confirmou)", async () => {
    const { db, log, tables } = fakeDb(baseTables());
    const created = await completeCrmMeeting(db, deal, meetingArgs());
    expect(tables.activities).toHaveLength(1);
    expect(created).toBe(tables.activities[0].id);
    expect(tables.activities[0]).toMatchObject({
      company_id: CO,
      owner_id: OWNER,
      created_by: ACTOR,
      type_id: "t-meet",
      channel_id: "ch-video",
      subject: "Reunião com a Acme",
      due_at: STARTED,
      deal_id: "d1",
      done: true,
      completed_at: ISO,
      meeting_outcome: "held",
    });
    // Uma escrita só: sem RPC de conclusão e sem passo de desfazer.
    expect(writes(log).map((e) => `${e.table}.${e.op}`)).toEqual(["activities.insert"]);
  });

  it.each([["deals"], ["leads"], ["persons"], ["organizations"]] as const)(
    "sem âncora: o vínculo segue o alvo (%s)",
    async (entity) => {
      const { db, log, tables } = fakeDb(baseTables());
      await completeCrmMeeting(db, { companyId: CO, entity, recordId: "r9" }, meetingArgs());
      const insert = (log.find((e) => e.table === "activities" && e.op === "insert")?.values as Row[])[0];
      for (const k of LINKS) {
        if (k === LINK_OF[entity]) expect(insert[k]).toBe("r9");
        else expect(insert[k] ?? null).toBeNull();
      }
      expect(tables.activities[0]).toMatchObject({ [LINK_OF[entity]]: "r9", done: true });
    },
  );

  it("âncora já concluída com o mesmo resultado: nada a gravar (repetir não cria outra reunião)", async () => {
    const t = baseTables();
    t.activities.push(anchor({ done: true, completed_at: "2026-11-12T14:00:00.000Z", meeting_outcome: "held" }));
    const { db, log, tables } = fakeDb(t);
    expect(await completeCrmMeeting(db, deal, meetingArgs({ anchorActivityId: "anc1", outcomeLabel: "realizada" }))).toBeNull();
    expect(writes(log)).toEqual([]);
    expect(tables.activities).toHaveLength(1);
    expect(tables.activities[0].completed_at).toBe("2026-11-12T14:00:00.000Z");
  });

  it("âncora já concluída com outro resultado: CrmSinkUserError com o rótulo, sem gravar", async () => {
    const t = baseTables();
    t.activities.push(anchor({ done: true, completed_at: "2026-11-12T14:00:00.000Z", meeting_outcome: "no_show" }));
    const { db, log, tables } = fakeDb(t);
    const p = completeCrmMeeting(db, deal, meetingArgs({ anchorActivityId: "anc1" }));
    await expect(p).rejects.toBeInstanceOf(CrmSinkUserError);
    await expect(p).rejects.toThrow('Esta reunião já foi concluída como "No-show".');
    expect(writes(log)).toEqual([]);
    expect(tables.activities).toHaveLength(1);
  });

  it("âncora já concluída sem resultado de reunião (importada): CrmSinkUserError sem rótulo, sem gravar", async () => {
    const t = baseTables();
    t.activities.push(anchor({ done: true, completed_at: "2026-11-12T14:00:00.000Z" }));
    const { db, log } = fakeDb(t);
    await expect(completeCrmMeeting(db, deal, meetingArgs({ anchorActivityId: "anc1" }))).rejects.toThrow(
      new CrmSinkUserError("Esta reunião já foi concluída."),
    );
    expect(writes(log)).toEqual([]);
  });

  it("âncora concluída por outra gravação entre a leitura e o update: mesmo resultado é sucesso, sem criar outra", async () => {
    const t = baseTables();
    t.activities.push(anchor());
    const { db, tables } = fakeDb(t);
    changeBeforeUpdate(db, tables, { done: true, completed_at: "2026-11-12T14:00:00.000Z", meeting_outcome: "held" });
    expect(await completeCrmMeeting(db, deal, meetingArgs({ anchorActivityId: "anc1" }))).toBeNull();
    expect(tables.activities).toHaveLength(1);
    expect(tables.activities[0].completed_at).toBe("2026-11-12T14:00:00.000Z");
  });

  it("âncora concluída por outra gravação entre a leitura e o update, com outro resultado: CrmSinkUserError", async () => {
    const t = baseTables();
    t.activities.push(anchor());
    const { db, tables } = fakeDb(t);
    changeBeforeUpdate(db, tables, { done: true, completed_at: "2026-11-12T14:00:00.000Z", meeting_outcome: "canceled" });
    await expect(completeCrmMeeting(db, deal, meetingArgs({ anchorActivityId: "anc1" }))).rejects.toThrow(
      new CrmSinkUserError('Esta reunião já foi concluída como "Cancelada".'),
    );
    expect(tables.activities).toHaveLength(1);
    expect(tables.activities[0].meeting_outcome).toBe("canceled");
  });

  it("âncora na lixeira: cria a reunião concluída, com o canal dela; a âncora fica como estava", async () => {
    const t = baseTables();
    t.activities.push(anchor({ deleted_at: "2026-11-12T14:00:00.000Z" }));
    const { db, tables } = fakeDb(t);
    const created = await completeCrmMeeting(db, deal, meetingArgs({ anchorActivityId: "anc1" }));
    expect(tables.activities).toHaveLength(2);
    expect(created).toBe(tables.activities[1].id);
    expect(tables.activities[1]).toMatchObject({ channel_id: "ch-phone", done: true, meeting_outcome: "held" });
    expect(tables.activities[0]).toMatchObject({ done: false, deleted_at: "2026-11-12T14:00:00.000Z" });
  });

  it("âncora apagada de vez: cria a reunião concluída, com Videochamada", async () => {
    const { db, tables } = fakeDb(baseTables());
    await completeCrmMeeting(db, deal, meetingArgs({ anchorActivityId: "sumiu" }));
    expect(tables.activities).toHaveLength(1);
    expect(tables.activities[0]).toMatchObject({ channel_id: "ch-video", done: true });
  });

  it("âncora que deixou de ser reunião (tipo trocado): cria a reunião concluída e não mexe na âncora", async () => {
    const t = baseTables();
    t.activities.push(anchor({ type_id: "t-call" }));
    const { db, tables } = fakeDb(t);
    await completeCrmMeeting(db, deal, meetingArgs({ anchorActivityId: "anc1" }));
    expect(tables.activities).toHaveLength(2);
    expect(tables.activities[0].done).toBe(false);
    expect(tables.activities[1]).toMatchObject({ type_id: "t-meet", channel_id: "ch-phone", done: true });
  });

  it("assunto vazio vira \"Reunião\"; assunto longo é cortado em 200", async () => {
    const { db, tables } = fakeDb(baseTables());
    await completeCrmMeeting(db, deal, meetingArgs({ subject: "   " }));
    await completeCrmMeeting(db, deal, meetingArgs({ subject: "x".repeat(250) }));
    expect(tables.activities[0].subject).toBe("Reunião");
    expect(tables.activities[1].subject).toBe("x".repeat(200));
  });

  it("empresa sem tipo de reunião ativo: CrmSinkUserError, sem gravar", async () => {
    const t = baseTables();
    t.activity_types = t.activity_types.filter((r) => r.id !== "t-meet");
    const { db, log } = fakeDb(t);
    const p = completeCrmMeeting(db, deal, meetingArgs());
    await expect(p).rejects.toBeInstanceOf(CrmSinkUserError);
    await expect(p).rejects.toThrow("A empresa não tem um tipo de reunião ativo no CRM.");
    expect(writes(log)).toEqual([]);
  });

  it("erro OXYN do banco na gravação vira CrmSinkUserError com o texto do translateDbError", async () => {
    const { db } = fakeDb(baseTables());
    failActivities(db, "insert", { code: "P0001", message: "OXYN_CROSS_COMPANY" });
    const p = completeCrmMeeting(db, deal, meetingArgs());
    await expect(p).rejects.toBeInstanceOf(CrmSinkUserError);
    await expect(p).rejects.toThrow("Os registros ligados precisam ser da mesma empresa.");
  });

  it("erro do banco sem código OXYN ao concluir a âncora é falha técnica (Error comum)", async () => {
    const t = baseTables();
    t.activities.push(anchor());
    const { db } = fakeDb(t);
    failActivities(db, "update", { code: "PGRST301", message: "conexão recusada" });
    const p = completeCrmMeeting(db, deal, meetingArgs({ anchorActivityId: "anc1" }));
    await expect(p).rejects.not.toBeInstanceOf(CrmSinkUserError);
    await expect(p).rejects.toThrow("conexão recusada");
  });
});

// ---- createCrmActivity ---------------------------------------------------------------------------------------

describe("createCrmActivity", () => {
  it("cria a atividade aberta com tipo, assunto, dono da reunião, autoria de quem confirmou, horário de São Paulo e vínculo", async () => {
    const { db, tables } = fakeDb(baseTables());
    await createCrmActivity(db, deal, activityArgs());
    expect(tables.activities).toHaveLength(1);
    expect(tables.activities[0]).toMatchObject({
      company_id: CO,
      owner_id: OWNER,
      created_by: ACTOR,
      type_id: "t-call",
      channel_id: "ch-video",
      subject: "Retornar a proposta",
      due_at: toUtc("2026-11-12T14:30"),
      deal_id: "d1",
      done: false,
    });
    expect(tables.activities[0].due_at).toBe("2026-11-12T17:30:00.000Z");
  });

  it("sem hora: 09:00 em São Paulo", async () => {
    const { db, tables } = fakeDb(baseTables());
    await createCrmActivity(db, deal, activityArgs({ dueTime: null }));
    expect(tables.activities[0].due_at).toBe(toUtc("2026-11-12T09:00"));
    expect(tables.activities[0].due_at).toBe("2026-11-12T12:00:00.000Z");
  });

  it("data inexistente: CrmSinkUserError sem gravar", async () => {
    const { db, log } = fakeDb(baseTables());
    const p = createCrmActivity(db, deal, activityArgs({ dueDate: "2026-02-30" }));
    await expect(p).rejects.toBeInstanceOf(CrmSinkUserError);
    await expect(p).rejects.toThrow("Data e hora inválidas.");
    expect(writes(log)).toEqual([]);
  });

  it("o tipo é achado pelo nome sem diferenciar maiúsculas", async () => {
    const { db, tables } = fakeDb(baseTables());
    await createCrmActivity(db, deal, activityArgs({ type: "  LIGAÇÃO " }));
    expect(tables.activities[0].type_id).toBe("t-call");
  });

  it.each([["Visita"], ["Demo"], ["Almoço"]])(
    "tipo %j (inativo, de outra empresa ou inexistente) lança CrmSinkUserError sem gravar",
    async (type) => {
      const { db, log } = fakeDb(baseTables());
      const p = createCrmActivity(db, deal, activityArgs({ type }));
      await expect(p).rejects.toBeInstanceOf(CrmSinkUserError);
      await expect(p).rejects.toThrow(`O tipo "${type}" não existe no CRM.`);
      expect(writes(log)).toEqual([]);
    },
  );

  it("canal: o da âncora, mesmo concluída", async () => {
    const t = baseTables();
    t.activities.push(anchor({ done: true, completed_at: STARTED, meeting_outcome: "held" }));
    const { db, tables } = fakeDb(t);
    await createCrmActivity(db, deal, activityArgs({ anchorActivityId: "anc1" }));
    expect(tables.activities[1].channel_id).toBe("ch-phone");
  });

  it("canal da âncora inativo ou legado (importado): cai para Videochamada", async () => {
    const t = baseTables();
    t.activities.push(anchor({ channel_id: "ch-legacy" }));
    const { db, tables } = fakeDb(t);
    await createCrmActivity(db, deal, activityArgs({ anchorActivityId: "anc1" }));
    expect(tables.activities[1].channel_id).toBe("ch-video");
  });

  it("sem âncora e sem Videochamada ativa: o primeiro canal ativo e não legado da empresa", async () => {
    const t = baseTables();
    t.activity_channels = [
      { id: "ch-legacy", company_id: CO, name: "Não informado", position: -2, active: false, is_legacy: true },
      { id: "ch-off", company_id: CO, name: "Fax", position: -1, active: false, is_legacy: false },
      { id: "ch-video", company_id: CO, name: "Videochamada", position: 0, active: false, is_legacy: false },
      { id: "ch-linkedin", company_id: CO, name: "LinkedIn", position: 3, active: true, is_legacy: false },
      { id: "ch-phone", company_id: CO, name: "Telefone", position: 1, active: true, is_legacy: false },
      { id: "ch-c2", company_id: "c2", name: "E-mail", position: -9, active: true, is_legacy: false },
    ];
    const { db, tables } = fakeDb(t);
    await createCrmActivity(db, deal, activityArgs());
    expect(tables.activities[0].channel_id).toBe("ch-phone");
  });

  it("empresa sem canal ativo: CrmSinkUserError sem gravar", async () => {
    const t = baseTables();
    t.activity_channels = t.activity_channels.filter((c) => c.company_id !== CO);
    const { db, log } = fakeDb(t);
    const p = createCrmActivity(db, deal, activityArgs());
    await expect(p).rejects.toBeInstanceOf(CrmSinkUserError);
    await expect(p).rejects.toThrow("A empresa não tem um canal de atividade ativo no CRM.");
    expect(writes(log)).toEqual([]);
  });

  it.each([["deals"], ["leads"], ["persons"], ["organizations"]] as const)(
    "o vínculo segue o alvo (%s)",
    async (entity) => {
      const { db, log } = fakeDb(baseTables());
      await createCrmActivity(db, { companyId: CO, entity, recordId: "r9" }, activityArgs());
      const insert = (log.find((e) => e.table === "activities" && e.op === "insert")?.values as Row[])[0];
      for (const k of LINKS) {
        if (k === LINK_OF[entity]) expect(insert[k]).toBe("r9");
        else expect(insert[k] ?? null).toBeNull();
      }
    },
  );
});

// ---- moveCrmStage --------------------------------------------------------------------------------------------

describe("moveCrmStage", () => {
  function stageTables(): Tables {
    return {
      deals: [
        {
          id: "d1",
          company_id: CO,
          pipeline_id: "p1",
          stage_id: "st1",
          status: "open",
          deleted_at: null,
          expected_close_date: null,
          person_id: null,
          custom_fields: {},
        },
      ],
      stages: [
        { id: "st1", company_id: CO, pipeline_id: "p1", name: "Qualificação", archived_at: null, required_fields: [] },
        { id: "st2", company_id: CO, pipeline_id: "p1", name: "Proposta", archived_at: null, required_fields: [] },
        {
          id: "st-arch",
          company_id: CO,
          pipeline_id: "p1",
          name: "Negociação",
          archived_at: "2026-10-01T00:00:00.000Z",
          required_fields: [],
        },
        { id: "st-p2", company_id: CO, pipeline_id: "p2", name: "Negociação", archived_at: null, required_fields: [] },
        {
          id: "st4",
          company_id: CO,
          pipeline_id: "p1",
          name: "Contrato",
          archived_at: null,
          required_fields: ["expected_close_date", "cf:origem", "person_id"],
        },
      ],
      custom_field_defs: [
        { company_id: CO, entity: "deals", key: "origem", label: "Origem do lead", archived_at: null },
        { company_id: "c2", entity: "deals", key: "origem", label: "Outra empresa", archived_at: null },
      ],
    };
  }

  it("acha a etapa pelo nome no funil do negócio (sem diferenciar maiúsculas) e grava stage_id (etapa vazia: posição 0)", async () => {
    const { db, log, tables } = fakeDb(stageTables());
    await moveCrmStage(db, "d1", "  proposta ");
    expect(tables.deals[0].stage_id).toBe("st2");
    expect(log.filter((e) => e.table === "deals" && e.op === "update").map((e) => e.values)).toEqual([
      [{ stage_id: "st2", position: 0 }],
    ]);
  });

  it("como o moveDeal, o negócio vai para o fim da etapa (maior posição + 1024; lixeira não conta)", async () => {
    const t = stageTables();
    t.deals[0].position = 5000;
    const other = (id: string, stage_id: string, position: number, deleted_at: string | null = null): Row => ({
      id,
      company_id: CO,
      pipeline_id: "p1",
      stage_id,
      status: "open",
      deleted_at,
      position,
    });
    t.deals.push(
      other("d2", "st2", 1024),
      other("d3", "st2", 3072),
      other("d4", "st2", 9999, "2026-11-01T00:00:00.000Z"),
      other("d5", "st1", 8000),
    );
    const { db, tables } = fakeDb(t);
    await moveCrmStage(db, "d1", "Proposta");
    expect(tables.deals[0]).toMatchObject({ stage_id: "st2", position: 4096 });
  });

  it.each([
    ["Negociação", "só existe arquivada neste funil ou em outro funil"],
    ["Fechamento", "não existe"],
  ])("etapa %j (%s) lança CrmSinkUserError sem gravar", async (name) => {
    const { db, log, tables } = fakeDb(stageTables());
    const p = moveCrmStage(db, "d1", name);
    await expect(p).rejects.toBeInstanceOf(CrmSinkUserError);
    await expect(p).rejects.toThrow(`A etapa "${name}" não existe no funil deste negócio.`);
    expect(writes(log)).toEqual([]);
    expect(tables.deals[0].stage_id).toBe("st1");
  });

  it("campos obrigatórios faltando: CrmSinkUserError com os nomes legíveis, sem mudar a etapa", async () => {
    const { db, tables } = fakeDb(stageTables());
    const p = moveCrmStage(db, "d1", "Contrato");
    await expect(p).rejects.toBeInstanceOf(CrmSinkUserError);
    await expect(p).rejects.toThrow(
      "Faltam campos para esta etapa: Data de fechamento esperada, Origem do lead, Pessoa.",
    );
    expect(tables.deals[0].stage_id).toBe("st1");
  });

  it("com os obrigatórios preenchidos, move", async () => {
    const t = stageTables();
    Object.assign(t.deals[0], { expected_close_date: "2026-12-01", person_id: "p1", custom_fields: { origem: "Site" } });
    const { db, tables } = fakeDb(t);
    await moveCrmStage(db, "d1", "Contrato");
    expect(tables.deals[0].stage_id).toBe("st4");
  });

  it.each([["won"], ["lost"]])("negócio %s: CrmSinkUserError sem mudar a etapa", async (status) => {
    const t = stageTables();
    t.deals[0].status = status;
    const { db, log, tables } = fakeDb(t);
    const p = moveCrmStage(db, "d1", "Proposta");
    await expect(p).rejects.toBeInstanceOf(CrmSinkUserError);
    await expect(p).rejects.toThrow("O negócio não está aberto: a etapa não foi mudada.");
    expect(writes(log)).toEqual([]);
    expect(tables.deals[0].stage_id).toBe("st1");
  });

  it("negócio já na etapa: não grava nada", async () => {
    const { db, log } = fakeDb(stageTables());
    await moveCrmStage(db, "d1", "Qualificação");
    expect(writes(log)).toEqual([]);
  });

  it.each([
    ["inexistente ou invisível", "d9"],
    ["na lixeira", "d1"],
  ])("negócio %s: CrmSinkUserError", async (_, id) => {
    const t = stageTables();
    t.deals[0].deleted_at = "2026-11-01T00:00:00.000Z";
    const { db, log } = fakeDb(t);
    const p = moveCrmStage(db, id, "Proposta");
    await expect(p).rejects.toBeInstanceOf(CrmSinkUserError);
    await expect(p).rejects.toThrow("O negócio não foi encontrado.");
    expect(writes(log)).toEqual([]);
  });
});

// ---- loadCrmNames --------------------------------------------------------------------------------------------

describe("loadCrmNames", () => {
  it("resultados: os quatro rótulos; tipos: os ativos da empresa, por posição", async () => {
    const { db } = fakeDb(baseTables());
    const names = await loadCrmNames(db, CO);
    expect(names.outcomes).toEqual(Object.values(MEETING_OUTCOME_LABELS));
    expect(names.outcomes).toEqual(["Realizada", "No-show", "Remarcada", "Cancelada"]);
    expect(names.activityTypes).toEqual(["Tarefa", "Ligação", "Reunião"]);
  });
});
