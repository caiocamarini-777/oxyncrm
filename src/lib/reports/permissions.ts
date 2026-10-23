import "server-only";
import { cache } from "react";
import { getCurrentProfile } from "@/lib/auth/session";
import { getAccessibleCompanies, resolveCompanyScope } from "@/lib/companies/scope";
import { createServerClient } from "@/lib/supabase/server";

export type ReportPermissions = {
  viewReports: boolean;
  createDashboards: boolean;
  shareDashboards: boolean;
};

function fail(what: string, error: { message: string; code?: string }): never {
  console.error(`[relatórios] ${what}:`, error.code, error.message);
  throw new Error(`Falha ao carregar relatórios (${what}).`);
}

const NONE: ReportPermissions = { viewReports: false, createDashboards: false, shareDashboards: false };

/** Empresas do escopo (uma, ou todas as acessíveis); vazio quando o slug não existe ou não é acessível. */
export const scopeCompanyIds = cache(async (scopeSlug: string): Promise<string[]> => {
  const profile = await getCurrentProfile();
  if (!profile) return [];
  const companies = await getAccessibleCompanies();
  const scope = resolveCompanyScope(scopeSlug, companies, profile.isSuperAdmin);
  if (!scope) return [];
  return scope.kind === "all" ? companies.map((c) => c.id) : [scope.company.id];
});

/** Empresas do escopo em que o papel libera relatórios (view_reports); o admin geral vê todas. */
export const reportCompanyIds = cache(async (scopeSlug: string): Promise<string[]> => {
  const [profile, ids] = await Promise.all([getCurrentProfile(), scopeCompanyIds(scopeSlug)]);
  if (!profile || !profile.active) return [];
  if (profile.isSuperAdmin) return ids;
  const supabase = await createServerClient();
  const checks = await Promise.all(
    ids.map(async (id) => {
      const { data, error } = await supabase.rpc("has_report_setting", { p_company: id, p_setting: "view_reports" });
      if (error) fail("permissão de relatórios", error);
      return data === true ? id : null;
    }),
  );
  return checks.filter((id): id is string => id !== null);
});

/** Slugs das empresas acessíveis em que o papel libera relatórios (para o menu); o admin geral vê todas. */
export const reportCompanySlugs = cache(async (): Promise<string[]> => {
  const [profile, companies] = await Promise.all([getCurrentProfile(), getAccessibleCompanies()]);
  if (!profile || !profile.active) return [];
  if (profile.isSuperAdmin) return companies.map((c) => c.slug);
  const supabase = await createServerClient();
  const checks = await Promise.all(
    companies.map(async (c) => {
      const { data, error } = await supabase.rpc("has_report_setting", { p_company: c.id, p_setting: "view_reports" });
      if (error) fail("permissão de relatórios", error);
      return data === true ? c.slug : null;
    }),
  );
  return checks.filter((s): s is string => s !== null);
});

/**
 * Permissões da tela de relatórios no escopo. view_reports vale por empresa (no escopo "todas", basta uma);
 * criar e compartilhar dashboards valem em qualquer empresa, como as políticas do banco.
 */
export async function getReportPermissions(scopeSlug: string): Promise<ReportPermissions> {
  const profile = await getCurrentProfile();
  if (!profile || !profile.active) return NONE;
  if (profile.isSuperAdmin) return { viewReports: true, createDashboards: true, shareDashboards: true };
  const supabase = await createServerClient();
  const [view, create, share] = await Promise.all([
    reportCompanyIds(scopeSlug),
    supabase.rpc("can_create_dashboards"),
    supabase.rpc("has_any_report_setting", { p_setting: "share_dashboards" }),
  ]);
  if (create.error) fail("permissão de dashboards", create.error);
  if (share.error) fail("permissão de compartilhamento", share.error);
  return {
    viewReports: view.length > 0,
    createDashboards: create.data === true,
    shareDashboards: share.data === true,
  };
}
