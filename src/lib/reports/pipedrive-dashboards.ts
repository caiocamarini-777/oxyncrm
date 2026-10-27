/**
 * Painéis do Pipedrive reproduzidos no Oxyn (fase 6.5). Fonte: "KPIS - HARPIX novo" (34 relatórios) e
 * "HARPIX - Resultados diretoria" (15), lidos em 2026-10-27; as outras empresas têm a mesma visão.
 *
 * Diferenças assumidas:
 * - A etiqueta da empresa (HARPIX, OMNI11...) vira o escopo de empresa do relatório salvo, não um filtro.
 * - Filtro por criador do registro (creatorUserId) não existe no Oxyn e foi omitido.
 * - "Conversão etapa a etapa" usa o relatório pronto de conversão por etapa (sem período próprio).
 * - "Valor do negócio" é o valor bruto do Pipedrive (estimated_value), não o contrato calculado.
 * - O painel de KPIs abre em "Este mês" (default_filters), como no Pipedrive: só muda os widgets com período.
 *
 * As specs usam referências simbólicas (canal, resultado, tipo de reunião, funil, usuário) resolvidas por empresa.
 */
import type { CustomReportSpec, PresetReportSpec, ReportFilter } from "./spec";

/** Referências que dependem da empresa; o resolvedor devolve o id (ou null quando não existe). */
export type Refs = {
  source(name: string): string | null;
  outcome(name: string): string | null;
  meetingType(): string | null;
  pipeline(): string | null;
  user(email: string): string | null;
};

export type CatalogWidget = {
  title: string;
  colSpan: 1 | 2 | 4;
  rowSpan: 1 | 2;
  spec: CustomReportSpec | PresetReportSpec;
};
export type CatalogDashboard = {
  name: string;
  widgets: CatalogWidget[];
  /** Filtros padrão do painel (como o Pipedrive guarda o filtro rápido). */
  defaultFilters: { period?: { relative: "this_month" } };
};

/** Id que não existe: filtro por referência ausente na empresa não traz nada (em vez de virar "todos"). */
export const MISSING = "00000000-0000-4000-8000-000000000000";

const FORUM = "Fórum E-Commerce Brasil 26";
const JITTERBIT = "Jitterbit";
const SESSIONS = "Brasil Sessions Ribeirão 26";
const LEONARDO = "leonardo.carrel@oxyngroup.com.br";
const MAURO = "mauro@oxyngroup.com.br";
const MEETING_RESULTS = ["Concluída qualificada", "Concluída desqualificada", "Concluída com pendência"];

type Base = CustomReportSpec["base"];
type Period = NonNullable<CustomReportSpec["period"]>;

function custom(
  base: Base,
  chart: CustomReportSpec["chart"],
  opts: Partial<Omit<CustomReportSpec, "kind" | "base" | "chart">> = {},
): CustomReportSpec {
  return { kind: "custom", base, metric: { op: "count" }, chart, ...opts } as CustomReportSpec;
}

const rel = (field: string, relative: "this_week" | "last_week" | "this_month" | "this_year"): Period =>
  ({ field, relative }) as Period;

export function buildCatalog(company: string, r: Refs): CatalogDashboard[] {
  const id = (v: string | null) => v ?? MISSING;
  const eq = (field: string, value: unknown): ReportFilter => ({ field, op: "eq", value });
  const inn = (field: string, value: unknown[]): ReportFilter => ({ field, op: "in", value });
  const meeting = eq("type", id(r.meetingType()));
  const results = inn("outcome", MEETING_RESULTS.map((n) => id(r.outcome(n))));
  const booked = eq("outcome", id(r.outcome("Reunião agendada")));
  const pipeline = eq("pipeline", id(r.pipeline()));
  const openLeads = inn("status", ["open"]);
  const notForum = r.source(FORUM) ? [{ field: "source", op: "not_in", value: [r.source(FORUM)] } as ReportFilter] : [];
  // atividade em lead (o Pipedrive filtra pela etiqueta do lead da atividade)
  const onLead: ReportFilter = { field: "lead", op: "not_null" };
  const attended: ReportFilter = { field: "meeting_outcome", op: "not_in", value: ["no_show", "rescheduled"] };
  const personChannel = (name: string) => eq("person.custom:canal_de_origem", name);
  const ownerOf = (email: string) => eq("owner", id(r.user(email)));
  const C = company;

  const kpis: CatalogWidget[] = [
    // linha 1
    { title: `${C} LEADS - Abertos`, colSpan: 1, rowSpan: 1,
      spec: custom("leads", "number", { filters: [...notForum, openLeads], period: rel("created_at", "this_month") }) },
    { title: `${C} LEADS - Total de organizações criadas`, colSpan: 1, rowSpan: 1,
      spec: custom("organizations", "number", { period: rel("lead_created_at", "this_month") }) },
    { title: `${C} LEADS - Número de atividades`, colSpan: 1, rowSpan: 1,
      spec: custom("activities", "number", { filters: [onLead], period: rel("completed_at", "this_month") }) },
    { title: `${C} LEADS - Atividades por canal`, colSpan: 1, rowSpan: 1,
      spec: custom("activities", "pie", { group_by: "kind", filters: [onLead, attended], period: rel("created_at", "this_month") }) },
    // linha 2
    { title: `${C} LEADS - Abertos mensalmente`, colSpan: 1, rowSpan: 1,
      spec: custom("leads", "bar", { group_by: "month", filters: [...notForum, openLeads] }) },
    { title: `${C} LEADS - Reuniões marcadas`, colSpan: 1, rowSpan: 1,
      spec: custom("activities", "bar", { group_by: "organization", segment_by: "done", filters: [meeting], period: rel("due_at", "this_month") }) },
    { title: `${C} LEADS - Números de qualificados`, colSpan: 1, rowSpan: 1,
      spec: custom("activities", "number", { filters: [meeting, eq("outcome", id(r.outcome(MEETING_RESULTS[0]!)))], period: rel("due_at", "this_month") }) },
    { title: `${C} LEADS - Empresas qualificadas`, colSpan: 1, rowSpan: 1,
      spec: custom("activities", "bar", { group_by: "organization", filters: [meeting, eq("outcome", id(r.outcome(MEETING_RESULTS[0]!)))], period: rel("due_at", "this_month") }) },
    // linha 3
    { title: `${C} LEADS - Origem`, colSpan: 2, rowSpan: 1,
      spec: custom("leads", "column", { group_by: "source", segment_by: "status", period: rel("created_at", "this_month") }) },
    { title: `${C} LEADS - Canal de origem de reuniões`, colSpan: 2, rowSpan: 1,
      spec: custom("activities", "column", { group_by: "kind", filters: [booked], period: rel("completed_at", "this_month") }) },
    // linha 4
    { title: `${C} NEGÓCIOS - Pipeline detalhada`, colSpan: 4, rowSpan: 2,
      spec: custom("deals", "list", {
        filters: [eq("status", "open")],
        columns: ["organization", "title", "stage", "estimated_value", "setup_total", "mrr", "expected_close_date", "custom:temperatura", "source"],
      }) },
    // linha 5
    { title: `${C} NEGÓCIOS - Canal de origem`, colSpan: 2, rowSpan: 1,
      spec: custom("deals", "column", { group_by: "source", segment_by: "status", period: rel("created_at", "this_month") }) },
    { title: `${C} NEGÓCIOS - Conversão etapa a etapa`, colSpan: 2, rowSpan: 1,
      spec: { kind: "stage_conversion", params: { pipeline: id(r.pipeline()) }, chart: "funnel" } as PresetReportSpec },
    // linha 6
    { title: `${C} NEGÓCIOS - Temperatura vs Valor de negócio`, colSpan: 2, rowSpan: 1,
      spec: custom("deals", "column", { metric: { op: "sum", field: "estimated_value" }, group_by: "custom:temperatura", segment_by: "status",
        filters: [eq("status", "open")], period: rel("created_at", "this_year") }) },
    { title: `${C} NEGÓCIOS - Previsão de receita`, colSpan: 2, rowSpan: 1,
      spec: custom("deals", "column", { metric: { op: "sum", field: "estimated_value" }, group_by: "month", segment_by: "status",
        filters: [inn("status", ["won", "open"]), pipeline], period: rel("close_or_won", "this_year"), cumulative: true }) },
    // linha 7
    { title: `${C} TOTAL DE OPORTUNIDADES`, colSpan: 2, rowSpan: 1,
      spec: custom("deals", "number", { filters: [eq("status", "open"), pipeline] }) },
    { title: `${C} NEGÓCIOS - Ganhos`, colSpan: 2, rowSpan: 1,
      spec: custom("deals", "number", { filters: [eq("status", "won")], period: rel("won_at", "this_month") }) },
    // linha 8
    { title: `${C} NEGÓCIOS - Oportunidades abertas mensalmente`, colSpan: 2, rowSpan: 1,
      spec: custom("deals", "column", { group_by: "month", segment_by: "status", period: rel("created_at", "this_year") }) },
    { title: `${C} NEGÓCIOS - Ciclo de vendas (médio)`, colSpan: 2, rowSpan: 1,
      spec: custom("stage_history", "column", { metric: { op: "avg_days" }, group_by: "from_stage",
        filters: [eq("deal_status", "won"), pipeline, { field: "from_stage", op: "not_null" }], period: rel("deal_won_at", "this_year") }) },
    // linha 9
    { title: `${C} NEGÓCIOS - Perdidos por motivo`, colSpan: 2, rowSpan: 1,
      spec: custom("deals", "column", { group_by: "lost_reason", filters: [eq("status", "lost")], period: rel("lost_at", "this_month") }) },
    { title: `${C} NEGÓCIOS - Perdidos por origem`, colSpan: 2, rowSpan: 1,
      spec: custom("deals", "column", { group_by: "source", filters: [eq("status", "lost")], period: rel("lost_at", "this_month") }) },
    // linha 10
    { title: `${C} NEGÓCIOS - Tabela de perdas`, colSpan: 4, rowSpan: 2,
      spec: custom("deals", "list", {
        filters: [eq("status", "lost")],
        period: rel("lost_at", "this_month"),
        columns: ["organization", "title", "stage", "estimated_value", "lost_reason", "source", "created_at", "expected_close_date", "status"],
      }) },
    // linha 11: Fórum E-Commerce
    { title: "CONTATOS FÓRUM ECOMMERCE 2026", colSpan: 1, rowSpan: 1,
      spec: custom("leads", "number", { filters: [personChannel(FORUM)], compare: false }) },
    { title: "LEADS FÓRUM ECOMMERCE CONTATO ATIVO", colSpan: 1, rowSpan: 1,
      spec: custom("leads", "number", { filters: [eq("source", id(r.source(FORUM))), { field: "activities_count", op: "gte", value: 1 }] }) },
    { title: "REUNIÕES REALIZADAS ORIGEM FÓRUM ECOMMERCE", colSpan: 1, rowSpan: 1,
      spec: custom("leads", "number", { filters: [eq("source", id(r.source(FORUM))),
        inn("activity_outcome", MEETING_RESULTS.map((n) => id(r.outcome(n))))] }) },
    { title: "OPORTUNIDADES GERADAS - FÓRUM ECOMMERCE 2026", colSpan: 1, rowSpan: 1,
      spec: custom("deals", "number", { filters: [personChannel(FORUM)], period: rel("created_at", "this_year") }) },
    // linha 12: Jitterbit
    { title: "CONTATOS JITTERBIT", colSpan: 1, rowSpan: 1,
      spec: custom("persons", "number", { filters: [eq("custom:canal_de_origem", JITTERBIT)] }) },
    { title: "LEADS JITTERBIT", colSpan: 1, rowSpan: 1,
      spec: custom("leads", "number", { filters: [personChannel(JITTERBIT), { field: "activities_count", op: "gte", value: 1 }] }) },
    { title: "REUNIÕES REALIZADAS ORIGEM JITTERBIT", colSpan: 1, rowSpan: 1,
      spec: custom("activities", "number", { filters: [results, personChannel(JITTERBIT)] }) },
    { title: "OPORTUNIDADES GERADAS - JITTERBIT", colSpan: 1, rowSpan: 1,
      spec: custom("deals", "number", { filters: [personChannel(JITTERBIT)], period: rel("created_at", "this_year") }) },
    // linha 13: Brasil Sessions
    { title: "CONTATOS BRASIL SESSIONS", colSpan: 1, rowSpan: 1,
      spec: custom("persons", "number", { filters: [eq("custom:canal_de_origem", SESSIONS)] }) },
    { title: "LEADS BRASIL SESSIONS", colSpan: 1, rowSpan: 1,
      spec: custom("leads", "number", { filters: [personChannel(SESSIONS), { field: "activities_count", op: "gte", value: 1 },
        eq("activity_owner", id(r.user(MAURO)))] }) },
    { title: "REUNIÕES REALIZADAS ORIGEM BRASIL SESSION", colSpan: 1, rowSpan: 1,
      spec: custom("activities", "number", { filters: [results, eq("lead_source", id(r.source(SESSIONS))), ownerOf(MAURO)] }) },
    { title: "OPORTUNIDADES GERADAS - BRASIL SESSIONS", colSpan: 1, rowSpan: 1,
      spec: custom("deals", "number", { filters: [personChannel(SESSIONS)], period: rel("created_at", "this_year") }) },
  ];

  const meetingsBy = (outcome: string, period: Period) =>
    custom("activities", "bar", { group_by: "organization", filters: [meeting, eq("outcome", id(r.outcome(outcome)))], period });

  const diretoria: CatalogWidget[] = [
    { title: "REUNIÕES REALIZADAS", colSpan: 1, rowSpan: 1,
      spec: custom("activities", "bar", { group_by: "organization", filters: [meeting, results], period: rel("completed_at", "last_week") }) },
    { title: "REUNIÕES QUALIFICADAS", colSpan: 1, rowSpan: 1, spec: meetingsBy(MEETING_RESULTS[0]!, rel("due_at", "this_month")) },
    { title: "REUNIÕES DESQUALIFICADAS", colSpan: 1, rowSpan: 1, spec: meetingsBy(MEETING_RESULTS[1]!, rel("due_at", "this_month")) },
    { title: "REUNIÕES COM PENDÊNCIA", colSpan: 1, rowSpan: 1, spec: meetingsBy(MEETING_RESULTS[2]!, rel("due_at", "this_month")) },
    { title: "REUNIÕES AGENDADAS", colSpan: 1, rowSpan: 1,
      spec: custom("activities", "bar", { group_by: "organization", filters: [meeting], period: rel("created_at", "this_year") }) },
    { title: "CANAL DE ORIGEM REUNIÕES", colSpan: 1, rowSpan: 1,
      spec: custom("activities", "column", { group_by: "kind", filters: [booked], period: rel("completed_at", "this_month") }) },
    { title: "OPORTUNIDADES GERADAS", colSpan: 1, rowSpan: 1,
      spec: custom("deals", "number", { period: rel("created_at", "this_year") }) },
    { title: "NOVOS LEADS ABERTOS", colSpan: 1, rowSpan: 1,
      spec: custom("leads", "number", { period: rel("created_at", "last_week") }) },
    { title: "LEADS EFETIVAMENTE TRABALHADOS - Semana passada", colSpan: 1, rowSpan: 1,
      spec: custom("leads", "number", { filters: [ownerOf(LEONARDO)], period: rel("activity_completed_at", "last_week") }) },
    { title: "ATIVIDADES", colSpan: 1, rowSpan: 1,
      spec: custom("activities", "number", { filters: [onLead, attended], period: rel("completed_at", "this_year") }) },
    { title: "ATIVIDADES POR CANAL", colSpan: 1, rowSpan: 1,
      spec: custom("activities", "pie", { group_by: "kind", filters: [onLead, attended], period: rel("completed_at", "this_year") }) },
    { title: "ORIGEM DOS NOVOS LEADS", colSpan: 1, rowSpan: 1,
      spec: custom("leads", "column", { group_by: "source", segment_by: "status", period: rel("created_at", "last_week") }) },
    { title: "ORGANIZAÇÕES DOS NOVOS LEADS", colSpan: 2, rowSpan: 1,
      spec: custom("organizations", "number", { period: rel("lead_created_at", "this_month") }) },
    { title: "ORGANIZAÇÕES TRABALHADAS", colSpan: 2, rowSpan: 1,
      spec: custom("organizations", "number", { period: rel("activity_completed_at", "last_week") }) },
    { title: "NOME ORGANIZAÇÕES TRABALHADAS", colSpan: 4, rowSpan: 2,
      spec: custom("organizations", "list", { filters: [eq("activity_owner", id(r.user(LEONARDO)))],
        period: rel("activity_completed_at", "last_week"), columns: ["name", "created_at", "owner", "updated_at"] }) },
  ];

  return [
    { name: `KPIs - ${company}`, widgets: kpis, defaultFilters: { period: { relative: "this_month" } } },
    { name: `${company} - Resultados diretoria`, widgets: diretoria, defaultFilters: {} },
  ];
}
