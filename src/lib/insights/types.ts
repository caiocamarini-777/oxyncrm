/**
 * Insights: relatórios e painéis no formato do Pipedrive. A definição do relatório é o mesmo JSON do
 * Insights do Pipedrive (data_type, report_type, chart_type, parameters, columns), mais as cores.
 */
export const DATA_TYPES = ["deals", "leads", "activities", "organizations", "people"] as const;
export type DataType = (typeof DATA_TYPES)[number];

export const CHART_TYPES = ["column", "bar", "pie", "scorecard", "table", "funnel"] as const;
export type ChartType = (typeof CHART_TYPES)[number];

export type FieldType =
  | "TEXT"
  | "USER"
  | "BOOLEAN"
  | "ORGANIZATION"
  | "PERSON"
  | "DEAL"
  | "LEAD"
  | "MONETARY"
  | "NUMERICAL"
  | "SINGLE_OPTION"
  | "MULTIPLE_OPTIONS"
  | "ID"
  | "PRODUCT"
  | "DATE"
  | "DATE_TIME";

export const OPERATORS = [
  "isExactly",
  "isNot",
  "isAnyOf",
  "isNotAnyOf",
  "isEmpty",
  "isNotEmpty",
  "isMoreThan",
  "isLessThan",
  "contains",
  "notContains",
  "startsWith",
  "endsWith",
  "isExcluding",
] as const;
export type Operator = (typeof OPERATORS)[number];

export const PERIODS = [
  "today",
  "yesterday",
  "tomorrow",
  "week",
  "lastWeek",
  "nextWeek",
  "month",
  "lastMonth",
  "nextMonth",
  "quarter",
  "lastQuarter",
  "nextQuarter",
  "year",
  "lastYear",
  "nextYear",
  "last7Days",
  "last30Days",
  "last90Days",
  "custom",
] as const;
export type PeriodKey = (typeof PERIODS)[number];

export const INTERVALS = ["day", "week", "month", "quarter", "year"] as const;
export type Interval = (typeof INTERVALS)[number];

export type Aggregation = "sum" | "avg" | "min" | "max";

export type Operand = { name: Operator | "format"; defaultValue: unknown };

export type InsightFilter = {
  filter: string;
  type?: FieldType;
  operands: Operand[];
  period: PeriodKey | null;
};

export type InsightParameters = {
  group_by?: { filter: string; interval?: Interval | false | null };
  measure_by: string;
  measure_by_aggregation?: Aggregation | null;
  segment_by?: string | null;
  filter_by: InsightFilter[];
  stages?: string[];
  is_cumulative?: boolean;
  chart_size_amount?: number;
};

export type InsightDefinition = {
  data_type: DataType;
  report_type: string;
  chart_type: ChartType;
  parameters: InsightParameters;
  columns: string[];
  colors: Record<string, string>;
};

export type Point = { key: string; label: string };
export type MeasureType = "number" | "currency" | "days";

/** Retorno de insights_run. values[i][j]: x i, segmento j (sem segmento, um valor por x). */
export type InsightResult = {
  x: Point[];
  segments: Point[];
  values: number[][];
  totals?: number[];
  total: number | null;
  previous?: number | null;
  won?: number;
  truncated?: boolean;
  measure: { id: string; label: string; type: MeasureType };
  x_field?: { id: string; label: string; type: FieldType; interval: Interval | null } | null;
  segment_field?: { id: string; label: string; type: FieldType } | null;
  compare?: Omit<InsightResult, "measure" | "compare"> | null;
};

export type RecordsResult = {
  columns: { id: string; label: string; type: "text" | "number" | "currency" | "date" | "datetime" }[];
  rows: unknown[][];
  total: number;
};

export type CatalogField = {
  id: string;
  name: string;
  type: FieldType;
  roles: string;
  opts: string | [string, string][] | null;
  agg: Aggregation | null;
  rts: string[] | null;
  custom: boolean;
  operators: Operator[];
};

export type CatalogOption = { id: string; label: string; active?: boolean; color?: string; pipeline_id?: string };

export type Catalog = {
  report_types: { data_type: DataType; report_type: string; charts: ChartType[]; default_group: string; default_measure: string }[];
  fields: Record<DataType, CatalogField[]>;
  links: Record<DataType, Record<string, DataType>>;
  options: Record<string, CatalogOption[]>;
};

export type Overrides = {
  period?: { period: PeriodKey; from?: string; to?: string } | null;
  user_ids?: string[];
  pipeline_id?: string | null;
  compare?: { kind: "previous" | "custom"; from?: string; to?: string } | null;
};

export type Access = "edit" | "read";

export type ReportRow = {
  id: string;
  companyId: string;
  ownerId: string;
  name: string;
  definition: InsightDefinition;
  updatedAt: string;
};

export type DashboardItem = { reportId: string; x: number; y: number; w: number; h: number };

export type DashboardRow = {
  id: string;
  companyId: string;
  ownerId: string;
  name: string;
};

export type QuickFilters = {
  period: { period: PeriodKey; from?: string; to?: string } | null;
  userIds: string[];
  pipelineId: string | null;
};
