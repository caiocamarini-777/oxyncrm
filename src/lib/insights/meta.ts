/** Rótulos e descrições do Insights (como no Pipedrive), para a tela. */
import type { ChartType, DataType, Interval, Operator, PeriodKey } from "./types";

/** Entidades do diálogo "Adicionar novo relatório" e os tipos de relatório de cada uma. */
export type EntityChoice = {
  key: string;
  label: string;
  icon: "activity" | "contact" | "lead" | "deal" | "forecast";
  types: { dataType: DataType; reportType: string; label: string; description: string }[];
};

export const ENTITIES: EntityChoice[] = [
  {
    key: "activity",
    label: "Atividade",
    icon: "activity",
    types: [
      { dataType: "activities", reportType: "performance", label: "Desempenho", description: "Quantas atividades foram feitas, por tipo, resultado ou usuário?" },
    ],
  },
  {
    key: "contact",
    label: "Contato",
    icon: "contact",
    types: [
      { dataType: "people", reportType: "performance", label: "Pessoas", description: "Quantas pessoas foram criadas e com quantas atividades e negócios?" },
      { dataType: "organizations", reportType: "performance", label: "Organizações", description: "Quantas organizações foram criadas e com quantas atividades e negócios?" },
    ],
  },
  {
    key: "lead",
    label: "Lead",
    icon: "lead",
    types: [
      { dataType: "leads", reportType: "performance", label: "Desempenho", description: "Quantos leads entraram, por canal, etiqueta ou usuário?" },
      { dataType: "leads", reportType: "conversion", label: "Conversão", description: "Quantos leads viraram negócio?" },
    ],
  },
  {
    key: "deal",
    label: "Negócio",
    icon: "deal",
    types: [
      { dataType: "deals", reportType: "stats", label: "Desempenho", description: "Quantos negócios foram iniciados, ganhos ou perdidos?" },
      { dataType: "deals", reportType: "funnel_conversion", label: "Conversão", description: "Qual a conversão de uma etapa para a outra e a taxa de ganho?" },
      { dataType: "deals", reportType: "conversion_overall", label: "Taxa de ganho", description: "Quantos dos negócios fechados foram ganhos ou perdidos?" },
      { dataType: "deals", reportType: "duration", label: "Duração", description: "Quanto tempo os negócios ficam em cada etapa?" },
      { dataType: "deals", reportType: "progress", label: "Progresso", description: "Os negócios estão avançando no funil?" },
      { dataType: "deals", reportType: "product_performance", label: "Produtos", description: "Como está a venda de cada produto?" },
    ],
  },
  {
    key: "forecast",
    label: "Previsão de receita",
    icon: "forecast",
    types: [
      { dataType: "deals", reportType: "revenue_forecast", label: "Previsão de receita", description: "Quanto deve entrar, pelos ganhos e pelo fechamento esperado dos abertos?" },
    ],
  },
];

export function reportTypeLabel(dataType: DataType, reportType: string): string {
  for (const e of ENTITIES) for (const t of e.types) if (t.dataType === dataType && t.reportType === reportType) return t.label;
  return reportType;
}

export function entityOf(dataType: DataType, reportType: string): EntityChoice {
  return (
    ENTITIES.find((e) => e.types.some((t) => t.dataType === dataType && t.reportType === reportType)) ?? ENTITIES[3]!
  );
}

/** Nome da entidade em maiúsculas (como no seletor de filtros do Pipedrive). */
export const DATA_TYPE_LABEL: Record<DataType, string> = {
  deals: "Negócio",
  leads: "Lead",
  activities: "Atividade",
  organizations: "Organização",
  people: "Pessoa",
};

export const DATA_TYPE_PLURAL: Record<DataType, string> = {
  deals: "Negócios",
  leads: "Leads",
  activities: "Atividades",
  organizations: "Organizações",
  people: "Pessoas",
};

export const CHART_LABEL: Record<ChartType, string> = {
  column: "Colunas",
  bar: "Barras",
  pie: "Pizza",
  scorecard: "Número",
  table: "Tabela",
  funnel: "Funil",
};

export const OPERATOR_LABEL: Record<Operator, string> = {
  isExactly: "é",
  isNot: "não é",
  isAnyOf: "é qualquer um de",
  isNotAnyOf: "não é nenhum de",
  isEmpty: "está vazio",
  isNotEmpty: "não está vazio",
  isMoreThan: "é depois de",
  isLessThan: "é antes de",
  contains: "contém",
  notContains: "não contém",
  startsWith: "começa com",
  endsWith: "termina com",
  isExcluding: "exclui",
};

/** Rótulos de "maior que"/"menor que" para números (as datas usam antes/depois). */
export const NUMBER_OPERATOR_LABEL: Partial<Record<Operator, string>> = {
  isMoreThan: "é maior que",
  isLessThan: "é menor que",
};

export const PERIOD_LABEL: Record<PeriodKey, string> = {
  today: "Hoje",
  yesterday: "Ontem",
  tomorrow: "Amanhã",
  week: "Esta semana",
  lastWeek: "Semana passada",
  nextWeek: "Próxima semana",
  month: "Este mês",
  lastMonth: "Mês passado",
  nextMonth: "Próximo mês",
  quarter: "Este trimestre",
  lastQuarter: "Trimestre passado",
  nextQuarter: "Próximo trimestre",
  year: "Este ano",
  lastYear: "Ano passado",
  nextYear: "Próximo ano",
  last7Days: "Últimos 7 dias",
  last30Days: "Últimos 30 dias",
  last90Days: "Últimos 90 dias",
  custom: "Personalizado",
};

/** Ordem do seletor de período (como no Pipedrive). */
export const PERIOD_MENU: PeriodKey[] = [
  "today",
  "yesterday",
  "week",
  "lastWeek",
  "month",
  "lastMonth",
  "quarter",
  "lastQuarter",
  "year",
  "lastYear",
  "last7Days",
  "last30Days",
  "last90Days",
  "nextWeek",
  "nextMonth",
  "nextQuarter",
  "nextYear",
  "custom",
];

export const INTERVAL_LABEL: Record<Interval, string> = {
  day: "Dia",
  week: "Semana",
  month: "Mês",
  quarter: "Trimestre",
  year: "Ano",
};

/** "Colunas por página" do Pipedrive. */
export const CHART_SIZES = [6, 7, 12, 13, 14, 18, 24] as const;

export const SORT_OPTIONS = [
  { key: "default", label: "Padrão" },
  { key: "value_desc", label: "Valor (maior primeiro)" },
  { key: "value_asc", label: "Valor (menor primeiro)" },
  { key: "name", label: "Nome (A-Z)" },
] as const;
export type SortKey = (typeof SORT_OPTIONS)[number]["key"];

export const NO_DATA = "Os resultados não podem ser exibidos com as opções de filtro ou agrupamento atuais.";
