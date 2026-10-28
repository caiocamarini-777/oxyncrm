/** Validação (zod) e valores padrão da definição do relatório. O banco valida de novo ao salvar e ao rodar. */
import { z } from "zod";
import {
  CHART_TYPES,
  DATA_TYPES,
  INTERVALS,
  OPERATORS,
  PERIODS,
  type ChartType,
  type DataType,
  type InsightDefinition,
  type InsightFilter,
} from "./types";

/** Espelha insights_report_types(): gráficos aceitos (o primeiro é o padrão), eixo X e medida padrão. */
export const REPORT_TYPES: {
  dataType: DataType;
  reportType: string;
  charts: ChartType[];
  group: string;
  measure: string;
  date: string;
}[] = [
  { dataType: "deals", reportType: "stats", charts: ["column", "bar", "pie", "scorecard", "table"], group: "addTime", measure: "count", date: "addTime" },
  { dataType: "deals", reportType: "conversion_overall", charts: ["column", "bar", "scorecard", "table"], group: "userId", measure: "count", date: "closeTime" },
  { dataType: "deals", reportType: "funnel_conversion", charts: ["funnel", "table"], group: "funnelStage", measure: "count", date: "addTime" },
  { dataType: "deals", reportType: "duration", charts: ["column", "bar", "scorecard", "table"], group: "dealStageLogStageId", measure: "duration", date: "wonTime" },
  { dataType: "deals", reportType: "progress", charts: ["column", "bar", "table"], group: "dealStageLogAddTime", measure: "count", date: "dealStageLogAddTime" },
  { dataType: "deals", reportType: "product_performance", charts: ["column", "bar", "pie", "scorecard", "table"], group: "dealProductsProductId", measure: "dealProductsSum", date: "wonTime" },
  { dataType: "deals", reportType: "revenue_forecast", charts: ["column", "bar", "scorecard", "table"], group: "expectedCloseDateOrWonTime", measure: "value", date: "expectedCloseDateOrWonTime" },
  { dataType: "leads", reportType: "performance", charts: ["column", "bar", "pie", "scorecard", "table"], group: "addTime", measure: "count", date: "addTime" },
  { dataType: "leads", reportType: "conversion", charts: ["column", "bar", "scorecard", "table"], group: "userId", measure: "count", date: "addTime" },
  { dataType: "activities", reportType: "performance", charts: ["column", "bar", "pie", "scorecard", "table"], group: "markedAsDoneTime", measure: "count", date: "markedAsDoneTime" },
  { dataType: "organizations", reportType: "performance", charts: ["column", "bar", "pie", "scorecard", "table"], group: "addTime", measure: "count", date: "addTime" },
  { dataType: "people", reportType: "performance", charts: ["column", "bar", "pie", "scorecard", "table"], group: "addTime", measure: "count", date: "addTime" },
];

export function reportTypeInfo(dataType: DataType, reportType: string) {
  return REPORT_TYPES.find((t) => t.dataType === dataType && t.reportType === reportType) ?? null;
}

export function allowedCharts(dataType: DataType, reportType: string): ChartType[] {
  return reportTypeInfo(dataType, reportType)?.charts ?? [];
}

const operandSchema = z.object({
  name: z.enum([...OPERATORS, "format"]),
  defaultValue: z.unknown(),
});

export const filterSchema = z.object({
  filter: z.string().min(1).max(120),
  type: z.string().max(40).optional(),
  operands: z.array(operandSchema).max(10),
  period: z.enum(PERIODS).nullable().default(null),
});

const HEX = /^#[0-9a-f]{6}$/;

export const definitionSchema = z
  .object({
    data_type: z.enum(DATA_TYPES),
    report_type: z.string().min(1).max(40),
    chart_type: z.enum(CHART_TYPES),
    parameters: z.object({
      group_by: z
        .object({ filter: z.string().min(1).max(120), interval: z.union([z.enum(INTERVALS), z.literal(false), z.null()]).optional() })
        .optional(),
      measure_by: z.string().min(1).max(120).default("count"),
      measure_by_aggregation: z.enum(["sum", "avg", "min", "max"]).nullable().optional(),
      segment_by: z.string().max(120).nullable().optional(),
      filter_by: z.array(filterSchema).max(30).default([]),
      stages: z.array(z.string().max(60)).max(60).optional(),
      is_cumulative: z.boolean().optional(),
      chart_size_amount: z.number().int().min(1).max(60).optional(),
    }),
    columns: z.array(z.string().min(1).max(120)).max(30).default([]),
    colors: z.record(z.string().max(200), z.string().regex(HEX)).default({}),
  })
  .superRefine((d, ctx) => {
    if (!allowedCharts(d.data_type, d.report_type).includes(d.chart_type)) {
      ctx.addIssue({ code: "custom", message: "Gráfico não disponível para este tipo de relatório.", path: ["chart_type"] });
    }
  });

export function parseDefinition(x: unknown): InsightDefinition | null {
  const r = definitionSchema.safeParse(x);
  return r.success ? (r.data as InsightDefinition) : null;
}

export function periodFilter(field: string, period: InsightFilter["period"] = "month"): InsightFilter {
  return { filter: field, type: "DATE_TIME", operands: [], period };
}

/** Definição inicial de um relatório novo: gráfico, eixo e medida padrão, e o período "Este mês". */
export function defaultDefinition(dataType: DataType, reportType: string): InsightDefinition {
  const info = reportTypeInfo(dataType, reportType);
  if (!info) throw new Error(`Tipo de relatório desconhecido: ${dataType}/${reportType}`);
  const dateGroup = info.group === info.date;
  return {
    data_type: dataType,
    report_type: reportType,
    chart_type: info.charts[0]!,
    parameters: {
      group_by: info.group === "funnelStage" ? undefined : { filter: info.group, interval: dateGroup ? "month" : false },
      measure_by: info.measure,
      segment_by: reportType === "stats" ? "status" : null,
      filter_by: [periodFilter(info.date, reportType === "revenue_forecast" ? "year" : "month")],
      stages: reportType === "funnel_conversion" ? [] : undefined,
      is_cumulative: false,
    },
    columns: [],
    colors: {},
  };
}

/** O relatório tem algum filtro de data com período (o filtro de período do painel muda esse relatório). */
export function hasPeriodFilter(def: InsightDefinition, dateFields: Set<string>): boolean {
  return def.parameters.filter_by.some((f) => f.period !== null && dateFields.has(f.filter));
}
