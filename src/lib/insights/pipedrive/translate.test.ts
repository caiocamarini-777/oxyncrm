import { describe, expect, it } from "vitest";
import type { Catalog, CatalogField } from "../types";
import { MISSING_ID, pdCompanies, translateReport, type PdMeta, type PdReport, type Target } from "./translate";

const f = (id: string, name: string, type: CatalogField["type"], roles: string, opts: CatalogField["opts"] = null): CatalogField => ({
  id,
  name,
  type,
  roles,
  opts,
  agg: null,
  rts: null,
  custom: false,
  operators: ["isExactly", "isNot", "isAnyOf", "isNotAnyOf", "isEmpty", "isNotEmpty"],
});

const catalog: Catalog = {
  report_types: [],
  fields: {
    leads: [
      f("addTime", "Lead criado em", "DATE_TIME", "fgc"),
      f("label", "Etiqueta", "MULTIPLE_OPTIONS", "fgsc", "labels"),
      f("channel", "Canal de origem", "SINGLE_OPTION", "fgsc", "channels"),
      f("active", "Ativo", "BOOLEAN", "f", [["true", "Sim"], ["false", "Não"]]),
      f("status", "Status do lead", "SINGLE_OPTION", "fgsc", [["open", "Aberto"]]),
      f("title", "Título", "TEXT", "fgsc"),
    ],
    activities: [
      f("type", "Tipo", "SINGLE_OPTION", "fgsc", "kinds"),
      f("outcome", "Resultado", "SINGLE_OPTION", "fgsc", "outcomes"),
      f("meetingOutcome", "Resultado da reunião", "SINGLE_OPTION", "fgsc", [["held", "Realizada"], ["no_show", "Não compareceu"], ["rescheduled", "Reagendada"]]),
      f("dueDate", "Data de vencimento", "DATE", "fgc"),
      f("writerId", "Criador", "USER", "fgsc", "users"),
    ],
    people: [{ ...f("canal_de_origem", "Canal de origem", "SINGLE_OPTION", "fgsc", [["Jitterbit", "Jitterbit"], ["Fórum", "Fórum"]]), custom: true }, f("label", "Etiqueta", "MULTIPLE_OPTIONS", "fgsc", "labels")],
    deals: [
      { ...f("empresa_proprietaria", "Empresa Proprietária", "MULTIPLE_OPTIONS", "fgsc", [["OMNI11", "OMNI11"], ["OXYN", "OXYN"]]), custom: true },
      f("expectedCloseDateOrWonTime", "Período de previsão", "DATE", "fgc"),
      f("status", "Status", "SINGLE_OPTION", "fgsc", [["open", "Aberto"], ["won", "Ganho"]]),
    ],
    organizations: [],
  },
  links: {
    activities: { lead_id_: "leads", person_id_: "people" },
    leads: { person_id_: "people", activity_id_: "activities" },
    deals: {},
    organizations: {},
    people: {},
  },
  options: {
    labels: [{ id: "lb-base", label: "BASE" }],
    channels: [{ id: "ch-bs", label: "Brasil Sessions Ribeirão 26" }],
    outcomes: [
      { id: "oc-q", label: "Concluída qualificada" },
      { id: "oc-ag", label: "Reunião agendada" },
    ],
    kinds: [
      { id: "k-meet", label: "Reunião" },
      { id: "k-wa", label: "WhatsApp" },
    ],
  },
};

const meta: PdMeta = {
  fieldName: (_e, id) =>
    ({ "5f8530e6e9353e0ddcf29f7956686afe321827c0": "Empresa Proprietária", "462977b171ad07a63eb34997337394051e071fd9": "Canal de origem", person_id_462977b171ad07a63eb34997337394051e071fd9: "Canal de origem" } as Record<string, string>)[id] ?? null,
  optionName: (_e, id, v) =>
    ({
      "label:c5d4": "OMNI11",
      "5f8530e6e9353e0ddcf29f7956686afe321827c0:OMNI11": "OMNI11",
      "5f8530e6e9353e0ddcf29f7956686afe321827c0:OXYN": "OXYN",
      "label:base": "BASE",
      "lead_id_label:c5d4": "OMNI11",
      "person_id_label:150": "OMNI11",
      "channel:102": "Brasil Sessions Ribeirão 26",
      "outcome:91": "Concluída Qualificada",
      "outcome:69": "Reunião Agendada",
      "outcome:89": "Não compareceu",
      "outcome:90": "Remarcada",
      "person_id_462977b171ad07a63eb34997337394051e071fd9:111": "Jitterbit",
    } as Record<string, string>)[`${id}:${v}`] ?? null,
  userEmail: (id) => (id === "25968736" ? "leonardo@oxyn.test" : null),
  stage: () => null,
  pipelineName: () => null,
};

const target: Target = {
  catalog,
  users: [{ id: "u-leo", email: "leonardo@oxyn.test", name: "Leonardo" }],
  companyLabels: new Set(["omni11", "harpix", "naia", "oxyn"]),
  mainPipelineId: null,
};

const rep = (over: Partial<PdReport>): PdReport => ({
  id: "x",
  name: "Omni11 LEADS - Abertos",
  data_type: "leads",
  report_type: "performance",
  chart_type: "scorecard",
  parameters: { measure_by: "count", filter_by: [] },
  columns: [],
  ...over,
});

describe("tradução do Pipedrive", () => {
  it("tira a etiqueta da empresa e mantém período e ativo", () => {
    const { def, notes } = translateReport(
      rep({
        parameters: {
          measure_by: "count",
          group_by: { filter: "label", interval: false },
          filter_by: [
            { filter: "label", operands: [{ name: "isAnyOf", defaultValue: ["c5d4"] }], period: null },
            { filter: "addTime", operands: [{ name: "isMoreThan", defaultValue: "2026-10-01" }, { name: "format", defaultValue: "yyyy-MM-dd" }], period: "month" },
            { filter: "active", operands: [{ name: "isExactly", defaultValue: true }], period: null },
          ],
        },
      }),
      meta,
      target,
    );
    expect(def?.parameters.filter_by).toEqual([
      { filter: "addTime", type: "DATE_TIME", period: "month", operands: [] },
      { filter: "active", type: "BOOLEAN", period: null, operands: [{ name: "isExactly", defaultValue: true }] },
    ]);
    expect(notes.some((n) => n.includes("etiqueta da empresa"))).toBe(true);
  });

  it("'não é' etiqueta de outra empresa sai; canal vira o id do Oxyn", () => {
    const { def } = translateReport(
      rep({
        data_type: "activities",
        chart_type: "column",
        parameters: {
          measure_by: "count",
          group_by: { filter: "type" },
          filter_by: [
            { filter: "person_id_label", operands: [{ name: "isNot", defaultValue: "150" }], period: null },
            { filter: "lead_id_channel", operands: [{ name: "isExactly", defaultValue: "102" }], period: null },
            { filter: "type", operands: [{ name: "isExactly", defaultValue: "reuniao" }], period: null },
          ],
        },
      }),
      meta,
      target,
    );
    expect(def?.parameters.filter_by).toEqual([
      { filter: "lead_id_channel", type: "SINGLE_OPTION", period: null, operands: [{ name: "isExactly", defaultValue: "ch-bs" }] },
      { filter: "type", type: "SINGLE_OPTION", period: null, operands: [{ name: "isExactly", defaultValue: "k-meet" }] },
    ]);
  });

  it("etiqueta da empresa no registro ligado vira 'tem registro ligado'", () => {
    const { def } = translateReport(
      rep({
        data_type: "activities",
        parameters: { measure_by: "count", filter_by: [{ filter: "lead_id_label", operands: [{ name: "isExactly", defaultValue: "c5d4" }], period: "month" }] },
      }),
      meta,
      target,
    );
    expect(def?.parameters.filter_by).toEqual([{ filter: "lead_id_title", type: "TEXT", period: null, operands: [{ name: "isNotEmpty", defaultValue: true }] }]);
  });

  it("resultado: tentativa pelo nome; Não compareceu/Remarcada viram resultado da reunião", () => {
    const { def } = translateReport(
      rep({
        data_type: "activities",
        chart_type: "pie",
        parameters: {
          measure_by: "count",
          group_by: { filter: "type" },
          filter_by: [
            { filter: "outcome", operands: [{ name: "isNotAnyOf", defaultValue: [89, 90] }], period: null },
            { filter: "outcome", operands: [{ name: "isAnyOf", defaultValue: [91, 69] }], period: null },
          ],
        },
      }),
      meta,
      target,
    );
    expect(def?.parameters.filter_by).toEqual([
      { filter: "meetingOutcome", type: "SINGLE_OPTION", period: null, operands: [{ name: "isNotAnyOf", defaultValue: ["no_show", "rescheduled"] }] },
      { filter: "outcome", type: "SINGLE_OPTION", period: null, operands: [{ name: "isAnyOf", defaultValue: ["oc-q", "oc-ag"] }] },
    ]);
  });

  it("campo personalizado da pessoa e usuário pelo e-mail; referência ausente vira MISSING", () => {
    const { def } = translateReport(
      rep({
        data_type: "activities",
        parameters: {
          measure_by: "count",
          filter_by: [
            { filter: "person_id_462977b171ad07a63eb34997337394051e071fd9", operands: [{ name: "isExactly", defaultValue: "111" }], period: null },
            { filter: "writerId", operands: [{ name: "isExactly", defaultValue: "25968736" }], period: null },
            { filter: "lead_id_channel", operands: [{ name: "isExactly", defaultValue: "999" }], period: null },
          ],
        },
      }),
      meta,
      target,
    );
    expect(def?.parameters.filter_by.map((x) => [x.filter, x.operands[0]!.defaultValue])).toEqual([
      ["person_id_canal_de_origem", "Jitterbit"],
      ["writerId", "u-leo"],
      ["lead_id_channel", MISSING_ID],
    ]);
  });

  it("campo sem correspondente sai (com aviso) e o tipo não suportado não traduz", () => {
    const r = translateReport(rep({ parameters: { measure_by: "count", filter_by: [{ filter: "leadSource", operands: [{ name: "isExactly", defaultValue: "1" }], period: null }] } }), meta, target);
    expect(r.def?.parameters.filter_by).toEqual([]);
    expect(r.notes[0]).toContain("leadSource");
    expect(translateReport(rep({ data_type: "projects" }), meta, target).def).toBeNull();
  });
});

describe("empresa do relatório", () => {
  const companies = new Set(["omni11", "harpix", "naia", "oxyn", "equilibrion"]);
  it("pela etiqueta, pela Empresa Proprietária e pelo nome", () => {
    expect(pdCompanies(rep({ parameters: { filter_by: [{ filter: "label", operands: [{ name: "isAnyOf", defaultValue: ["c5d4"] }] }] } }), meta, companies)).toEqual(["omni11"]);
    expect(
      pdCompanies(
        rep({ data_type: "deals", parameters: { filter_by: [{ filter: "5f8530e6e9353e0ddcf29f7956686afe321827c0", operands: [{ name: "isAnyOf", defaultValue: ["OMNI11", "OXYN"] }] }] } }),
        meta,
        companies,
      ).sort(),
    ).toEqual(["omni11", "oxyn"]);
    expect(pdCompanies(rep({ name: "PIPELINE GERAL - EQUILIBRION", parameters: {} }), meta, companies)).toEqual(["equilibrion"]);
    expect(pdCompanies(rep({ name: "Relatório de nova atividade", parameters: {} }), meta, companies)).toEqual([]);
  });
  it("o filtro de Empresa Proprietária sai como a etiqueta", () => {
    const { def } = translateReport(
      rep({
        data_type: "deals",
        report_type: "revenue_forecast",
        chart_type: "column",
        parameters: {
          measure_by: "count",
          group_by: { filter: "expectedCloseDateOrWonTime", interval: "month" },
          filter_by: [{ filter: "5f8530e6e9353e0ddcf29f7956686afe321827c0", operands: [{ name: "isAnyOf", defaultValue: ["OMNI11"] }], period: null }],
        },
      }),
      meta,
      target,
    );
    expect(def?.parameters.filter_by).toEqual([]);
  });
});
