import "server-only";
import { connection } from "next/server";
import { requireUser } from "@/lib/auth/session";
import { translateDbError, type ActionResult } from "@/lib/db-errors";
import { createServerClient } from "@/lib/supabase/server";
import { buildWidgetFilters, type DashboardFilters } from "./filters";
import { reportCompanyIds, scopeCompanyIds } from "./permissions";
import {
  toGoalRow,
  toLinkRow,
  toReportRow,
  toWidgetRow,
  type GoalRow,
  type RawGoal,
  type RawLink,
  type RawReport,
  type RawWidget,
  type ReportRow,
  type ShareLinkRow,
  type WidgetRow,
} from "./rows";
import { reportSpecSchema, toReportResult, type ReportResult, type ReportSpec } from "./spec";

export type { GoalRow, ReportRow, ShareLinkRow, WidgetRow } from "./rows";

function fail(what: string, error: { message: string; code?: string }): never {
  console.error(`[relatórios] ${what}:`, error.code, error.message);
  throw new Error(`Falha ao carregar relatórios (${what}).`);
}

const INVALID_REPORT = "Relatório inválido. Revise os campos escolhidos.";
const FORBIDDEN = "Você não tem permissão para esta ação.";

/** Executa a spec nas empresas do escopo com view_reports; erros viram mensagens em português. */
export async function runReportResult(spec: unknown, scopeSlug: string): Promise<ActionResult<ReportResult>> {
  await connection();
  const parsed = reportSpecSchema.safeParse(spec);
  if (!parsed.success) return { ok: false, error: INVALID_REPORT };
  const companies = await reportCompanyIds(scopeSlug);
  if (companies.length === 0) return { ok: false, error: FORBIDDEN };
  const supabase = await createServerClient();
  const { data, error } = await supabase.rpc("run_report_self", { p_spec: parsed.data, p_companies: companies });
  if (error) return { ok: false, error: translateDbError(error) };
  return { ok: true, data: toReportResult(data) };
}

/** Para páginas e componentes de servidor: lança em vez de devolver o erro. */
export async function runReport(spec: ReportSpec, scopeSlug: string): Promise<ReportResult> {
  const res = await runReportResult(spec, scopeSlug);
  if (!res.ok) throw new Error(res.error);
  return res.data;
}

/** Executa um widget; os filtros do dashboard só restringem. Chave sem seleção é omitida. */
export async function runWidgetResult(
  widgetId: string,
  filters: DashboardFilters | null | undefined,
): Promise<ActionResult<ReportResult>> {
  await connection();
  const supabase = await createServerClient();
  const { data, error } = await supabase.rpc("run_widget", {
    p_widget: widgetId,
    p_filters: buildWidgetFilters(filters),
  });
  if (error) return { ok: false, error: translateDbError(error) };
  return { ok: true, data: toReportResult(data) };
}

export async function runWidget(widgetId: string, filters: DashboardFilters | null | undefined): Promise<ReportResult> {
  const res = await runWidgetResult(widgetId, filters);
  if (!res.ok) throw new Error(res.error);
  return res.data;
}

// Relatórios salvos -----------------------------------------------------------------------------------------
/** Relatórios do próprio usuário no escopo: os da empresa (ou de todas, no escopo "todas") e os sem empresa. */
export async function listReports(scopeSlug: string): Promise<ReportRow[]> {
  const profile = await requireUser();
  const companies = await scopeCompanyIds(scopeSlug);
  const supabase = await createServerClient();
  let q = supabase
    .from("reports")
    .select("id, company_id, name, spec, updated_at")
    .eq("owner_id", profile.id)
    .order("name");
  if (companies.length === 1) q = q.or(`company_id.eq.${companies[0]},company_id.is.null`);
  const { data, error } = await q;
  if (error) fail("relatórios", error);
  return ((data ?? []) as RawReport[]).map(toReportRow);
}

export async function getReport(id: string): Promise<ReportRow | null> {
  const profile = await requireUser();
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("reports")
    .select("id, company_id, name, spec, updated_at")
    .eq("id", id)
    .eq("owner_id", profile.id)
    .maybeSingle();
  if (error) fail("relatório", error);
  return data ? toReportRow(data as RawReport) : null;
}

// Dashboards ------------------------------------------------------------------------------------------------
export type DashboardSummary = {
  id: string;
  name: string;
  ownerId: string;
  ownerName: string | null;
  /** Verdadeiro quando o dashboard é de outra pessoa e foi compartilhado comigo. */
  shared: boolean;
  updatedAt: string;
};

/** Os próprios dashboards e os compartilhados comigo (o admin geral não recebe os alheios aqui). */
export async function listDashboards(): Promise<DashboardSummary[]> {
  const profile = await requireUser();
  const supabase = await createServerClient();
  const [dash, shares] = await Promise.all([
    supabase.from("dashboards").select("id, name, owner_id, updated_at").order("name"),
    supabase.from("dashboard_shares").select("dashboard_id").eq("user_id", profile.id),
  ]);
  if (dash.error) fail("dashboards", dash.error);
  if (shares.error) fail("compartilhamentos", shares.error);
  const sharedIds = new Set((shares.data ?? []).map((s) => s.dashboard_id as string));
  const rows = (dash.data ?? []).filter((d) => d.owner_id === profile.id || sharedIds.has(d.id));
  const foreign = [...new Set(rows.filter((d) => d.owner_id !== profile.id).map((d) => d.owner_id as string))];
  const names = new Map<string, string>();
  if (foreign.length > 0) {
    const { data } = await supabase.from("profiles").select("id, full_name, email").in("id", foreign);
    for (const p of data ?? []) names.set(p.id, p.full_name || p.email);
  }
  return rows.map((d) => ({
    id: d.id,
    name: d.name,
    ownerId: d.owner_id,
    ownerName: d.owner_id === profile.id ? null : (names.get(d.owner_id) ?? null),
    shared: d.owner_id !== profile.id,
    updatedAt: d.updated_at,
  }));
}

export type DashboardDetail = {
  id: string;
  name: string;
  ownerId: string;
  isOwner: boolean;
  defaultFilters: DashboardFilters;
  widgets: WidgetRow[];
  /** Pessoas com quem foi compartilhado (só o dono vê a lista completa). */
  sharedWith: string[];
  /** Links públicos (só o dono). Nunca traz o token. */
  links: ShareLinkRow[];
};

export async function getDashboard(id: string): Promise<DashboardDetail | null> {
  const profile = await requireUser();
  const supabase = await createServerClient();
  const { data: d, error } = await supabase
    .from("dashboards")
    .select("id, name, owner_id, default_filters")
    .eq("id", id)
    .maybeSingle();
  if (error) fail("dashboard", error);
  if (!d) return null;
  const isOwner = d.owner_id === profile.id;
  if (!isOwner && !profile.isSuperAdmin) {
    // o admin geral lê qualquer dashboard; os demais só os próprios ou compartilhados
    const { data: s } = await supabase
      .from("dashboard_shares")
      .select("user_id")
      .eq("dashboard_id", id)
      .eq("user_id", profile.id)
      .maybeSingle();
    if (!s) return null;
  }
  const [widgets, shares, links] = await Promise.all([
    supabase
      .from("dashboard_widgets")
      .select("id, dashboard_id, report_id, spec, title, position, col_span, row_span, reports(name, spec)")
      .eq("dashboard_id", id)
      .order("position")
      .order("id"),
    isOwner ? supabase.from("dashboard_shares").select("user_id").eq("dashboard_id", id) : null,
    isOwner ? listShareLinks(id) : null,
  ]);
  if (widgets.error) fail("widgets", widgets.error);
  return {
    id: d.id,
    name: d.name,
    ownerId: d.owner_id,
    isOwner,
    defaultFilters: (d.default_filters ?? {}) as DashboardFilters,
    widgets: ((widgets.data ?? []) as unknown as RawWidget[]).map(toWidgetRow),
    sharedWith: (shares?.data ?? []).map((s) => s.user_id as string),
    links: links ?? [],
  };
}

/** Colunas explícitas: token_hash é revogado do cliente, então `select *` falharia. */
export async function listShareLinks(dashboardId: string): Promise<ShareLinkRow[]> {
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("dashboard_share_links")
    .select("id, created_at, expires_at, revoked_at")
    .eq("dashboard_id", dashboardId)
    .order("created_at", { ascending: false });
  if (error) fail("links de compartilhamento", error);
  return ((data ?? []) as RawLink[]).map(toLinkRow);
}

// Metas -----------------------------------------------------------------------------------------------------
/** Metas das empresas do escopo, com o progresso do período corrente. */
export async function listGoals(scopeSlug: string): Promise<GoalRow[]> {
  await connection();
  const companies = await scopeCompanyIds(scopeSlug);
  if (companies.length === 0) return [];
  const supabase = await createServerClient();
  const { data, error } = await supabase.rpc("goals_progress_self", { p_companies: companies });
  if (error) fail("metas", error);
  return ((data ?? []) as RawGoal[]).map(toGoalRow);
}
