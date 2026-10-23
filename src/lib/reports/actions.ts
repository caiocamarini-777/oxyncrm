"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentProfile } from "@/lib/auth/session";
import { translateDbError, type ActionResult } from "@/lib/db-errors";
import { firstIssue } from "@/lib/records/action-helpers";
import { createServerClient } from "@/lib/supabase/server";
import { UUID_RE } from "@/lib/uuid";
import { shareUrl, type DashboardFilters } from "./filters";
import { goalSchema, type GoalInput } from "./goals";
import { runReportResult, runWidgetResult } from "./queries";
import { reportSpecSchema, type ReportResult, type ReportSpec } from "./spec";

const uuid = z.string().regex(UUID_RE);
const NO_PERMISSION = "Você não tem permissão para esta ação.";
const INVALID = { ok: false, error: "Dados inválidos." } as const;
const touched = () => revalidatePath("/", "layout");
const nameSchema = z.string().trim().min(1, "Informe o nome.").max(120, "Use até 120 caracteres.");

async function actor() {
  const profile = await getCurrentProfile();
  return profile && profile.active ? profile : null;
}

// Execução (para componentes de cliente) -------------------------------------------------------------------
export async function runReportAction(spec: ReportSpec, scopeSlug: string): Promise<ActionResult<ReportResult>> {
  if (typeof scopeSlug !== "string") return INVALID;
  return runReportResult(spec, scopeSlug);
}

export async function runWidgetAction(
  widgetId: string,
  filters: DashboardFilters | null,
): Promise<ActionResult<ReportResult>> {
  if (!uuid.safeParse(widgetId).success) return INVALID;
  return runWidgetResult(widgetId, filters);
}

// Relatórios salvos -----------------------------------------------------------------------------------------
const saveReportSchema = z.object({
  id: uuid.optional(),
  name: nameSchema,
  companyId: uuid.nullish(),
  spec: reportSpecSchema,
});

export async function saveReport(input: {
  id?: string;
  name: string;
  companyId?: string | null;
  spec: ReportSpec;
}): Promise<ActionResult<{ id: string }>> {
  const profile = await actor();
  if (!profile) return { ok: false, error: NO_PERMISSION };
  const parsed = saveReportSchema.safeParse(input);
  if (!parsed.success) {
    const { field, message } = firstIssue(parsed.error, "name");
    return { ok: false, error: message, fieldErrors: { [field]: message } };
  }
  const d = parsed.data;
  const supabase = await createServerClient();
  if (d.id) {
    const { data, error } = await supabase
      .from("reports")
      .update({ name: d.name, company_id: d.companyId ?? null, spec: d.spec })
      .eq("id", d.id)
      .eq("owner_id", profile.id)
      .select("id");
    if (error) return { ok: false, error: translateDbError(error) };
    if (!data || data.length === 0) return { ok: false, error: "Registro não encontrado ou sem permissão." };
    touched();
    return { ok: true, data: { id: d.id } };
  }
  const { data, error } = await supabase
    .from("reports")
    .insert({ owner_id: profile.id, name: d.name, company_id: d.companyId ?? null, spec: d.spec })
    .select("id")
    .single();
  if (error) return { ok: false, error: translateDbError(error) };
  touched();
  return { ok: true, data: { id: data.id } };
}

export async function deleteReport(id: string): Promise<ActionResult> {
  if (!uuid.safeParse(id).success) return INVALID;
  const profile = await actor();
  if (!profile) return { ok: false, error: NO_PERMISSION };
  const supabase = await createServerClient();
  const { data, error } = await supabase.from("reports").delete().eq("id", id).eq("owner_id", profile.id).select("id");
  if (error) return { ok: false, error: translateDbError(error) };
  if (!data || data.length === 0) return { ok: false, error: "Registro não encontrado ou sem permissão." };
  touched();
  return { ok: true, data: undefined };
}

// Dashboards ------------------------------------------------------------------------------------------------
export async function createDashboard(name: string): Promise<ActionResult<{ id: string }>> {
  const profile = await actor();
  if (!profile) return { ok: false, error: NO_PERMISSION };
  const parsed = nameSchema.safeParse(name);
  if (!parsed.success) {
    const message = parsed.error.issues[0].message;
    return { ok: false, error: message, fieldErrors: { name: message } };
  }
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("dashboards")
    .insert({ owner_id: profile.id, name: parsed.data })
    .select("id")
    .single();
  if (error) return { ok: false, error: translateDbError(error) };
  touched();
  return { ok: true, data: { id: data.id } };
}

export async function renameDashboard(id: string, name: string): Promise<ActionResult> {
  if (!uuid.safeParse(id).success) return INVALID;
  const profile = await actor();
  if (!profile) return { ok: false, error: NO_PERMISSION };
  const parsed = nameSchema.safeParse(name);
  if (!parsed.success) {
    const message = parsed.error.issues[0].message;
    return { ok: false, error: message, fieldErrors: { name: message } };
  }
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("dashboards")
    .update({ name: parsed.data })
    .eq("id", id)
    .eq("owner_id", profile.id)
    .select("id");
  if (error) return { ok: false, error: translateDbError(error) };
  if (!data || data.length === 0) return { ok: false, error: "Registro não encontrado ou sem permissão." };
  touched();
  return { ok: true, data: undefined };
}

export async function deleteDashboard(id: string): Promise<ActionResult> {
  if (!uuid.safeParse(id).success) return INVALID;
  const profile = await actor();
  if (!profile) return { ok: false, error: NO_PERMISSION };
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("dashboards")
    .delete()
    .eq("id", id)
    .eq("owner_id", profile.id)
    .select("id");
  if (error) return { ok: false, error: translateDbError(error) };
  if (!data || data.length === 0) return { ok: false, error: "Registro não encontrado ou sem permissão." };
  touched();
  return { ok: true, data: undefined };
}

const widgetSchema = z
  .object({
    reportId: uuid.optional(),
    spec: reportSpecSchema.optional(),
    title: z.string().trim().max(120, "Use até 120 caracteres.").default(""),
    colSpan: z.number().int().min(1).max(4),
    rowSpan: z.number().int().min(1).max(3),
  })
  .refine((w) => (w.reportId === undefined) !== (w.spec === undefined), {
    message: "Escolha um relatório salvo ou uma configuração, não os dois.",
    path: ["reportId"],
  });

export async function addWidget(
  dashboardId: string,
  input: { reportId?: string; spec?: ReportSpec; title?: string; colSpan: number; rowSpan: number },
): Promise<ActionResult<{ id: string }>> {
  if (!uuid.safeParse(dashboardId).success) return INVALID;
  const profile = await actor();
  if (!profile) return { ok: false, error: NO_PERMISSION };
  const parsed = widgetSchema.safeParse(input);
  if (!parsed.success) {
    const { field, message } = firstIssue(parsed.error, "reportId");
    return { ok: false, error: message, fieldErrors: { [field]: message } };
  }
  const w = parsed.data;
  const supabase = await createServerClient();
  const { data: last, error: lastError } = await supabase
    .from("dashboard_widgets")
    .select("position")
    .eq("dashboard_id", dashboardId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (lastError) return { ok: false, error: translateDbError(lastError) };
  const { data, error } = await supabase
    .from("dashboard_widgets")
    .insert({
      dashboard_id: dashboardId,
      report_id: w.reportId ?? null,
      spec: w.spec ?? null,
      title: w.title,
      position: (last?.position ?? -1) + 1,
      col_span: w.colSpan,
      row_span: w.rowSpan,
    })
    .select("id")
    .single();
  if (error) return { ok: false, error: translateDbError(error) };
  touched();
  return { ok: true, data: { id: data.id } };
}

const layoutSchema = z
  .array(
    z.object({
      id: uuid,
      position: z.number().int().min(0),
      colSpan: z.number().int().min(1).max(4),
      rowSpan: z.number().int().min(1).max(3),
    }),
  )
  .max(100)
  .refine((items) => new Set(items.map((i) => i.id)).size === items.length, "Widgets repetidos.");

export async function updateWidgetLayout(
  dashboardId: string,
  items: { id: string; position: number; colSpan: number; rowSpan: number }[],
): Promise<ActionResult> {
  if (!uuid.safeParse(dashboardId).success) return INVALID;
  const profile = await actor();
  if (!profile) return { ok: false, error: NO_PERMISSION };
  const parsed = layoutSchema.safeParse(items);
  if (!parsed.success) return INVALID;
  const supabase = await createServerClient();
  const { error } = await supabase.rpc("update_widget_layout", {
    p_dashboard: dashboardId,
    p_items: parsed.data.map((i) => ({ id: i.id, position: i.position, col_span: i.colSpan, row_span: i.rowSpan })),
  });
  if (error) return { ok: false, error: translateDbError(error) };
  touched();
  return { ok: true, data: undefined };
}

export async function removeWidget(id: string): Promise<ActionResult> {
  if (!uuid.safeParse(id).success) return INVALID;
  const profile = await actor();
  if (!profile) return { ok: false, error: NO_PERMISSION };
  const supabase = await createServerClient();
  const { data, error } = await supabase.from("dashboard_widgets").delete().eq("id", id).select("id");
  if (error) return { ok: false, error: translateDbError(error) };
  if (!data || data.length === 0) return { ok: false, error: "Registro não encontrado ou sem permissão." };
  touched();
  return { ok: true, data: undefined };
}

// Compartilhamento ------------------------------------------------------------------------------------------
export async function shareDashboard(dashboardId: string, userIds: string[]): Promise<ActionResult> {
  const ids = z.array(uuid).min(1).max(100).safeParse(userIds);
  if (!uuid.safeParse(dashboardId).success || !ids.success) return INVALID;
  const profile = await actor();
  if (!profile) return { ok: false, error: NO_PERMISSION };
  const unique = [...new Set(ids.data)].filter((u) => u !== profile.id);
  if (unique.length === 0) return INVALID;
  const supabase = await createServerClient();
  const { error } = await supabase
    .from("dashboard_shares")
    .upsert(
      unique.map((user_id) => ({ dashboard_id: dashboardId, user_id })),
      { onConflict: "dashboard_id,user_id", ignoreDuplicates: true },
    );
  if (error) return { ok: false, error: translateDbError(error) };
  touched();
  return { ok: true, data: undefined };
}

export async function unshareDashboard(dashboardId: string, userId: string): Promise<ActionResult> {
  if (!uuid.safeParse(dashboardId).success || !uuid.safeParse(userId).success) return INVALID;
  const profile = await actor();
  if (!profile) return { ok: false, error: NO_PERMISSION };
  const supabase = await createServerClient();
  const { error } = await supabase
    .from("dashboard_shares")
    .delete()
    .eq("dashboard_id", dashboardId)
    .eq("user_id", userId);
  if (error) return { ok: false, error: translateDbError(error) };
  touched();
  return { ok: true, data: undefined };
}

/**
 * Cria o link público. O token em claro só existe nesta resposta; o banco guarda o hash. Em produção exige
 * NEXT_PUBLIC_SITE_URL (como o cron de lembretes), para nunca gerar um link apontando para localhost.
 */
export async function createShareLink(
  dashboardId: string,
  expiresAt?: string | null,
): Promise<ActionResult<{ url: string; linkId: string }>> {
  if (!uuid.safeParse(dashboardId).success) return INVALID;
  const exp = z.string().datetime({ offset: true }).nullish().safeParse(expiresAt);
  if (!exp.success) return { ok: false, error: "Data de expiração inválida.", fieldErrors: { expiresAt: "Data inválida." } };
  const siteEnv = process.env.NEXT_PUBLIC_SITE_URL;
  if (!siteEnv && process.env.NODE_ENV === "production") {
    console.error("[relatórios] NEXT_PUBLIC_SITE_URL não configurada");
    return { ok: false, error: "Não foi possível gerar o link agora. Tente novamente mais tarde." };
  }
  const profile = await actor();
  if (!profile) return { ok: false, error: NO_PERMISSION };
  const supabase = await createServerClient();
  const { data, error } = await supabase.rpc("create_share_link", {
    p_dashboard: dashboardId,
    p_expires_at: exp.data ?? null,
  });
  const created = data as { id?: string; token?: string } | null;
  if (error || !created?.id || !created.token) {
    return { ok: false, error: error ? translateDbError(error) : "Não foi possível concluir. Tente novamente." };
  }
  touched();
  return { ok: true, data: { url: shareUrl(siteEnv ?? "http://localhost:3000", created.token), linkId: created.id } };
}

export async function revokeShareLink(linkId: string): Promise<ActionResult> {
  if (!uuid.safeParse(linkId).success) return INVALID;
  const profile = await actor();
  if (!profile) return { ok: false, error: NO_PERMISSION };
  const supabase = await createServerClient();
  const { error } = await supabase.rpc("revoke_share_link", { p_link: linkId });
  if (error) return { ok: false, error: translateDbError(error) };
  touched();
  return { ok: true, data: undefined };
}

// Metas (RLS: só o admin geral escreve) -----------------------------------------------------------------------
export async function createGoal(input: GoalInput): Promise<ActionResult<{ id: string }>> {
  const profile = await actor();
  if (!profile) return { ok: false, error: NO_PERMISSION };
  const parsed = goalSchema.safeParse(input);
  if (!parsed.success) {
    const { field, message } = firstIssue(parsed.error, "targetValue");
    return { ok: false, error: message, fieldErrors: { [field]: message } };
  }
  const g = parsed.data;
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("goals")
    .insert({
      company_id: g.companyId,
      target_kind: g.targetKind,
      target_user_id: g.targetKind === "user" ? g.targetUserId : null,
      target_team_id: g.targetKind === "team" ? g.targetTeamId : null,
      metric: g.metric,
      period: g.period,
      starts_on: g.startsOn,
      target_value: g.targetValue,
      created_by: profile.id,
    })
    .select("id")
    .single();
  if (error) return { ok: false, error: translateDbError(error) };
  touched();
  return { ok: true, data: { id: data.id } };
}

export async function deleteGoal(id: string): Promise<ActionResult> {
  if (!uuid.safeParse(id).success) return INVALID;
  const profile = await actor();
  if (!profile) return { ok: false, error: NO_PERMISSION };
  const supabase = await createServerClient();
  const { data, error } = await supabase.from("goals").delete().eq("id", id).select("id");
  if (error) return { ok: false, error: translateDbError(error) };
  if (!data || data.length === 0) return { ok: false, error: "Registro não encontrado ou sem permissão." };
  touched();
  return { ok: true, data: undefined };
}
