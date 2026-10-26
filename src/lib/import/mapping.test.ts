import { describe, expect, it } from "vitest";
import {
  activityKind,
  channelFor,
  clampMonths,
  companiesForContact,
  dueAt,
  isError,
  leadCompany,
  mapActivity,
  mapDeal,
  mapLead,
  mapNote,
  mapOrganization,
  mapPerson,
  toIso,
  type MapCtx,
} from "./mapping";
import { ImportMappings } from "./pipedrive/types";

const C1 = "11111111-1111-4111-8111-111111111111";
const C2 = "22222222-2222-4222-8222-222222222222";
const P1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const S1 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const U1 = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const FB = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

const mappings: ImportMappings = ImportMappings.parse({
  pipelines: {
    "1": { companyId: C1, pipelineId: P1, stages: { "10": S1, "11": null } },
    "2": { companyId: C2, pipelineId: P1, stages: { "20": S1 } },
    "9": { companyId: C1, pipelineId: P1, stages: { "90": S1 } },
  },
  users: { "5": U1 },
  fallbackOwnerId: FB,
  leadLabelCompany: { "L1": C1, "L2": C2 },
  defaultCompanyId: C2,
  customFields: {
    hash_setup: { target: "native:setup_total" },
    hash_mrr: { target: "native:mrr" },
    hash_months: { target: "native:contract_months" },
    hash_temp: { target: "custom", customFieldKey: "temperatura" },
    hash_stack: { target: "custom", customFieldKey: "stack" },
  },
  ignorePipelines: ["9"],
});

const ctx: MapCtx = {
  mappings,
  companyId: C1,
  fieldOptions: {
    hash_temp: { "7": "Quente", "8": "Frio" },
    hash_stack: { "1": "Next", "2": "Supabase" },
  },
  activityTypeNames: { task: "Whatsapp", deadline: "Prazo" },
  leadLabelNames: { L1: "OXYN", L3: "Hot" },
};

const baseDeal = {
  id: 100,
  title: "Negócio A",
  value: 5000,
  currency: "BRL",
  status: "open",
  owner_id: { value: 5, name: "Ana" },
  person_id: { value: 7, name: "Beto" },
  org_id: 8,
  pipeline_id: 1,
  stage_id: 10,
  add_time: "2024-03-10 14:00:00",
  stage_change_time: "2024-03-11 09:30:00",
  expected_close_date: "2024-05-01",
};

describe("canais e tipos", () => {
  it("channelFor", () => {
    expect(channelFor("call", "Ligação")).toBe("Ligação");
    expect(channelFor("task", "Whatsapp")).toBe("WhatsApp");
    expect(channelFor("deadline", "Prazo")).toBeNull();
    expect(channelFor("linkedin", "Linkedin")).toBe("LinkedIn");
  });
  it("activityKind", () => {
    expect(activityKind("reuniao_realizada")).toBe("meeting");
    expect(activityKind("lunch")).toBe("meeting");
    expect(activityKind("email")).toBe("task");
  });
});

describe("tempo e números", () => {
  it("toIso e dueAt", () => {
    expect(toIso("2024-03-10 14:00:00")).toBe("2024-03-10T14:00:00Z");
    expect(toIso("")).toBeNull();
    expect(dueAt("2024-03-10", "09:30")).toBe("2024-03-10T09:30:00Z");
    expect(dueAt("2024-03-10", "")).toBe("2024-03-10T15:00:00Z");
    expect(dueAt(null, "09:30")).toBeNull();
  });
  it("clampMonths", () => {
    expect(clampMonths(11.6)).toBe(12);
    expect(clampMonths(0)).toBe(1);
    expect(clampMonths(500)).toBe(120);
    expect(clampMonths(undefined)).toBeNull();
  });
});

describe("mapDeal", () => {
  it("usa campos personalizados nativos e custom com rótulos", () => {
    const r = mapDeal(
      { ...baseDeal, hash_setup: 3000, hash_mrr: 1500.5, hash_months: 11.6, hash_temp: 7, hash_stack: "1,2" },
      ctx,
    );
    expect(isError(r)).toBe(false);
    expect(r).toMatchObject({
      external_id: "100",
      company_id: C1,
      owner_id: U1,
      pipeline_id: P1,
      stage_id: S1,
      setup_total: 3000,
      mrr: 1500.5,
      contract_months: 12,
      person_external_id: "7",
      organization_external_id: "8",
      created_at: "2024-03-10T14:00:00Z",
      stage_entered_at: "2024-03-11T09:30:00Z",
      custom_fields: { temperatura: "Quente", stack: ["Next", "Supabase"] },
    });
  });
  it("contract_months ausente vira null", () => {
    expect(mapDeal(baseDeal, ctx)).toMatchObject({ contract_months: null, setup_total: 0, mrr: 0 });
  });
  it("funil ignorado e etapa não mapeada dão erro", () => {
    expect(isError(mapDeal({ ...baseDeal, pipeline_id: 9, stage_id: 90 }, ctx))).toBe(true);
    expect(isError(mapDeal({ ...baseDeal, stage_id: 11 }, ctx))).toBe(true);
    expect(isError(mapDeal({ ...baseDeal, stage_id: 999 }, ctx))).toBe(true);
  });
  it("usa funil/etapa criados quando o mapeamento é null", () => {
    const m2 = ImportMappings.parse({
      ...mappings,
      pipelines: { "1": { companyId: C1, pipelineId: null, stages: { "10": null } } },
    });
    const r = mapDeal(baseDeal, { ...ctx, mappings: m2, resolvedPipelines: { "1": { pipelineId: P1, stages: { "10": S1 } } } });
    expect(r).toMatchObject({ pipeline_id: P1, stage_id: S1 });
    expect(isError(mapDeal(baseDeal, { ...ctx, mappings: m2 }))).toBe(true);
  });
  it("lost preserva o texto do motivo e won_at só em won", () => {
    const lost = mapDeal({ ...baseDeal, status: "lost", lost_time: "2024-04-01 10:00:00", lost_reason: "Sem orçamento" }, ctx);
    expect(lost).toMatchObject({ status: "lost", lost_reason: "Sem orçamento", lost_at: "2024-04-01T10:00:00Z", won_at: null });
    const won = mapDeal({ ...baseDeal, status: "won", won_time: "2024-04-02 10:00:00" }, ctx);
    expect(won).toMatchObject({ won_at: "2024-04-02T10:00:00Z", lost_at: null, lost_reason: null });
  });
  it("usuário sem mapeamento cai em fallbackOwnerId", () => {
    expect(mapDeal({ ...baseDeal, owner_id: 99 }, ctx)).toMatchObject({ owner_id: FB });
    expect(mapDeal({ ...baseDeal, owner_id: undefined }, ctx)).toMatchObject({ owner_id: FB });
  });
});

describe("vínculo com lead de origem", () => {
  it("usa source_lead_id (lead pode não estar mais em /v1/leads) e ignora lead_id/origin", () => {
    expect(mapDeal({ ...baseDeal, source_lead_id: "uuid-convertido", lead_id: "x", origin: "Leads", origin_id: "y" }, ctx)).toMatchObject({ lead_external_id: "uuid-convertido" });
    expect(mapDeal({ ...baseDeal, origin: "Import", origin_id: "y" }, ctx)).toMatchObject({ lead_external_id: null });
  });
  it("lead de /v1/leads/archived entra como archived", () => {
    expect(mapLead({ id: "u2", title: "Velho" }, { ...ctx, archived: true })).toMatchObject({ status: "archived" });
  });
});

describe("mapActivity", () => {
  const act = { id: 1, type: "reuniao_realizada", subject: "Call", done: true, due_date: "2024-03-10", due_time: "", deal_id: 100, user_id: 5 };
  it("reunião realizada concluída recebe held", () => {
    const r = mapActivity({ ...act, marked_as_done_time: "2024-03-10 18:00:00" }, ctx);
    expect(r).toMatchObject({
      type: "meeting",
      meeting_outcome: "held",
      done: true,
      due_at: "2024-03-10T15:00:00Z",
      completed_at: "2024-03-10T18:00:00Z",
      deal_external_id: "100",
      owner_id: U1,
      channel_name: null,
    });
  });
  it("task Whatsapp vira canal WhatsApp", () => {
    expect(mapActivity({ id: 2, type: "task", person_id: 7 }, ctx)).toMatchObject({ type: "task", channel_name: "WhatsApp", done: false, meeting_outcome: null });
  });
  it("sem vínculo dá erro", () => {
    expect(isError(mapActivity({ id: 3, type: "call" }, ctx))).toBe(true);
  });
});

describe("outros mapeadores", () => {
  it("mapOrganization e mapPerson", () => {
    expect(mapOrganization({ id: 8, name: "Acme", owner_id: 5, address: "Rua 1" }, ctx)).toMatchObject({ name: "Acme", address: "Rua 1", owner_id: U1 });
    const p = mapPerson({ id: 7, name: "Beto", org_id: { value: 8 }, email: [{ value: "b@x.com", label: "work", primary: true }, { value: "" }], phone: [{ value: "11999" }] }, ctx);
    expect(p).toMatchObject({ organization_external_id: "8", emails: [{ value: "b@x.com", label: "work" }], phones: [{ value: "11999" }] });
  });
  it("mapLead: empresa pela etiqueta, etiquetas sem as de empresa", () => {
    const r = mapLead({ id: "uuid-1", title: "L", label_ids: ["L3", "L1"], value: { amount: 10, currency: "BRL" }, owner_id: 5, person_id: 7, is_archived: false }, ctx);
    expect(r).toMatchObject({ company_id: C1, labels: ["Hot"], value: 10, status: "open", person_external_id: "7" });
  });
  it("mapNote escolhe o vínculo e exige conteúdo", () => {
    expect(mapNote({ id: 1, content: "oi", deal_id: 100, user_id: 5 }, ctx)).toMatchObject({ entity: "deals", record_external_id: "100", author_id: U1 });
    expect(isError(mapNote({ id: 2, content: "oi" }, ctx))).toBe(true);
  });
});

describe("empresas", () => {
  it("leadCompany pela etiqueta, senão default", () => {
    expect(leadCompany({ label_ids: ["X", "L1"] }, mappings)).toBe(C1);
    expect(leadCompany({ label_ids: [] }, mappings)).toBe(C2);
  });
  it("companiesForContact: dois funis de empresas diferentes", () => {
    const c = {
      ...ctx,
      contactLinks: {
        "person:7": [
          { type: "deal" as const, pipelineId: 1 },
          { type: "deal" as const, pipelineId: 2 },
          { type: "deal" as const, pipelineId: 9 },
        ],
      },
    };
    expect(companiesForContact("person:7", c).sort()).toEqual([C1, C2].sort());
    expect(companiesForContact("person:404", c)).toEqual([C2]);
    expect(companiesForContact("x", { ...ctx, contactLinks: { x: [{ type: "lead", labelIds: ["L1"] }] } })).toEqual([C1]);
  });
});
