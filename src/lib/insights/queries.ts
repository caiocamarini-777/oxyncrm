import "server-only";
import { cache } from "react";
import { connection } from "next/server";
import { getCurrentProfile, requireUser } from "@/lib/auth/session";
import { translateDbError, type ActionResult } from "@/lib/db-errors";
import { reportCompanyIds } from "@/lib/reports/permissions";
import { createServerClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/uuid";
import { parseDefinition } from "./definition";
import type {
  Access,
  Catalog,
  DashboardItem,
  DashboardRow,
  InsightDefinition,
  InsightResult,
  Overrides,
  QuickFilters,
  RecordsResult,
  ReportRow,
} from "./types";

function fail(what: string, error: { message: string; code?: string }): never {
  console.error(`[insights] ${what}:`, error.code, error.message);
  throw new Error(`Falha ao carregar o Insights (${what}).`);
}

const REPORT_COLS = "id, company_id, owner_id, name, data_type, report_type, chart_type, parameters, columns, colors, updated_at";

type RawReport = {
  id: string;
  company_id: string;
  owner_id: string;
  name: string;
  data_type: string;
  report_type: string;
  chart_type: string;
  parameters: unknown;
  columns: unknown;
  colors: unknown;
  updated_at: string;
};

export function toDefinition(r: Pick<RawReport, "data_type" | "report_type" | "chart_type" | "parameters" | "columns" | "colors">): InsightDefinition {
  const def = parseDefinition({
    data_type: r.data_type,
    report_type: r.report_type,
    chart_type: r.chart_type,
    parameters: r.parameters,
    columns: r.columns,
    colors: r.colors,
  });
  if (def) return def;
  // o banco já validou; um formato antigo não derruba a tela
  return {
    data_type: r.data_type as InsightDefinition["data_type"],
    report_type: r.report_type,
    chart_type: r.chart_type as InsightDefinition["chart_type"],
    parameters: { measure_by: "count", filter_by: [], ...(r.parameters as object) },
    columns: Array.isArray(r.columns) ? (r.columns as string[]) : [],
    colors: (r.colors as Record<string, string>) ?? {},
  };
}

function toReport(r: RawReport): ReportRow {
  return { id: r.id, companyId: r.company_id, ownerId: r.owner_id, name: r.name, definition: toDefinition(r), updatedAt: r.updated_at };
}

export type InsightPermissions = { view: boolean; create: boolean; share: boolean; companyIds: string[] };

/** Empresas do escopo com view_reports; criar e compartilhar como as políticas do banco. */
export const getInsightPermissions = cache(async (scopeSlug: string): Promise<InsightPermissions> => {
  const profile = await getCurrentProfile();
  if (!profile || !profile.active) return { view: false, create: false, share: false, companyIds: [] };
  const companyIds = await reportCompanyIds(scopeSlug);
  if (profile.isSuperAdmin) return { view: companyIds.length > 0, create: true, share: true, companyIds };
  const supabase = await createServerClient();
  const [create, share] = await Promise.all([
    supabase.rpc("can_create_dashboards"),
    supabase.rpc("has_any_report_setting", { p_setting: "share_dashboards" }),
  ]);
  if (create.error) fail("permissão de criar", create.error);
  if (share.error) fail("permissão de compartilhar", share.error);
  return { view: companyIds.length > 0, create: create.data === true, share: share.data === true, companyIds };
});

export const getCatalog = cache(async (companyId: string): Promise<Catalog> => {
  const supabase = await createServerClient();
  const { data, error } = await supabase.rpc("insights_catalog", { p_company: companyId });
  if (error) fail("catálogo", error);
  return data as Catalog;
});

export type SidebarItem = { id: string; name: string; companyId: string; mine: boolean; kind?: string; chart?: string };
export type SidebarData = { dashboards: SidebarItem[]; reports: SidebarItem[] };

/** Painéis e relatórios que o usuário enxerga nas empresas do escopo (a RLS decide o que é compartilhado). */
export const listInsights = cache(async (companyIds: string[]): Promise<SidebarData> => {
  await connection();
  if (companyIds.length === 0) return { dashboards: [], reports: [] };
  const profile = await requireUser();
  const supabase = await createServerClient();
  const [d, r] = await Promise.all([
    supabase.from("insight_dashboards").select("id, name, company_id, owner_id").in("company_id", companyIds).order("name"),
    supabase.from("insight_reports").select("id, name, company_id, owner_id, data_type, chart_type").in("company_id", companyIds).order("name"),
  ]);
  if (d.error) fail("painéis", d.error);
  if (r.error) fail("relatórios", r.error);
  return {
    dashboards: (d.data ?? []).map((x) => ({ id: x.id, name: x.name, companyId: x.company_id, mine: x.owner_id === profile.id })),
    reports: (r.data ?? []).map((x) => ({
      id: x.id,
      name: x.name,
      companyId: x.company_id,
      mine: x.owner_id === profile.id,
      kind: x.data_type,
      chart: x.chart_type,
    })),
  };
});

export async function getReport(id: string): Promise<{ report: ReportRow; access: Access } | null> {
  if (!isUuid(id)) return null;
  const supabase = await createServerClient();
  const { data, error } = await supabase.from("insight_reports").select(REPORT_COLS).eq("id", id).maybeSingle();
  if (error) fail("relatório", error);
  if (!data) return null;
  const { data: canEdit, error: e2 } = await supabase.rpc("can_edit_insight_report", { p_report: id });
  if (e2) fail("acesso ao relatório", e2);
  return { report: toReport(data as RawReport), access: canEdit === true ? "edit" : "read" };
}

export type DashboardDetail = {
  dashboard: DashboardRow;
  access: Access;
  isOwner: boolean;
  items: DashboardItem[];
  reports: ReportRow[];
  quick: QuickFilters;
};

export async function getDashboard(id: string): Promise<DashboardDetail | null> {
  if (!isUuid(id)) return null;
  const profile = await requireUser();
  const supabase = await createServerClient();
  const { data: d, error } = await supabase.from("insight_dashboards").select("id, company_id, owner_id, name").eq("id", id).maybeSingle();
  if (error) fail("painel", error);
  if (!d) return null;
  const [items, canEdit, quick] = await Promise.all([
    supabase.from("insight_dashboard_reports").select(`x, y, w, h, insight_reports(${REPORT_COLS})`).eq("dashboard_id", id),
    supabase.rpc("can_edit_insight_dashboard", { p_dashboard: id }),
    supabase.from("insight_quick_filters").select("period, user_ids, pipeline_id").eq("dashboard_id", id).eq("user_id", profile.id).maybeSingle(),
  ]);
  if (items.error) fail("itens do painel", items.error);
  if (canEdit.error) fail("acesso ao painel", canEdit.error);
  if (quick.error) fail("filtros do painel", quick.error);
  const rows = (items.data ?? []).filter((i) => i.insight_reports) as unknown as {
    x: number;
    y: number;
    w: number;
    h: number;
    insight_reports: RawReport;
  }[];
  return {
    dashboard: { id: d.id, companyId: d.company_id, ownerId: d.owner_id, name: d.name },
    access: canEdit.data === true ? "edit" : "read",
    isOwner: d.owner_id === profile.id,
    items: rows.map((i) => ({ reportId: i.insight_reports.id, x: i.x, y: i.y, w: i.w, h: i.h })).sort((a, b) => a.y - b.y || a.x - b.x),
    reports: rows.map((i) => toReport(i.insight_reports)),
    quick: {
      period: (quick.data?.period as QuickFilters["period"]) ?? null,
      userIds: (quick.data?.user_ids as string[]) ?? [],
      pipelineId: (quick.data?.pipeline_id as string | null) ?? null,
    },
  };
}

export async function runInsight(companyId: string, def: InsightDefinition, overrides: Overrides = {}): Promise<ActionResult<InsightResult>> {
  const supabase = await createServerClient();
  const { data, error } = await supabase.rpc("insights_run", { p_company: companyId, p_def: def, p_overrides: overrides });
  if (error) return { ok: false, error: translateDbError(error) };
  return { ok: true, data: data as InsightResult };
}

export async function getRecords(
  companyId: string,
  def: InsightDefinition,
  overrides: Overrides,
  page: number,
  sort: { col: string; dir: "asc" | "desc" } | null,
  point: { x?: string; s?: string } | null,
): Promise<ActionResult<RecordsResult>> {
  const supabase = await createServerClient();
  const { data, error } = await supabase.rpc("insights_records", {
    p_company: companyId,
    p_def: def,
    p_overrides: overrides,
    p_page: page,
    p_sort: sort,
    p_point: point,
  });
  if (error) return { ok: false, error: translateDbError(error) };
  return { ok: true, data: data as RecordsResult };
}

/** Cores padrão da empresa ("campo:valor" -> cor) e as cores salvas do usuário. */
export async function getColors(companyId: string): Promise<{ company: Record<string, string>; saved: string[] }> {
  const profile = await requireUser();
  const supabase = await createServerClient();
  const [c, s] = await Promise.all([
    supabase.from("insight_colors").select("field, value, color").eq("company_id", companyId),
    supabase.from("insight_saved_colors").select("colors").eq("user_id", profile.id).maybeSingle(),
  ]);
  if (c.error) fail("cores da empresa", c.error);
  if (s.error) fail("cores salvas", s.error);
  return {
    company: Object.fromEntries((c.data ?? []).map((x) => [`${x.field}:${x.value}`, x.color])),
    saved: (s.data?.colors as string[]) ?? [],
  };
}

export type ShareTarget = { id: string; name: string; email: string };

/** Membros ativos da empresa, menos o próprio usuário: destinos de compartilhamento. */
export async function listShareTargets(companyId: string): Promise<ShareTarget[]> {
  const profile = await requireUser();
  const supabase = await createServerClient();
  const { data: members, error } = await supabase.from("memberships").select("user_id").eq("company_id", companyId);
  if (error) fail("pessoas para compartilhar", error);
  const ids = [...new Set((members ?? []).map((m) => m.user_id as string))].filter((u) => u !== profile.id);
  if (ids.length === 0) return [];
  const { data, error: pe } = await supabase.from("profiles").select("id, full_name, email").in("id", ids).eq("active", true);
  if (pe) fail("pessoas para compartilhar", pe);
  return (data ?? [])
    .map((p) => ({ id: p.id as string, name: (p.full_name as string) || (p.email as string), email: p.email as string }))
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}

export type ShareState = { users: { userId: string; canEdit: boolean }[]; links: { id: string; createdAt: string; revokedAt: string | null }[] };

export async function getShares(kind: "report" | "dashboard", id: string): Promise<ShareState> {
  const supabase = await createServerClient();
  if (kind === "report") {
    const { data, error } = await supabase.from("insight_report_shares").select("user_id, can_edit").eq("report_id", id);
    if (error) fail("compartilhamentos", error);
    return { users: (data ?? []).map((s) => ({ userId: s.user_id, canEdit: s.can_edit })), links: [] };
  }
  const [s, l] = await Promise.all([
    supabase.from("insight_dashboard_shares").select("user_id, can_edit").eq("dashboard_id", id),
    supabase.from("insight_dashboard_links").select("id, created_at, revoked_at").eq("dashboard_id", id).order("created_at", { ascending: false }),
  ]);
  if (s.error) fail("compartilhamentos", s.error);
  if (l.error) fail("links", l.error);
  return {
    users: (s.data ?? []).map((x) => ({ userId: x.user_id, canEdit: x.can_edit })),
    links: (l.data ?? []).map((x) => ({ id: x.id, createdAt: x.created_at, revokedAt: x.revoked_at })),
  };
}
