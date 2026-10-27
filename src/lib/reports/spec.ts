import { z } from "zod";
import { UUID_RE } from "@/lib/uuid";
import type { CellType } from "./format";

/**
 * Espelho do motor de relatórios do banco (migrações 20261025000003 e 000004). O banco é a autoridade:
 * as listas abaixo são fechadas e o teste de spec lista as chaves para que qualquer deriva fique visível.
 */

export const BASE_KEYS = ["leads", "deals", "activities", "revenue", "stage_history", "organizations", "persons"] as const;
export type Base = (typeof BASE_KEYS)[number];

export const BASES: { key: Base; label: string }[] = [
  { key: "leads", label: "Leads" },
  { key: "deals", label: "Negócios" },
  { key: "activities", label: "Atividades" },
  { key: "revenue", label: "Receita" },
  { key: "stage_history", label: "Histórico de etapas" },
  { key: "organizations", label: "Organizações" },
  { key: "persons", label: "Pessoas" },
];

/** bar = barras horizontais; column = colunas verticais; list = registros com colunas escolhidas. */
export const CHARTS = ["number", "bar", "column", "line", "funnel", "pie", "table", "list"] as const;
export type Chart = (typeof CHARTS)[number];

/** Tipo do campo no banco (report_field.kind). */
export type FieldKind = "uuid" | "text" | "ts" | "date" | "num" | "team" | "label";

/** Períodos relativos (resolvidos no banco, fuso de São Paulo; semana de domingo a sábado). */
export const RELATIVE_PERIODS = [
  { key: "this_week", label: "Esta semana" },
  { key: "last_week", label: "Semana passada" },
  { key: "this_month", label: "Este mês" },
  { key: "last_month", label: "Mês passado" },
  { key: "this_year", label: "Este ano" },
  { key: "last_year", label: "Ano passado" },
  { key: "last_7_days", label: "Últimos 7 dias" },
  { key: "last_30_days", label: "Últimos 30 dias" },
] as const;
export type RelativePeriod = (typeof RELATIVE_PERIODS)[number]["key"];
export const RELATIVE_KEYS = RELATIVE_PERIODS.map((p) => p.key) as unknown as [RelativePeriod, ...RelativePeriod[]];
export const relativeLabel = (k: string): string | null => RELATIVE_PERIODS.find((p) => p.key === k)?.label ?? null;

export type FieldDef = { key: string; label: string; type: FieldKind; options?: { value: string; label: string }[] };
export type DimensionDef = { key: string; label: string; type: "text" | "month" };
export type MetricOp = "count" | "sum" | "avg" | "conversion_rate" | "avg_days";
export type MetricDef = { key: MetricOp; label: string; type: "number" | "currency" | "percent" | "days" };

const DEAL_STATUS = [
  { value: "open", label: "Aberto" },
  { value: "won", label: "Ganho" },
  { value: "lost", label: "Perdido" },
];

const COMMON_FIELDS: FieldDef[] = [
  { key: "owner", label: "Responsável", type: "uuid" },
  { key: "company", label: "Empresa", type: "uuid" },
  { key: "team", label: "Equipe", type: "team" },
];

const FIELDS: Record<Base, FieldDef[]> = {
  leads: [
    ...COMMON_FIELDS,
    {
      key: "status",
      label: "Status",
      type: "text",
      options: [
        { value: "open", label: "Aberto" },
        { value: "converted", label: "Convertido" },
        { value: "disqualified", label: "Desqualificado" },
        { value: "archived", label: "Arquivado" },
      ],
    },
    { key: "source", label: "Origem", type: "uuid" },
    { key: "label", label: "Etiqueta", type: "label" },
    { key: "created_at", label: "Criado em", type: "ts" },
    { key: "converted_at", label: "Convertido em", type: "ts" },
    { key: "estimated_value", label: "Valor estimado", type: "num" },
    { key: "organization", label: "Organização", type: "uuid" },
    { key: "activities_count", label: "Número de atividades", type: "num" },
    { key: "activity_outcome", label: "Resultado de atividade", type: "uuid" },
    { key: "activity_completed_at", label: "Atividade concluída em", type: "ts" },
    { key: "activity_owner", label: "Responsável pela atividade", type: "uuid" },
  ],
  deals: [
    ...COMMON_FIELDS,
    { key: "pipeline", label: "Funil", type: "uuid" },
    { key: "stage", label: "Etapa", type: "uuid" },
    { key: "status", label: "Status", type: "text", options: DEAL_STATUS },
    { key: "lost_reason", label: "Motivo de perda", type: "uuid" },
    { key: "label", label: "Etiqueta", type: "label" },
    { key: "created_at", label: "Criado em", type: "ts" },
    { key: "won_at", label: "Ganho em", type: "ts" },
    { key: "lost_at", label: "Perdido em", type: "ts" },
    { key: "expected_close_date", label: "Fechamento previsto", type: "date" },
    { key: "contract_value", label: "Valor do contrato", type: "num" },
    { key: "setup_total", label: "Setup", type: "num" },
    { key: "mrr", label: "MRR", type: "num" },
    { key: "estimated_value", label: "Valor estimado", type: "num" },
    { key: "value", label: "Valor do negócio", type: "num" },
    { key: "source", label: "Canal de origem", type: "uuid" },
    { key: "close_or_won", label: "Fechamento (ganho ou previsto)", type: "date" },
    { key: "organization", label: "Organização", type: "uuid" },
  ],
  activities: [
    ...COMMON_FIELDS,
    { key: "type", label: "Tipo", type: "uuid" },
    { key: "channel", label: "Canal", type: "uuid" },
    { key: "outcome", label: "Resultado", type: "uuid" },
    {
      key: "outcome_classification",
      label: "Classificação do resultado",
      type: "text",
      options: [
        { value: "success", label: "Sucesso" },
        { value: "neutral", label: "Neutro" },
        { value: "failure", label: "Fracasso" },
      ],
    },
    {
      key: "meeting_outcome",
      label: "Resultado da reunião",
      type: "text",
      options: [
        { value: "held", label: "Realizada" },
        { value: "no_show", label: "Não compareceu" },
        { value: "rescheduled", label: "Reagendada" },
        { value: "canceled", label: "Cancelada" },
      ],
    },
    { key: "due_at", label: "Vencimento", type: "ts" },
    { key: "completed_at", label: "Concluída em", type: "ts" },
    { key: "created_at", label: "Criada em", type: "ts" },
    {
      key: "done",
      label: "Situação",
      type: "text",
      options: [
        { value: "done", label: "Concluída" },
        { value: "open", label: "A fazer" },
      ],
    },
    { key: "organization", label: "Organização", type: "uuid" },
    { key: "lead", label: "Lead", type: "uuid" },
    { key: "lead_source", label: "Canal de origem do lead", type: "uuid" },
  ],
  revenue: [
    ...COMMON_FIELDS,
    { key: "pipeline", label: "Funil", type: "uuid" },
    { key: "deal_status", label: "Status do negócio", type: "text", options: DEAL_STATUS },
    { key: "month", label: "Mês", type: "date" },
    { key: "setup", label: "Setup", type: "num" },
    { key: "mrr", label: "MRR", type: "num" },
    { key: "total", label: "Total", type: "num" },
  ],
  stage_history: [
    ...COMMON_FIELDS,
    { key: "pipeline", label: "Funil", type: "uuid" },
    { key: "from_stage", label: "Etapa de origem", type: "uuid" },
    { key: "to_stage", label: "Etapa de destino", type: "uuid" },
    { key: "moved_at", label: "Movido em", type: "ts" },
    { key: "deal_status", label: "Status do negócio", type: "text", options: DEAL_STATUS },
    { key: "deal_won_at", label: "Negócio ganho em", type: "ts" },
  ],
  organizations: [
    ...COMMON_FIELDS,
    { key: "created_at", label: "Criada em", type: "ts" },
    { key: "updated_at", label: "Atualizada em", type: "ts" },
    { key: "label", label: "Etiqueta", type: "label" },
    { key: "activities_count", label: "Número de atividades", type: "num" },
    { key: "lead_created_at", label: "Lead criado em", type: "ts" },
    { key: "activity_completed_at", label: "Atividade concluída em", type: "ts" },
    { key: "activity_owner", label: "Responsável pela atividade", type: "uuid" },
  ],
  persons: [
    ...COMMON_FIELDS,
    { key: "created_at", label: "Criada em", type: "ts" },
    { key: "label", label: "Etiqueta", type: "label" },
    { key: "organization", label: "Organização", type: "uuid" },
    { key: "activities_count", label: "Número de atividades", type: "num" },
  ],
};

const D = (key: string, label: string): DimensionDef => ({ key, label, type: "text" });
const MONTH_DIM: DimensionDef = { key: "month", label: "Mês", type: "month" };

const DIMENSIONS: Record<Base, DimensionDef[]> = {
  leads: [D("owner", "Responsável"), D("team", "Equipe"), D("company", "Empresa"), D("status", "Status"),
    D("source", "Canal de origem"), D("label", "Etiqueta"), D("organization", "Organização"), MONTH_DIM],
  deals: [D("owner", "Responsável"), D("team", "Equipe"), D("company", "Empresa"), D("status", "Status"),
    D("pipeline", "Funil"), D("stage", "Etapa"), D("lost_reason", "Motivo de perda"), D("label", "Etiqueta"),
    D("source", "Canal de origem"), D("organization", "Organização"), MONTH_DIM],
  activities: [D("owner", "Responsável"), D("team", "Equipe"), D("company", "Empresa"), D("kind", "Tipo (canal ou reunião)"),
    D("type", "Tipo"), D("channel", "Canal"), D("outcome", "Resultado"), D("outcome_classification", "Classificação do resultado"),
    D("meeting_outcome", "Resultado da reunião"), D("done", "Concluída"), D("organization", "Organização"), MONTH_DIM],
  revenue: [D("owner", "Responsável"), D("company", "Empresa"), D("deal_status", "Status do negócio"),
    D("pipeline", "Funil"), MONTH_DIM],
  stage_history: [D("owner", "Responsável"), D("pipeline", "Funil"), D("from_stage", "Etapa de origem"),
    D("to_stage", "Etapa de destino"), MONTH_DIM],
  organizations: [D("owner", "Responsável"), D("team", "Equipe"), D("company", "Empresa"), D("label", "Etiqueta"), MONTH_DIM],
  persons: [D("owner", "Responsável"), D("team", "Equipe"), D("company", "Empresa"), D("label", "Etiqueta"),
    D("organization", "Organização"), MONTH_DIM],
};

/** Colunas da lista de registros (chart "list"), por base; "custom:<chave>" também vale (exceto atividades). */
export const LIST_COLUMNS: Partial<Record<Base, { key: string; label: string }[]>> = {
  deals: [
    { key: "organization", label: "Organização" }, { key: "title", label: "Título" }, { key: "stage", label: "Etapa" },
    { key: "value", label: "Valor do contrato ou estimado" }, { key: "estimated_value", label: "Valor do negócio" },
    { key: "setup_total", label: "Setup" }, { key: "mrr", label: "MRR" },
    { key: "expected_close_date", label: "Fechamento previsto" }, { key: "source", label: "Canal de origem" },
    { key: "lost_reason", label: "Motivo de perda" }, { key: "status", label: "Status" }, { key: "owner", label: "Responsável" },
    { key: "created_at", label: "Criado em" }, { key: "won_at", label: "Ganho em" }, { key: "lost_at", label: "Perdido em" },
    { key: "pipeline", label: "Funil" }, { key: "person", label: "Pessoa" },
  ],
  leads: [
    { key: "title", label: "Título" }, { key: "organization", label: "Organização" }, { key: "person", label: "Pessoa" },
    { key: "source", label: "Canal de origem" }, { key: "status", label: "Status" }, { key: "estimated_value", label: "Valor estimado" },
    { key: "owner", label: "Responsável" }, { key: "created_at", label: "Criado em" },
  ],
  organizations: [
    { key: "name", label: "Nome" }, { key: "owner", label: "Responsável" }, { key: "created_at", label: "Criada em" },
    { key: "updated_at", label: "Atualizada em" },
  ],
  persons: [
    { key: "name", label: "Nome" }, { key: "organization", label: "Organização" }, { key: "owner", label: "Responsável" },
    { key: "created_at", label: "Criada em" },
  ],
  activities: [
    { key: "subject", label: "Assunto" }, { key: "type", label: "Tipo" }, { key: "channel", label: "Canal" },
    { key: "outcome", label: "Resultado" }, { key: "organization", label: "Organização" }, { key: "person", label: "Pessoa" },
    { key: "owner", label: "Responsável" }, { key: "due_at", label: "Vencimento" }, { key: "completed_at", label: "Concluída em" },
    { key: "done", label: "Situação" },
  ],
};

const METRICS: Record<MetricOp, MetricDef> = {
  count: { key: "count", label: "Quantidade", type: "number" },
  sum: { key: "sum", label: "Soma", type: "currency" },
  avg: { key: "avg", label: "Média", type: "currency" },
  conversion_rate: { key: "conversion_rate", label: "Taxa de conversão", type: "percent" },
  avg_days: { key: "avg_days", label: "Média de dias", type: "days" },
};

const METRIC_OPS: Record<Base, MetricOp[]> = {
  leads: ["count", "sum", "avg", "conversion_rate", "avg_days"],
  deals: ["count", "sum", "avg", "conversion_rate", "avg_days"],
  activities: ["count"],
  revenue: ["count", "sum", "avg"],
  stage_history: ["count", "avg_days"],
  organizations: ["count"],
  persons: ["count"],
};

export const fieldsFor = (base: Base): FieldDef[] => FIELDS[base];
export const dimensionsFor = (base: Base): DimensionDef[] => DIMENSIONS[base];
/** Operações disponíveis na base; sum e avg pedem um campo de `sumFieldsFor`. */
export const metricsFor = (base: Base): MetricDef[] => METRIC_OPS[base].map((op) => METRICS[op]);
/** Campos numéricos (somáveis e médias). */
export const sumFieldsFor = (base: Base): FieldDef[] => FIELDS[base].filter((f) => f.type === "num");
export const fieldDef = (base: Base, key: string): FieldDef | undefined => FIELDS[base].find((f) => f.key === key);

const PERSON_CUSTOM_RE = /^person\.custom:[a-z][a-z0-9_]{0,39}$/;
/** Campo de filtro: do catálogo, personalizado do registro (custom:) ou da pessoa ligada (person.custom:). */
export function filterFieldDef(base: Base, key: string): FieldDef | undefined {
  const own = fieldDef(base, key);
  if (own) return own;
  if (CUSTOM_GROUP_RE.test(key) && ["leads", "deals", "organizations", "persons"].includes(base)) {
    return { key, label: key.slice(7), type: "text" };
  }
  if (PERSON_CUSTOM_RE.test(key) && ["leads", "deals", "activities"].includes(base)) {
    return { key, label: `Pessoa: ${key.slice(14)}`, type: "text" };
  }
  return undefined;
}

/** Agrupar por campo personalizado do tipo seleção só existe em leads e negócios. */
export const CUSTOM_GROUP_BASES: Base[] = ["leads", "deals", "organizations", "persons"];
const CUSTOM_GROUP_RE = /^custom:[a-z][a-z0-9_]{0,39}$/;

/** Mesmo limite do banco. */
export const MAX_FILTERS = 20;
/** Limite da tela: deixa folga para os filtros de dono e equipe que o compartilhamento de dashboard acrescenta. */
export const MAX_FILTERS_UI = 18;
const MAX_IN_VALUES = 500;

// Presets ---------------------------------------------------------------------------------------------------
export const PRESET_KEYS = [
  "channel_funnel",
  "channel_success",
  "conversion_influence",
  "stage_conversion",
  "forecast",
  "revenue_monthly",
  "pipeline_overview",
  "aging",
  "activities_by_user",
  "lost_reasons",
  "goal_progress",
] as const;
export type PresetKey = (typeof PRESET_KEYS)[number];

export type PresetFilterField = "company" | "owner" | "team" | "pipeline";

/** Campos de filtro aceitos por preset (report_preset_filters). */
export const PRESET_FILTER_FIELDS: Record<PresetKey, PresetFilterField[]> = {
  channel_funnel: ["company", "owner", "team"],
  channel_success: ["company", "owner", "team"],
  conversion_influence: ["company", "owner", "team"],
  activities_by_user: ["company", "owner", "team"],
  goal_progress: ["company", "owner", "team"],
  stage_conversion: ["company", "owner", "team", "pipeline"],
  forecast: ["company", "owner", "team", "pipeline"],
  revenue_monthly: ["company", "owner", "team", "pipeline"],
  pipeline_overview: ["company", "owner", "team", "pipeline"],
  aging: ["company", "owner", "team", "pipeline"],
  lost_reasons: ["company", "owner", "team", "pipeline"],
};

// Schema ------------------------------------------------------------------------------------------------------
const isRealDate = (s: string): boolean => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
};

const dateString = z.string().refine(isRealDate, "Data inválida.");
const uuidString = z.string().regex(UUID_RE, "Identificador inválido.");

const FILTER_OPS = ["eq", "in", "not_in", "gte", "lte", "between", "is_null", "not_null"] as const;
export type FilterOp = (typeof FILTER_OPS)[number];

/** Operadores aceitos por tipo de campo (validate_report_custom). */
export function opsForKind(kind: FieldKind): FilterOp[] {
  if (kind === "uuid" || kind === "text") return ["eq", "in", "not_in", "is_null", "not_null"];
  if (kind === "team" || kind === "label") return ["eq", "in"];
  return ["eq", "gte", "lte", "between", "is_null", "not_null"];
}

const filterSchema = z.strictObject({
  field: z.string(),
  op: z.enum(FILTER_OPS, { error: "Operador desconhecido." }),
  value: z.unknown().optional(),
});
export type ReportFilter = z.infer<typeof filterSchema>;

const periodSchema = z.union([
  z.strictObject({ field: z.string(), from: dateString, to: dateString }),
  z.strictObject({ field: z.string(), relative: z.enum(RELATIVE_KEYS, { error: "Período inválido." }) }),
]);
export type ReportPeriod = z.infer<typeof periodSchema>;
const presetPeriodSchema = z.strictObject({ from: dateString, to: dateString });

function scalarOk(kind: FieldKind, v: unknown): boolean {
  switch (kind) {
    case "uuid":
    case "team":
    case "label":
      return uuidString.safeParse(v).success;
    case "text":
      return typeof v === "string" && v.length <= 200;
    case "ts":
    case "date":
      return typeof v === "string" && isRealDate(v);
    case "num":
      return typeof v === "number" && Number.isFinite(v);
  }
}

function checkFilterValue(kind: FieldKind, f: ReportFilter): boolean {
  const v = f.value;
  switch (f.op) {
    case "eq":
    case "gte":
    case "lte":
      return scalarOk(kind, v);
    case "in":
    case "not_in":
      return Array.isArray(v) && v.length >= 1 && v.length <= MAX_IN_VALUES && v.every((x) => scalarOk(kind, x));
    case "between":
      if (!Array.isArray(v) || v.length !== 2 || !v.every((x) => scalarOk(kind, x))) return false;
      return kind === "num" ? (v[0] as number) <= (v[1] as number) : (v[0] as string) <= (v[1] as string);
    case "is_null":
    case "not_null":
      return v === undefined || v === null;
  }
}

const customSchema = z
  .strictObject({
    kind: z.literal("custom"),
    base: z.enum(BASE_KEYS, { error: "Base inválida." }),
    metric: z.strictObject({
      op: z.enum(["count", "sum", "avg", "conversion_rate", "avg_days"], { error: "Métrica inválida." }),
      field: z.string().nullish(),
    }),
    group_by: z.string().nullish(),
    segment_by: z.string().nullish(),
    filters: z.array(filterSchema).max(MAX_FILTERS, `No máximo ${MAX_FILTERS} filtros.`).nullish(),
    period: periodSchema.nullish(),
    chart: z.enum(CHARTS, { error: "Gráfico inválido." }),
    columns: z.array(z.string()).min(1).max(15).nullish(),
    compare: z.boolean().nullish(),
    cumulative: z.boolean().nullish(),
  })
  .superRefine((spec, ctx) => {
    const { base, metric } = spec;
    const issue = (path: (string | number)[], message: string) => ctx.addIssue({ code: "custom", path, message });

    if (!METRIC_OPS[base].includes(metric.op)) {
      issue(["metric", "op"], "Esta métrica não existe para a base escolhida.");
    } else if (metric.op === "sum" || metric.op === "avg") {
      const f = metric.field ? fieldDef(base, metric.field) : undefined;
      if (!f || f.type !== "num") issue(["metric", "field"], "Escolha um campo numérico.");
    } else if (metric.field) {
      issue(["metric", "field"], "Esta métrica não usa campo.");
    }

    const dimOk = (g: string) =>
      DIMENSIONS[base].some((d) => d.key === g) || (CUSTOM_GROUP_BASES.includes(base) && CUSTOM_GROUP_RE.test(g));
    if (spec.group_by && !dimOk(spec.group_by)) issue(["group_by"], "Agrupamento inválido para a base escolhida.");
    if (spec.segment_by) {
      if (!spec.group_by) issue(["segment_by"], "Escolha o agrupamento antes do segmento.");
      else if (!dimOk(spec.segment_by)) issue(["segment_by"], "Segmento inválido para a base escolhida.");
    }

    if (spec.chart === "list") {
      const cols = LIST_COLUMNS[base];
      if (!cols || !spec.columns?.length) issue(["columns"], "Escolha as colunas da lista.");
      else
        spec.columns.forEach((c, i) => {
          const ok = cols.some((x) => x.key === c) || (base !== "activities" && CUSTOM_GROUP_RE.test(c));
          if (!ok) issue(["columns", i], "Coluna inválida para a base escolhida.");
        });
    } else if (spec.columns?.length) {
      issue(["columns"], "Colunas só valem para a lista.");
    }

    (spec.filters ?? []).forEach((f, i) => {
      const def = filterFieldDef(base, f.field);
      if (!def) return issue(["filters", i, "field"], "Campo fora do catálogo da base.");
      if (!opsForKind(def.type).includes(f.op)) return issue(["filters", i, "op"], "Operador inválido para este campo.");
      if (!checkFilterValue(def.type, f)) issue(["filters", i, "value"], "Valor inválido para o filtro.");
    });

    const p = spec.period;
    if (p) {
      const def = fieldDef(base, p.field);
      if (!def || (def.type !== "ts" && def.type !== "date")) {
        issue(["period", "field"], "Escolha um campo de data para o período.");
      }
      if ("from" in p && p.from > p.to) issue(["period", "from"], "A data inicial não pode ser maior que a final.");
    }
  });

const presetSchema = z
  .strictObject({
    kind: z.enum(PRESET_KEYS),
    params: z.record(z.string(), z.unknown()).nullish(),
    filters: z.array(filterSchema).max(MAX_FILTERS, `No máximo ${MAX_FILTERS} filtros.`).nullish(),
    period: presetPeriodSchema.nullish(),
    chart: z.enum(CHARTS, { error: "Gráfico inválido." }).nullish(),
  })
  .superRefine((spec, ctx) => {
    const issue = (path: (string | number)[], message: string) => ctx.addIssue({ code: "custom", path, message });
    const params = spec.params ?? {};
    if (spec.kind === "stage_conversion") {
      const bad = Object.keys(params).some((k) => k !== "pipeline" && k !== "group_by");
      if (bad) issue(["params"], "Parâmetros inválidos.");
      if (!uuidString.safeParse(params.pipeline).success) issue(["params", "pipeline"], "Escolha o funil.");
      const gb = params.group_by;
      if (gb !== undefined && gb !== null && gb !== "owner" && gb !== "month") {
        issue(["params", "group_by"], "Agrupamento inválido.");
      }
    } else if (Object.keys(params).length > 0) {
      issue(["params"], "Este relatório não tem parâmetros.");
    }

    const allowed = PRESET_FILTER_FIELDS[spec.kind] as string[];
    (spec.filters ?? []).forEach((f, i) => {
      if (!allowed.includes(f.field)) return issue(["filters", i, "field"], "Filtro não disponível neste relatório.");
      if (f.op !== "eq" && f.op !== "in") return issue(["filters", i, "op"], "Operador inválido para este campo.");
      if (!checkFilterValue("uuid", f)) issue(["filters", i, "value"], "Valor inválido para o filtro.");
    });

    if (spec.period && spec.period.from > spec.period.to) {
      issue(["period", "from"], "A data inicial não pode ser maior que a final.");
    }
  });

export const reportSpecSchema = z.discriminatedUnion("kind", [customSchema, presetSchema]);
export type ReportSpec = z.infer<typeof reportSpecSchema>;
export type CustomReportSpec = z.infer<typeof customSchema>;
export type PresetReportSpec = z.infer<typeof presetSchema>;

export const isCustomSpec = (s: ReportSpec): s is CustomReportSpec => s.kind === "custom";

/** Resultado de run_report e run_widget. */
export type ResultColumn = { key: string; label: string; type: CellType };
export type ReportResult = {
  columns: ResultColumn[];
  rows: unknown[][];
  total: number | null;
  truncated: boolean;
  /** Gráfico efetivo do widget (run_widget); null em run_report e em preset sem gráfico na spec. */
  chart: Chart | null;
  /** Cartão de número com período: total do período anterior (comparação). */
  previous?: number | null;
};

/** Normaliza a saída crua do banco (campos ausentes viram valores seguros). */
export function toReportResult(raw: unknown): ReportResult {
  const r = (raw ?? {}) as Partial<ReportResult>;
  return {
    columns: Array.isArray(r.columns) ? r.columns : [],
    rows: Array.isArray(r.rows) ? r.rows : [],
    total: typeof r.total === "number" ? r.total : null,
    truncated: r.truncated === true,
    chart: CHARTS.includes(r.chart as Chart) ? (r.chart as Chart) : null,
    ...(r.previous !== undefined ? { previous: typeof r.previous === "number" ? r.previous : null } : {}),
  };
}
