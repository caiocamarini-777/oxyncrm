"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentProfile } from "@/lib/auth/session";
import { translateDbError, type ActionResult } from "@/lib/db-errors";
import { createServerClient } from "@/lib/supabase/server";
import { UUID_RE } from "@/lib/uuid";
import { definitionSchema } from "./definition";
import { getRecords, getShares, listShareTargets, runInsight, type ShareState, type ShareTarget } from "./queries";
import { PERIODS, type InsightDefinition, type InsightResult, type Overrides, type QuickFilters, type RecordsResult } from "./types";

const uuid = z.string().regex(UUID_RE);
const NO_PERMISSION = "Você não tem permissão para esta ação.";
const INVALID = { ok: false, error: "Dados inválidos." } as const;
const NOT_FOUND = { ok: false, error: "Registro não encontrado ou sem permissão." } as const;
const nameSchema = z.string().trim().min(1, "Informe o nome.").max(120, "Use até 120 caracteres.");
const touched = () => revalidatePath("/", "layout");

const periodSchema = z.object({
  period: z.enum(PERIODS),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
const overridesSchema = z.object({
  period: periodSchema.nullish(),
  user_ids: z.array(uuid).max(100).optional(),
  pipeline_id: uuid.nullish(),
  compare: z
    .object({ kind: z.enum(["previous", "custom"]), from: z.string().optional(), to: z.string().optional() })
    .nullish(),
});

async function actor() {
  const profile = await getCurrentProfile();
  return profile && profile.active ? profile : null;
}

// Execução ---------------------------------------------------------------------------------------------------
export async function runInsightAction(
  companyId: string,
  def: InsightDefinition,
  overrides: Overrides = {},
): Promise<ActionResult<InsightResult>> {
  const d = definitionSchema.safeParse(def);
  const o = overridesSchema.safeParse(overrides ?? {});
  if (!uuid.safeParse(companyId).success || !d.success || !o.success) return { ok: false, error: "Relatório inválido. Revise os campos escolhidos." };
  return runInsight(companyId, d.data as InsightDefinition, o.data as Overrides);
}

export async function recordsAction(
  companyId: string,
  def: InsightDefinition,
  overrides: Overrides,
  page: number,
  sort: { col: string; dir: "asc" | "desc" } | null,
  point: { x?: string; s?: string } | null,
): Promise<ActionResult<RecordsResult>> {
  const d = definitionSchema.safeParse(def);
  const o = overridesSchema.safeParse(overrides ?? {});
  if (!uuid.safeParse(companyId).success || !d.success || !o.success) return INVALID;
  if (!Number.isInteger(page) || page < 0 || page > 10000) return INVALID;
  const s = sort && typeof sort.col === "string" && sort.col.length <= 120 ? { col: sort.col, dir: sort.dir === "asc" ? "asc" : "desc" } : null;
  const p = point && typeof point === "object" ? { ...(typeof point.x === "string" ? { x: point.x } : {}), ...(typeof point.s === "string" ? { s: point.s } : {}) } : null;
  return getRecords(companyId, d.data as InsightDefinition, o.data as Overrides, page, s as never, p);
}

// Relatórios -------------------------------------------------------------------------------------------------
function columnsOf(def: InsightDefinition) {
  return {
    data_type: def.data_type,
    report_type: def.report_type,
    chart_type: def.chart_type,
    parameters: def.parameters,
    columns: def.columns,
    colors: def.colors,
  };
}

export async function createReport(input: { companyId: string; name: string; definition: InsightDefinition }): Promise<ActionResult<{ id: string }>> {
  const profile = await actor();
  if (!profile) return { ok: false, error: NO_PERMISSION };
  const name = nameSchema.safeParse(input.name);
  if (!name.success) return { ok: false, error: name.error.issues[0]!.message, fieldErrors: { name: name.error.issues[0]!.message } };
  const def = definitionSchema.safeParse(input.definition);
  if (!uuid.safeParse(input.companyId).success || !def.success) return INVALID;
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("insight_reports")
    .insert({ company_id: input.companyId, owner_id: profile.id, name: name.data, ...columnsOf(def.data as InsightDefinition) })
    .select("id")
    .single();
  if (error) return { ok: false, error: translateDbError(error) };
  touched();
  return { ok: true, data: { id: data.id } };
}

export async function saveReport(id: string, input: { name?: string; definition?: InsightDefinition }): Promise<ActionResult> {
  if (!(await actor())) return { ok: false, error: NO_PERMISSION };
  if (!uuid.safeParse(id).success) return INVALID;
  const patch: Record<string, unknown> = {};
  if (input.name !== undefined) {
    const name = nameSchema.safeParse(input.name);
    if (!name.success) return { ok: false, error: name.error.issues[0]!.message, fieldErrors: { name: name.error.issues[0]!.message } };
    patch.name = name.data;
  }
  if (input.definition !== undefined) {
    const def = definitionSchema.safeParse(input.definition);
    if (!def.success) return { ok: false, error: "Relatório inválido. Revise os campos escolhidos." };
    Object.assign(patch, columnsOf(def.data as InsightDefinition));
  }
  const supabase = await createServerClient();
  const { data, error } = await supabase.from("insight_reports").update(patch).eq("id", id).select("id");
  if (error) return { ok: false, error: translateDbError(error) };
  if (!data?.length) return NOT_FOUND;
  touched();
  return { ok: true, data: undefined };
}

export async function duplicateReport(id: string): Promise<ActionResult<{ id: string }>> {
  const profile = await actor();
  if (!profile) return { ok: false, error: NO_PERMISSION };
  if (!uuid.safeParse(id).success) return INVALID;
  const supabase = await createServerClient();
  const { data: r, error } = await supabase
    .from("insight_reports")
    .select("company_id, name, data_type, report_type, chart_type, parameters, columns, colors")
    .eq("id", id)
    .maybeSingle();
  if (error) return { ok: false, error: translateDbError(error) };
  if (!r) return NOT_FOUND;
  const { data, error: e2 } = await supabase
    .from("insight_reports")
    .insert({ ...r, name: `Cópia de ${r.name}`.slice(0, 120), owner_id: profile.id })
    .select("id")
    .single();
  if (e2) return { ok: false, error: translateDbError(e2) };
  touched();
  return { ok: true, data: { id: data.id } };
}

export async function deleteReport(id: string): Promise<ActionResult> {
  if (!(await actor())) return { ok: false, error: NO_PERMISSION };
  if (!uuid.safeParse(id).success) return INVALID;
  const supabase = await createServerClient();
  const { data, error } = await supabase.from("insight_reports").delete().eq("id", id).select("id");
  if (error) return { ok: false, error: translateDbError(error) };
  if (!data?.length) return NOT_FOUND;
  touched();
  return { ok: true, data: undefined };
}

const sharesSchema = z.array(z.object({ userId: uuid, canEdit: z.boolean() })).max(200);

/** Substitui a lista de compartilhamento (relatório ou painel). */
export async function setShares(kind: "report" | "dashboard", id: string, users: { userId: string; canEdit: boolean }[]): Promise<ActionResult> {
  if (!(await actor())) return { ok: false, error: NO_PERMISSION };
  const parsed = sharesSchema.safeParse(users);
  if (!uuid.safeParse(id).success || !parsed.success || (kind !== "report" && kind !== "dashboard")) return INVALID;
  const table = kind === "report" ? "insight_report_shares" : "insight_dashboard_shares";
  const col = kind === "report" ? "report_id" : "dashboard_id";
  const supabase = await createServerClient();
  const { data: current, error } = await supabase.from(table).select("user_id").eq(col, id);
  if (error) return { ok: false, error: translateDbError(error) };
  const keep = new Set(parsed.data.map((u) => u.userId));
  const removed = (current ?? []).map((c) => c.user_id as string).filter((u) => !keep.has(u));
  if (removed.length) {
    const { error: de } = await supabase.from(table).delete().eq(col, id).in("user_id", removed);
    if (de) return { ok: false, error: translateDbError(de) };
  }
  if (parsed.data.length) {
    const { error: ue } = await supabase
      .from(table)
      .upsert(parsed.data.map((u) => ({ [col]: id, user_id: u.userId, can_edit: u.canEdit })), { onConflict: `${col},user_id` });
    if (ue) return { ok: false, error: translateDbError(ue) };
  }
  touched();
  return { ok: true, data: undefined };
}

// Painéis ----------------------------------------------------------------------------------------------------
export async function createDashboard(input: { companyId: string; name: string }): Promise<ActionResult<{ id: string }>> {
  const profile = await actor();
  if (!profile) return { ok: false, error: NO_PERMISSION };
  const name = nameSchema.safeParse(input.name);
  if (!name.success) return { ok: false, error: name.error.issues[0]!.message, fieldErrors: { name: name.error.issues[0]!.message } };
  if (!uuid.safeParse(input.companyId).success) return INVALID;
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("insight_dashboards")
    .insert({ company_id: input.companyId, owner_id: profile.id, name: name.data })
    .select("id")
    .single();
  if (error) return { ok: false, error: translateDbError(error) };
  touched();
  return { ok: true, data: { id: data.id } };
}

export async function renameDashboard(id: string, name: string): Promise<ActionResult> {
  if (!(await actor())) return { ok: false, error: NO_PERMISSION };
  const n = nameSchema.safeParse(name);
  if (!uuid.safeParse(id).success) return INVALID;
  if (!n.success) return { ok: false, error: n.error.issues[0]!.message };
  const supabase = await createServerClient();
  const { data, error } = await supabase.from("insight_dashboards").update({ name: n.data }).eq("id", id).select("id");
  if (error) return { ok: false, error: translateDbError(error) };
  if (!data?.length) return NOT_FOUND;
  touched();
  return { ok: true, data: undefined };
}

export async function deleteDashboard(id: string): Promise<ActionResult> {
  if (!(await actor())) return { ok: false, error: NO_PERMISSION };
  if (!uuid.safeParse(id).success) return INVALID;
  const supabase = await createServerClient();
  const { data, error } = await supabase.from("insight_dashboards").delete().eq("id", id).select("id");
  if (error) return { ok: false, error: translateDbError(error) };
  if (!data?.length) return NOT_FOUND;
  touched();
  return { ok: true, data: undefined };
}

/** "Duplicar para seus painéis": cópia do painel, apontando para os mesmos relatórios. */
export async function duplicateDashboard(id: string): Promise<ActionResult<{ id: string }>> {
  const profile = await actor();
  if (!profile) return { ok: false, error: NO_PERMISSION };
  if (!uuid.safeParse(id).success) return INVALID;
  const supabase = await createServerClient();
  const { data: d, error } = await supabase.from("insight_dashboards").select("company_id, name").eq("id", id).maybeSingle();
  if (error) return { ok: false, error: translateDbError(error) };
  if (!d) return NOT_FOUND;
  const { data: items, error: ie } = await supabase.from("insight_dashboard_reports").select("report_id, x, y, w, h").eq("dashboard_id", id);
  if (ie) return { ok: false, error: translateDbError(ie) };
  const { data: copy, error: ce } = await supabase
    .from("insight_dashboards")
    .insert({ company_id: d.company_id, owner_id: profile.id, name: `Cópia de ${d.name}`.slice(0, 120) })
    .select("id")
    .single();
  if (ce) return { ok: false, error: translateDbError(ce) };
  if (items?.length) {
    const { error: e3 } = await supabase.from("insight_dashboard_reports").insert(items.map((i) => ({ ...i, dashboard_id: copy.id })));
    if (e3) return { ok: false, error: translateDbError(e3) };
  }
  touched();
  return { ok: true, data: { id: copy.id } };
}

export async function addReportToDashboard(dashboardId: string, reportId: string): Promise<ActionResult> {
  if (!(await actor())) return { ok: false, error: NO_PERMISSION };
  if (!uuid.safeParse(dashboardId).success || !uuid.safeParse(reportId).success) return INVALID;
  const supabase = await createServerClient();
  const [{ data: items, error }, { data: r, error: re }] = await Promise.all([
    supabase.from("insight_dashboard_reports").select("report_id, y, h").eq("dashboard_id", dashboardId),
    supabase.from("insight_reports").select("chart_type").eq("id", reportId).maybeSingle(),
  ]);
  if (error || re) return { ok: false, error: translateDbError((error ?? re)!) };
  if (!r) return NOT_FOUND;
  if (items?.some((i) => i.report_id === reportId)) return { ok: false, error: "Este relatório já está no painel." };
  const y = Math.max(0, ...(items ?? []).map((i) => i.y + i.h));
  const w = r.chart_type === "scorecard" ? 1 : r.chart_type === "table" ? 4 : 2;
  const { error: ie } = await supabase
    .from("insight_dashboard_reports")
    .insert({ dashboard_id: dashboardId, report_id: reportId, x: 0, y, w, h: r.chart_type === "table" ? 8 : 5 });
  if (ie) return { ok: false, error: translateDbError(ie) };
  touched();
  return { ok: true, data: undefined };
}

export async function removeFromDashboard(dashboardId: string, reportId: string): Promise<ActionResult> {
  if (!(await actor())) return { ok: false, error: NO_PERMISSION };
  if (!uuid.safeParse(dashboardId).success || !uuid.safeParse(reportId).success) return INVALID;
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("insight_dashboard_reports")
    .delete()
    .eq("dashboard_id", dashboardId)
    .eq("report_id", reportId)
    .select("report_id");
  if (error) return { ok: false, error: translateDbError(error) };
  if (!data?.length) return NOT_FOUND;
  touched();
  return { ok: true, data: undefined };
}

const layoutSchema = z
  .array(
    z
      .object({ reportId: uuid, x: z.number().int().min(0).max(3), y: z.number().int().min(0).max(10000), w: z.number().int().min(1).max(4), h: z.number().int().min(2).max(20) })
      .refine((i) => i.x + i.w <= 4),
  )
  .max(100);

export async function saveLayout(dashboardId: string, items: { reportId: string; x: number; y: number; w: number; h: number }[]): Promise<ActionResult> {
  if (!(await actor())) return { ok: false, error: NO_PERMISSION };
  const parsed = layoutSchema.safeParse(items);
  if (!uuid.safeParse(dashboardId).success || !parsed.success) return INVALID;
  const supabase = await createServerClient();
  const { error } = await supabase
    .from("insight_dashboard_reports")
    .upsert(
      parsed.data.map((i) => ({ dashboard_id: dashboardId, report_id: i.reportId, x: i.x, y: i.y, w: i.w, h: i.h })),
      { onConflict: "dashboard_id,report_id" },
    );
  if (error) return { ok: false, error: translateDbError(error) };
  return { ok: true, data: undefined };
}

export async function saveQuickFilters(dashboardId: string, quick: QuickFilters): Promise<ActionResult> {
  const profile = await actor();
  if (!profile) return { ok: false, error: NO_PERMISSION };
  const q = z
    .object({ period: periodSchema.nullable(), userIds: z.array(uuid).max(100), pipelineId: uuid.nullable() })
    .safeParse(quick);
  if (!uuid.safeParse(dashboardId).success || !q.success) return INVALID;
  const supabase = await createServerClient();
  const { error } = await supabase.from("insight_quick_filters").upsert(
    {
      dashboard_id: dashboardId,
      user_id: profile.id,
      period: q.data.period,
      user_ids: q.data.userIds,
      pipeline_id: q.data.pipelineId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "dashboard_id,user_id" },
  );
  if (error) return { ok: false, error: translateDbError(error) };
  return { ok: true, data: undefined };
}

// Cores ------------------------------------------------------------------------------------------------------
const HEX = z.string().regex(/^#[0-9a-f]{6}$/);

/** Cor padrão da empresa para um valor (null remove). */
export async function saveCompanyColor(companyId: string, field: string, value: string, color: string | null): Promise<ActionResult> {
  if (!(await actor())) return { ok: false, error: NO_PERMISSION };
  if (!uuid.safeParse(companyId).success || !field || field.length > 80 || !value || value.length > 200) return INVALID;
  if (color !== null && !HEX.safeParse(color).success) return INVALID;
  const supabase = await createServerClient();
  const { error } =
    color === null
      ? await supabase.from("insight_colors").delete().eq("company_id", companyId).eq("field", field).eq("value", value)
      : await supabase
          .from("insight_colors")
          .upsert({ company_id: companyId, field, value, color, updated_at: new Date().toISOString() }, { onConflict: "company_id,field,value" });
  if (error) return { ok: false, error: translateDbError(error) };
  touched();
  return { ok: true, data: undefined };
}

export async function saveMyColors(colors: string[]): Promise<ActionResult> {
  const profile = await actor();
  if (!profile) return { ok: false, error: NO_PERMISSION };
  const c = z.array(HEX).max(28).safeParse(colors);
  if (!c.success) return INVALID;
  const supabase = await createServerClient();
  const { error } = await supabase
    .from("insight_saved_colors")
    .upsert({ user_id: profile.id, colors: [...new Set(c.data)], updated_at: new Date().toISOString() }, { onConflict: "user_id" });
  if (error) return { ok: false, error: translateDbError(error) };
  return { ok: true, data: undefined };
}

// Link público -----------------------------------------------------------------------------------------------
export async function createPublicLink(dashboardId: string): Promise<ActionResult<{ id: string; url: string }>> {
  if (!(await actor())) return { ok: false, error: NO_PERMISSION };
  if (!uuid.safeParse(dashboardId).success) return INVALID;
  const supabase = await createServerClient();
  const { data, error } = await supabase.rpc("create_insight_link", { p_dashboard: dashboardId, p_expires_at: null });
  if (error) return { ok: false, error: translateDbError(error) };
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? "";
  const r = data as { id: string; token: string };
  return { ok: true, data: { id: r.id, url: `${site}/d/${r.token}` } };
}

export async function revokePublicLink(linkId: string): Promise<ActionResult> {
  if (!(await actor())) return { ok: false, error: NO_PERMISSION };
  if (!uuid.safeParse(linkId).success) return INVALID;
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("insight_dashboard_links")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", linkId)
    .select("id");
  if (error) return { ok: false, error: translateDbError(error) };
  if (!data?.length) return NOT_FOUND;
  return { ok: true, data: undefined };
}

// Busca para filtros (organizações, pessoas, negócios, leads) ---------------------------------------------------
export async function searchRecordsAction(
  companyId: string,
  kind: "orgs" | "persons" | "deals" | "leads",
  q: string,
): Promise<ActionResult<{ id: string; label: string }[]>> {
  if (!uuid.safeParse(companyId).success || !["orgs", "persons", "deals", "leads"].includes(kind) || typeof q !== "string") return INVALID;
  const supabase = await createServerClient();
  const { data, error } = await supabase.rpc("insights_search", { p_company: companyId, p_kind: kind, p_q: q.slice(0, 80) });
  if (error) return { ok: false, error: translateDbError(error) };
  return { ok: true, data: (data ?? []) as { id: string; label: string }[] };
}

// Compartilhamento (leitura para o diálogo) ---------------------------------------------------------------------
export async function shareStateAction(
  kind: "report" | "dashboard",
  id: string,
  companyId: string,
): Promise<ActionResult<{ state: ShareState; targets: ShareTarget[] }>> {
  if (!(await actor())) return { ok: false, error: NO_PERMISSION };
  if (!uuid.safeParse(id).success || !uuid.safeParse(companyId).success || (kind !== "report" && kind !== "dashboard")) return INVALID;
  const [state, targets] = await Promise.all([getShares(kind, id), listShareTargets(companyId)]);
  return { ok: true, data: { state, targets } };
}
