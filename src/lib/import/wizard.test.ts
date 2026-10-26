import { describe, expect, it, vi } from "vitest";
import {
  STEP_LABELS,
  fieldKeyFrom,
  isCustomField,
  stagesFor,
  suggestDraft,
  suggestFieldTarget,
  toMappings,
  validateDraft,
  type Discovery,
  type OxynData,
} from "./wizard";

vi.mock("server-only", () => ({}));

const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";
const PA = "00000000-0000-4000-8000-0000000000a1";
const SA1 = "00000000-0000-4000-8000-0000000000a2";
const SA2 = "00000000-0000-4000-8000-0000000000a3";
const U1 = "00000000-0000-4000-8000-000000000101";
const U2 = "00000000-0000-4000-8000-000000000102";

const DISCOVERY: Discovery = {
  pipelines: [
    { id: "1", name: "HARPIX" },
    { id: "2", name: "OXYN " },
  ],
  stages: [
    { id: "11", pipelineId: "1", name: "Prospecção", order: 1 },
    { id: "12", pipelineId: "1", name: "Proposta enviada", order: 2 },
    { id: "21", pipelineId: "2", name: "Contato", order: 1 },
  ],
  users: [
    { id: "100", name: "Ana", email: "ANA@oxyn.com", active: true },
    { id: "101", name: "Bruno", email: "bruno@outra.com", active: false },
  ],
  labels: [
    { id: "l1", name: "Oxyn" },
    { id: "l2", name: "Hot" },
  ],
  fields: [
    { key: "a".repeat(40), name: "Setup", type: "monetary", entity: "deals" },
    { key: "b".repeat(40), name: "MRR contratado", type: "monetary", entity: "deals" },
    { key: "c".repeat(40), name: "Prazo (meses)", type: "double", entity: "deals" },
    { key: "d".repeat(40), name: "Temperatura", type: "enum", entity: "deals" },
    { key: "e".repeat(40), name: "Canal de origem", type: "enum", entity: "persons" },
  ],
};

const OXYN: OxynData = {
  companies: [
    { id: A, name: "Harpix" },
    { id: B, name: "OXYN" },
  ],
  pipelines: [
    {
      id: PA,
      companyId: A,
      name: "harpix",
      stages: [
        { id: SA1, name: "Prospeccao" },
        { id: SA2, name: "Fechamento" },
      ],
    },
  ],
  profiles: [
    { id: U1, name: "Ana Souza", email: "ana@oxyn.com" },
    { id: U2, name: "Carla", email: "carla@oxyn.com" },
  ],
};

describe("sugestões", () => {
  it("campos nativos por nome sem acento e minúsculo", () => {
    expect(suggestFieldTarget("Setup")).toBe("native:setup_total");
    expect(suggestFieldTarget("  MRR Contratado ")).toBe("native:mrr");
    expect(suggestFieldTarget("Prazo (Meses)")).toBe("native:contract_months");
    expect(suggestFieldTarget("Temperatura")).toBe("custom");
  });

  it("chave do campo a partir do nome", () => {
    expect(fieldKeyFrom("Stack Tecnologia")).toBe("stack_tecnologia");
    expect(fieldKeyFrom("BDR Responsável")).toBe("bdr_responsavel");
    expect(fieldKeyFrom("1º contato")).toBe("campo_1_contato");
    expect(fieldKeyFrom("!!!")).toBe("campo");
    expect(fieldKeyFrom("x".repeat(60))).toHaveLength(40);
  });

  it("campo personalizado do Pipedrive: edit_flag ou chave hash", () => {
    expect(isCustomField({ key: "title", edit_flag: false })).toBe(false);
    expect(isCustomField({ key: "f".repeat(40) })).toBe(true);
    expect(isCustomField({ key: "cargo", edit_flag: true })).toBe(true);
  });

  it("etapas casadas por nome sem acento", () => {
    expect(stagesFor("1", DISCOVERY, OXYN.pipelines[0])).toEqual({ "11": SA1, "12": null });
    expect(stagesFor("1", DISCOVERY, undefined)).toEqual({});
  });

  it("rascunho inicial com as sugestões", () => {
    const d = suggestDraft(DISCOVERY, OXYN, U1);
    expect(d.pipelines["1"]).toEqual({ companyId: A, pipelineId: PA, stages: { "11": SA1, "12": null } });
    // nome com espaço casa a empresa; sem funil com o mesmo nome: criar
    expect(d.pipelines["2"]).toEqual({ companyId: B, pipelineId: null, stages: {} });
    expect(d.users).toEqual({ "100": U1 });
    expect(d.leadLabelCompany).toEqual({ l1: B });
    expect(d.fallbackOwnerId).toBe(U1);
    expect(d.defaultCompanyId).toBe("");
    expect(d.ignorePipelines).toEqual([]);
    expect(d.customFields).toEqual({
      ["a".repeat(40)]: { target: "native:setup_total" },
      ["b".repeat(40)]: { target: "native:mrr" },
      ["c".repeat(40)]: { target: "native:contract_months" },
      ["d".repeat(40)]: { target: "custom", customFieldKey: "temperatura" },
      ["e".repeat(40)]: { target: "custom", customFieldKey: "canal_de_origem" },
    });
  });

  it("funil sem empresa com o mesmo nome fica sem destino", () => {
    const d = suggestDraft(DISCOVERY, { ...OXYN, companies: [] }, U1);
    expect(d.pipelines["1"]).toEqual({ companyId: "", pipelineId: null, stages: {} });
  });
});

describe("validação", () => {
  const valid = () => ({ ...suggestDraft(DISCOVERY, OXYN, U1), defaultCompanyId: A });

  it("rascunho completo vira ImportMappings", () => {
    expect(validateDraft(valid(), DISCOVERY)).toEqual([]);
    const m = toMappings(valid());
    expect(m.ok).toBe(true);
  });

  it("lista os problemas em português", () => {
    const d = valid();
    d.pipelines["2"] = { companyId: "", pipelineId: null, stages: {} };
    d.defaultCompanyId = "";
    d.customFields["d".repeat(40)] = { target: "custom", customFieldKey: "1x" };
    d.customFields["e".repeat(40)] = { target: "native:mrr" };
    const problems = validateDraft(d, DISCOVERY);
    expect(problems).toContain('Escolha a empresa de destino do funil "OXYN" ou marque para ignorar.');
    expect(problems).toContain("Escolha a empresa padrão.");
    expect(problems).toContain('Chave inválida no campo "Temperatura": use letras minúsculas, números e _ (começando por letra).');
    expect(problems).toContain('O campo "Canal de origem" não é de negócio e não pode ir para um campo nativo.');
    expect(toMappings(d).ok).toBe(false);
  });

  it("funil ignorado não precisa de empresa e sai de pipelines", () => {
    const d = valid();
    d.pipelines["2"] = { companyId: "", pipelineId: null, stages: {} };
    d.ignorePipelines = ["2"];
    expect(validateDraft(d, DISCOVERY)).toEqual([]);
    const m = toMappings(d);
    expect(m.ok && Object.keys(m.mappings.pipelines)).toEqual(["1"]);
  });

  it("destino nativo repetido e chave repetida na mesma entidade", () => {
    const d = valid();
    d.customFields["d".repeat(40)] = { target: "native:mrr" };
    expect(validateDraft(d, DISCOVERY)).toContain('Mais de um campo vai para "MRR". Escolha só um.');
    const e = valid();
    e.customFields["a".repeat(40)] = { target: "custom", customFieldKey: "temperatura" };
    expect(validateDraft(e, DISCOVERY)).toContain('A chave "temperatura" está repetida em campos de negócio.');
  });

  it("rótulos das etapas cobrem todas as etapas do motor", async () => {
    const { STEPS } = await import("./engine");
    expect(Object.keys(STEP_LABELS).sort()).toEqual([...STEPS].sort());
  });
});
