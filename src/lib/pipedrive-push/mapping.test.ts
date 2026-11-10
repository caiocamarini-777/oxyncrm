import { describe, expect, it } from "vitest";
import {
  toPdActivity,
  toPdDeal,
  toPdLead,
  toPdNote,
  toPdOrganization,
  toPdPerson,
  type PushCtx,
  type PushPayload,
} from "./mapping";

const C1 = "11111111-1111-4111-8111-111111111111";
const C2 = "22222222-2222-4222-8222-222222222222";
const U1 = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"; // perfil com usuário no Pipedrive
const U2 = "dddddddd-dddd-4ddd-8ddd-dddddddddddd"; // perfil sem usuário no Pipedrive
const ORG = "0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a0a";
const PER = "0b0b0b0b-0b0b-4b0b-8b0b-0b0b0b0b0b0b";
const LEAD = "0c0c0c0c-0c0c-4c0c-8c0c-0c0c0c0c0c0c";
const DEAL = "0d0d0d0d-0d0d-4d0d-8d0d-0d0d0d0d0d0d";
const NEW_PER = "0e0e0e0e-0e0e-4e0e-8e0e-0e0e0e0e0e0e"; // criada no CRM, ainda sem id no Pipedrive
const STAGE = "0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f";
const NEW_STAGE = "10101010-1010-4010-8010-101010101010"; // etapa criada no CRM durante o piloto
const PD_LEAD = "5d2b1f9a-7c1e-4b8e-9f00-aaaaaaaaaaaa";
// na lixeira do CRM (e apagados no Pipedrive pela rodada): vínculo vazio
const GONE_ORG = "1a1a1a1a-1a1a-4a1a-8a1a-1a1a1a1a1a1a";
const GONE_PER = "1b1b1b1b-1b1b-4b1b-8b1b-1b1b1b1b1b1b";
const GONE_DEAL = "1d1d1d1d-1d1d-4d1d-8d1d-1d1d1d1d1d1d";
const gone = new Set([`organizations:${GONE_ORG}`, `persons:${GONE_PER}`, `deals:${GONE_DEAL}`]);

const pdIds: Record<string, string> = {
  [`organizations:${ORG}`]: "8",
  [`persons:${PER}`]: "7",
  [`leads:${LEAD}`]: PD_LEAD,
  [`deals:${DEAL}`]: "100",
};

const outcomes: Record<string, number> = {
  "Concluída qualificada": 21,
  "Não compareceu": 22,
  Conectado: 23,
  Cancelado: 24,
};

const ctx: PushCtx = {
  pdUserOf: (id) => (id === U1 ? 5 : null),
  pdIdOf: (entity, id) => (id ? (pdIds[`${entity}:${id}`] ?? null) : null),
  isGone: (entity, id) => gone.has(`${entity}:${id}`),
  pdStageOf: (id) => (id === STAGE ? 10 : null),
  pdLeadLabelOf: (company) => (company === C1 ? "label-c1" : null),
  customFields: [
    { crmKey: "native:setup_total", pdKey: "hash_setup", type: "monetary" },
    { crmKey: "native:mrr", pdKey: "hash_mrr", type: "monetary" },
    { crmKey: "native:contract_months", pdKey: "hash_months", type: "double" },
    { crmKey: "temperatura", pdKey: "hash_temp", type: "enum", options: { Quente: "7", Frio: "8" } },
    { crmKey: "stack", pdKey: "hash_stack", type: "set", options: { Next: "1", Supabase: "2" } },
    { crmKey: "responsavel", pdKey: "hash_user", type: "user" },
    { crmKey: "observacao", pdKey: "hash_obs", type: "varchar" },
    { crmKey: "inicio", pdKey: "hash_inicio", type: "date" },
  ],
  pdActivityTypeOf: (name, isMeeting, channel) =>
    channel === "WhatsApp" ? "whatsapp" : name === "Ligação" ? "call" : isMeeting ? "meeting" : "task",
  pdOutcomeOf: (label) => (label ? (outcomes[label] ?? null) : null),
};

function bodyOf(p: PushPayload): Record<string, unknown> {
  if ("error" in p) throw new Error(p.error);
  return p.body;
}

describe("toPdOrganization", () => {
  const org = {
    id: ORG,
    company_id: C1,
    owner_id: U1,
    name: "Acme",
    address: { street: "Rua A", number: "10", city: "São Paulo", state: "SP", zip: "01000-000" },
    custom_fields: { segmento: "Varejo" },
  };

  it("nome, endereço em texto e dono pelo mapa", () => {
    expect(toPdOrganization(org, ctx)).toEqual({
      path: "/v1/organizations",
      body: { name: "Acme", address: "Rua A, 10, São Paulo, SP, 01000-000", owner_id: 5 },
    });
  });

  it("endereço importado só com a rua volta igual; vazio vira null", () => {
    expect(bodyOf(toPdOrganization({ ...org, address: { street: "Av. Paulista, 1000 - SP" } }, ctx)).address).toBe(
      "Av. Paulista, 1000 - SP",
    );
    expect(bodyOf(toPdOrganization({ ...org, address: {} }, ctx)).address).toBeNull();
  });

  it("dono sem usuário no Pipedrive fica de fora", () => {
    expect(bodyOf(toPdOrganization({ ...org, owner_id: U2 }, ctx))).not.toHaveProperty("owner_id");
  });

  it("sem nome é erro", () => {
    expect(toPdOrganization({ ...org, name: " " }, ctx)).toEqual({ error: "organização sem nome" });
  });
});

describe("toPdPerson", () => {
  const person = {
    id: PER,
    company_id: C1,
    owner_id: U1,
    full_name: "Beto Silva",
    organization_id: ORG,
    emails: [
      { value: "beto@acme.com", label: "Trabalho" },
      { value: "beto@gmail.com", label: "Pessoal" },
    ],
    phones: [
      { value: "11999990000", label: "Celular" },
      { value: "1133334444", label: "work" },
      { value: "1144445555", label: "Outro" },
    ],
  };

  it("nome, e-mails e telefones no formato do Pipedrive, organização e dono", () => {
    expect(toPdPerson(person, ctx)).toEqual({
      path: "/v1/persons",
      body: {
        name: "Beto Silva",
        email: [
          { value: "beto@acme.com", primary: true, label: "work" },
          { value: "beto@gmail.com", primary: false, label: "home" },
        ],
        phone: [
          { value: "11999990000", primary: true, label: "mobile" },
          { value: "1133334444", primary: false, label: "work" },
          { value: "1144445555", primary: false, label: "other" },
        ],
        org_id: 8,
        owner_id: 5,
      },
    });
  });

  it("sem organização vai null; listas vazias vão vazias", () => {
    const b = bodyOf(toPdPerson({ ...person, organization_id: null, emails: [], phones: [] }, ctx));
    expect(b).toMatchObject({ org_id: null, email: [], phone: [] });
  });

  it("dono sem usuário no Pipedrive fica de fora", () => {
    expect(bodyOf(toPdPerson({ ...person, owner_id: U2 }, ctx))).not.toHaveProperty("owner_id");
  });

  it("organização ainda sem id no Pipedrive é erro", () => {
    expect(toPdPerson({ ...person, organization_id: "99999999-9999-4999-8999-999999999999" }, ctx)).toEqual({
      error: "organização ainda sem id no Pipedrive",
    });
  });

  it("organização na lixeira do CRM vira vínculo vazio, e a pessoa vai", () => {
    expect(bodyOf(toPdPerson({ ...person, organization_id: GONE_ORG }, ctx)).org_id).toBeNull();
  });
});

describe("toPdLead", () => {
  const lead = {
    id: LEAD,
    company_id: C1,
    owner_id: U1,
    title: "Lead Acme",
    person_id: PER,
    organization_id: ORG,
    estimated_value: 1500,
    status: "open",
  };

  it("título, vínculos, dono e valor; a etiqueta de lead da empresa só na criação (o PATCH trocaria as do lead)", () => {
    expect(toPdLead(lead, ctx)).toEqual({
      path: "/v1/leads",
      body: {
        title: "Lead Acme",
        person_id: 7,
        organization_id: 8,
        owner_id: 5,
        value: { amount: 1500, currency: "BRL" },
        is_archived: false,
      },
      createOnly: { label_ids: ["label-c1"] },
    });
  });

  it("empresa sem etiqueta de lead não manda label_ids; sem valor vai null", () => {
    const p = toPdLead({ ...lead, company_id: C2, estimated_value: null }, ctx);
    expect(p).not.toHaveProperty("createOnly");
    const b = bodyOf(p);
    expect(b).not.toHaveProperty("label_ids");
    expect(b.value).toBeNull();
  });

  it("arquivado, convertido ou desqualificado no CRM fica arquivado no Pipedrive", () => {
    for (const status of ["archived", "converted", "disqualified"]) {
      expect(bodyOf(toPdLead({ ...lead, status }, ctx)).is_archived).toBe(true);
    }
  });

  it("dono sem usuário no Pipedrive fica de fora", () => {
    expect(bodyOf(toPdLead({ ...lead, owner_id: U2 }, ctx))).not.toHaveProperty("owner_id");
  });

  it("pessoa ainda sem id no Pipedrive é erro", () => {
    expect(toPdLead({ ...lead, person_id: NEW_PER }, ctx)).toEqual({ error: "pessoa ainda sem id no Pipedrive" });
  });

  it("sem pessoa nem organização não cria (o Pipedrive exige um dos dois); a atualização vai sem as duas chaves", () => {
    for (const links of [
      { person_id: null, organization_id: null },
      { person_id: GONE_PER, organization_id: GONE_ORG },
    ]) {
      const p = toPdLead({ ...lead, ...links }, ctx);
      expect(p).toMatchObject({ createError: "lead sem pessoa nem organização (o Pipedrive exige um dos dois)" });
      expect(bodyOf(p)).not.toHaveProperty("person_id");
      expect(bodyOf(p)).not.toHaveProperty("organization_id");
      expect(bodyOf(p).title).toBe("Lead Acme");
    }
  });

  it("pessoa na lixeira do CRM vira vínculo vazio, e o lead vai pela organização", () => {
    const p = toPdLead({ ...lead, person_id: GONE_PER }, ctx);
    expect(p).not.toHaveProperty("createError");
    expect(bodyOf(p)).toMatchObject({ person_id: null, organization_id: 8 });
  });
});

describe("toPdDeal", () => {
  const deal = {
    id: DEAL,
    company_id: C1,
    owner_id: U1,
    title: "Negócio A",
    pipeline_id: "99999999-9999-4999-8999-999999999999",
    stage_id: STAGE,
    status: "open",
    lost_reason_id: null,
    lost_reason: null,
    estimated_value: 5000,
    expected_close_date: "2026-12-01",
    person_id: PER,
    organization_id: ORG,
    setup_total: 3000,
    mrr: 1500.5,
    contract_months: 12,
    custom_fields: {
      temperatura: "Quente",
      stack: ["Next", "Supabase"],
      responsavel: U1,
      observacao: "cliente antigo",
      inicio: "2026-11-20",
    },
  };

  it("campos básicos, vínculos, dono, etapa e campos personalizados", () => {
    expect(toPdDeal(deal, ctx)).toEqual({
      path: "/v1/deals",
      body: {
        title: "Negócio A",
        value: 5000,
        currency: "BRL",
        person_id: 7,
        org_id: 8,
        user_id: 5,
        stage_id: 10,
        status: "open",
        expected_close_date: "2026-12-01",
        hash_setup: 3000,
        hash_mrr: 1500.5,
        hash_months: 12,
        hash_temp: 7,
        hash_stack: "1,2",
        hash_user: 5,
        hash_obs: "cliente antigo",
        hash_inicio: "2026-11-20",
      },
    });
  });

  it("perdido leva o motivo; ganho não leva", () => {
    const lost = bodyOf(toPdDeal({ ...deal, status: "lost", lost_reason: { name: "Preço" } }, ctx));
    expect(lost).toMatchObject({ status: "lost", lost_reason: "Preço" });
    const won = bodyOf(toPdDeal({ ...deal, status: "won", lost_reason: { name: "Preço" } }, ctx));
    expect(won.status).toBe("won");
    expect(won).not.toHaveProperty("lost_reason");
  });

  it("etapa sem correspondente no Pipedrive é erro", () => {
    expect(toPdDeal({ ...deal, stage_id: NEW_STAGE }, ctx)).toEqual({
      error: `etapa ${NEW_STAGE} sem correspondente no Pipedrive`,
    });
  });

  it("pessoa ainda sem id no Pipedrive é erro", () => {
    expect(toPdDeal({ ...deal, person_id: NEW_PER }, ctx)).toEqual({ error: "pessoa ainda sem id no Pipedrive" });
  });

  it("sem pessoa nem organização não cria; a atualização vai sem as duas; só com a organização vai a pessoa null", () => {
    const p = toPdDeal({ ...deal, person_id: GONE_PER, organization_id: null }, ctx);
    expect(p).toMatchObject({
      createError: "negócio sem pessoa nem organização (o Pipedrive exige um dos dois)",
      body: { title: "Negócio A", status: "open", stage_id: 10 },
    });
    expect(bodyOf(p)).not.toHaveProperty("person_id");
    expect(bodyOf(p)).not.toHaveProperty("org_id");
    expect(bodyOf(toPdDeal({ ...deal, person_id: null }, ctx))).toMatchObject({ person_id: null, org_id: 8 });
    expect(toPdDeal({ ...deal, person_id: null }, ctx)).not.toHaveProperty("createError");
  });

  it("pessoa na lixeira do CRM vira vínculo vazio (não espera por ela)", () => {
    expect(bodyOf(toPdDeal({ ...deal, person_id: GONE_PER }, ctx))).toMatchObject({ person_id: null, org_id: 8 });
  });

  it("dono sem usuário no Pipedrive fica de fora", () => {
    expect(bodyOf(toPdDeal({ ...deal, owner_id: U2 }, ctx))).not.toHaveProperty("user_id");
  });

  it("campos vazios vão null; opção ou usuário sem correspondente ficam de fora", () => {
    const b = bodyOf(
      toPdDeal(
        {
          ...deal,
          estimated_value: null,
          expected_close_date: null,
          setup_total: 0,
          mrr: 0,
          contract_months: null,
          custom_fields: { temperatura: "Morno", stack: [], responsavel: U2 },
        },
        ctx,
      ),
    );
    expect(b).toMatchObject({
      value: 0,
      expected_close_date: null,
      hash_setup: null,
      hash_mrr: null,
      hash_months: null,
      hash_stack: null,
      hash_obs: null,
      hash_inicio: null,
    });
    expect(b).not.toHaveProperty("hash_temp");
    expect(b).not.toHaveProperty("hash_user");
  });

  it("opção de seleção casa sem diferenciar acento e maiúsculas", () => {
    expect(bodyOf(toPdDeal({ ...deal, custom_fields: { temperatura: "quente" } }, ctx)).hash_temp).toBe(7);
  });
});

describe("toPdActivity", () => {
  const meeting = {
    id: "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1",
    company_id: C1,
    owner_id: U1,
    subject: "Reunião de diagnóstico",
    description: "Pauta:\nescopo & prazo",
    due_at: "2026-11-12T12:00:00+00:00",
    duration_minutes: 90,
    done: true,
    meeting_outcome: "held",
    outcome_id: "b2b2b2b2-b2b2-4b2b-8b2b-b2b2b2b2b2b2",
    outcome: { name: "Concluída qualificada" },
    activity_type: { name: "Reunião", is_meeting: true },
    deal_id: DEAL,
    lead_id: null,
    person_id: PER,
    organization_id: ORG,
  };

  it("tipo, data e hora em UTC, duração, concluída, resultado, descrição, vínculos e dono", () => {
    expect(toPdActivity(meeting, ctx)).toEqual({
      path: "/v1/activities",
      body: {
        subject: "Reunião de diagnóstico",
        type: "meeting",
        due_date: "2026-11-12",
        due_time: "12:00",
        duration: "01:30",
        done: 1,
        note: "Pauta:<br>escopo &amp; prazo",
        deal_id: 100,
        person_id: 7,
        org_id: 8,
        user_id: 5,
        outcome: 21,
      },
    });
  });

  it("horário em outro fuso vira UTC (o inverso de dueAt)", () => {
    const b = bodyOf(toPdActivity({ ...meeting, due_at: "2026-11-12T22:30:00-03:00" }, ctx));
    expect(b).toMatchObject({ due_date: "2026-11-13", due_time: "01:30" });
    const pg = bodyOf(toPdActivity({ ...meeting, due_at: "2026-11-12 15:00:00+00" }, ctx));
    expect(pg).toMatchObject({ due_date: "2026-11-12", due_time: "15:00" });
  });

  it("reunião não realizada usa o rótulo do desfecho; realizada sem qualificação não manda resultado", () => {
    const noShow = { ...meeting, meeting_outcome: "no_show", outcome_id: null, outcome: null };
    expect(bodyOf(toPdActivity(noShow, ctx)).outcome).toBe(22);
    const canceled = { ...noShow, meeting_outcome: "canceled" };
    expect(bodyOf(toPdActivity(canceled, ctx)).outcome).toBe(24);
    const held = { ...noShow, meeting_outcome: "held" };
    expect(bodyOf(toPdActivity(held, ctx))).not.toHaveProperty("outcome");
  });

  it("o tipo sai do nome do tipo, de reunião e do canal (o canal vem do embed)", () => {
    const task = { ...meeting, activity_type: { name: "Tarefa", is_meeting: false }, meeting_outcome: null, outcome: null };
    expect(bodyOf(toPdActivity({ ...task, channel: { name: "WhatsApp" } }, ctx)).type).toBe("whatsapp");
    expect(bodyOf(toPdActivity({ ...task, channel: { name: "Não informado" } }, ctx)).type).toBe("task");
    expect(bodyOf(toPdActivity({ ...task, channel: null }, ctx)).type).toBe("task");
  });

  it("tentativa concluída leva o resultado pelo inverso da importação", () => {
    const call = {
      ...meeting,
      subject: "Ligar",
      activity_type: { name: "Ligação", is_meeting: false },
      meeting_outcome: null,
      outcome: { name: "Conversa realizada" },
    };
    expect(bodyOf(toPdActivity(call, ctx))).toMatchObject({ type: "call", outcome: 23 });
    expect(bodyOf(toPdActivity({ ...call, outcome: { name: "Inventado" } }, ctx))).not.toHaveProperty("outcome");
  });

  it("aberta vai com done 0 e sem resultado; sem descrição a nota vai vazia; duração zero fica de fora", () => {
    const b = bodyOf(
      toPdActivity({ ...meeting, done: false, meeting_outcome: null, outcome: null, description: null, duration_minutes: 0 }, ctx),
    );
    expect(b).toMatchObject({ done: 0, note: "" });
    expect(b).not.toHaveProperty("outcome");
    expect(b).not.toHaveProperty("duration");
  });

  it("vínculo com lead usa o uuid do Pipedrive; vínculos vazios ficam de fora", () => {
    const b = bodyOf(toPdActivity({ ...meeting, deal_id: null, person_id: null, organization_id: null, lead_id: LEAD }, ctx));
    expect(b.lead_id).toBe(PD_LEAD);
    expect(b).not.toHaveProperty("deal_id");
    expect(b).not.toHaveProperty("person_id");
    expect(b).not.toHaveProperty("org_id");
  });

  it("descrição já em HTML (importada) vai como está", () => {
    expect(bodyOf(toPdActivity({ ...meeting, description: "<p>Pauta</p>" }, ctx)).note).toBe("<p>Pauta</p>");
  });

  it("dono sem usuário no Pipedrive fica de fora", () => {
    expect(bodyOf(toPdActivity({ ...meeting, owner_id: U2 }, ctx))).not.toHaveProperty("user_id");
  });

  it("relacionado ainda sem id no Pipedrive é erro", () => {
    expect(toPdActivity({ ...meeting, person_id: NEW_PER }, ctx)).toEqual({ error: "pessoa ainda sem id no Pipedrive" });
  });

  it("relacionado na lixeira do CRM fica de fora; só com vínculos na lixeira, a atualização vai e a criação não", () => {
    const p = toPdActivity({ ...meeting, deal_id: GONE_DEAL }, ctx);
    expect(p).not.toHaveProperty("createError");
    expect(bodyOf(p)).not.toHaveProperty("deal_id");
    expect(bodyOf(p)).toMatchObject({ person_id: 7, org_id: 8 });

    const orphan = toPdActivity({ ...meeting, deal_id: GONE_DEAL, person_id: GONE_PER, organization_id: null }, ctx);
    expect(orphan).toMatchObject({ createError: "atividade só com vínculos na lixeira do CRM", body: { subject: "Reunião de diagnóstico" } });
    expect(bodyOf(orphan)).not.toHaveProperty("deal_id");
    expect(bodyOf(orphan)).not.toHaveProperty("person_id");
  });

  it("sem tipo carregado, sem data ou sem vínculo é erro", () => {
    expect(toPdActivity({ ...meeting, activity_type: null }, ctx)).toEqual({ error: "atividade sem o tipo carregado" });
    expect(toPdActivity({ ...meeting, due_at: null }, ctx)).toEqual({ error: "atividade sem data" });
    expect(
      toPdActivity({ ...meeting, deal_id: null, lead_id: null, person_id: null, organization_id: null }, ctx),
    ).toEqual({ error: "atividade sem negócio, lead, pessoa ou organização" });
  });
});

describe("toPdNote", () => {
  const note = {
    id: "c3c3c3c3-c3c3-4c3c-8c3c-c3c3c3c3c3c3",
    company_id: C1,
    entity: "deals",
    record_id: DEAL,
    body: "Linha 1\nLinha <2>",
    created_by: U1,
  };

  it("conteúdo em HTML, vínculo e autor", () => {
    expect(toPdNote(note, ctx)).toEqual({
      path: "/v1/notes",
      body: { content: "Linha 1<br>Linha &lt;2&gt;", deal_id: 100, user_id: 5 },
    });
  });

  it("vínculo pelo tipo do registro", () => {
    expect(bodyOf(toPdNote({ ...note, entity: "leads", record_id: LEAD }, ctx))).toMatchObject({ lead_id: PD_LEAD });
    expect(bodyOf(toPdNote({ ...note, entity: "persons", record_id: PER }, ctx))).toMatchObject({ person_id: 7 });
    expect(bodyOf(toPdNote({ ...note, entity: "organizations", record_id: ORG }, ctx))).toMatchObject({ org_id: 8 });
  });

  it("conteúdo já em HTML vai como está; autor sem usuário fica de fora", () => {
    const b = bodyOf(toPdNote({ ...note, body: "<p>Resumo</p>", created_by: U2 }, ctx));
    expect(b.content).toBe("<p>Resumo</p>");
    expect(b).not.toHaveProperty("user_id");
  });

  it("registro ainda sem id no Pipedrive é erro; vazia é erro", () => {
    expect(toPdNote({ ...note, entity: "persons", record_id: NEW_PER }, ctx)).toEqual({
      error: "pessoa ainda sem id no Pipedrive",
    });
    expect(toPdNote({ ...note, body: "  " }, ctx)).toEqual({ error: "anotação vazia" });
  });

  it("registro vinculado na lixeira do CRM: a atualização vai só com o conteúdo, e a criação não", () => {
    expect(toPdNote({ ...note, record_id: GONE_DEAL }, ctx)).toEqual({
      path: "/v1/notes",
      body: { content: "Linha 1<br>Linha &lt;2&gt;", user_id: 5 },
      createError: "anotação de um registro na lixeira do CRM",
    });
  });
});
