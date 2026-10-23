import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { AddWidgetDialog } from "@/components/dashboards/add-widget-dialog";
import { DashboardFilters } from "@/components/dashboards/dashboard-filters";
import { DashboardView } from "@/components/dashboards/dashboard-view";
import { requireUser } from "@/lib/auth/session";
import { getAccessibleCompanies, resolveCompanyScope } from "@/lib/companies/scope";
import { dayKey } from "@/lib/activities/time";
import { resolveDashboardFilters } from "@/lib/dashboards/filters";
import { getReportLookups } from "@/lib/reports/lookups";
import { getReportPermissions, reportCompanySlugs } from "@/lib/reports/permissions";
import { getDashboard, listReports, runWidgetResult } from "@/lib/reports/queries";

export const instant = false;

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function DashboardPage({
  params,
  searchParams,
}: {
  params: Promise<{ empresa: string; id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await connection();
  const [{ empresa, id }, sp] = await Promise.all([params, searchParams]);
  const [perms, profile, companies, slugs] = await Promise.all([
    getReportPermissions(empresa),
    requireUser(),
    getAccessibleCompanies(),
    reportCompanySlugs(),
  ]);
  // Quem recebeu o dashboard abre sem view_reports: o acesso é decidido por getDashboard (dono, compartilhamento ou admin).
  const scope = resolveCompanyScope(empresa, companies, profile.isSuperAdmin);
  if (!scope) notFound();
  const dashboard = await getDashboard(id);
  if (!dashboard) notFound();

  // O filtro de empresa só existe no escopo "Todas as empresas", entre as empresas com view_reports.
  const allOptions = scope.kind === "all" ? companies.filter((c) => slugs.includes(c.slug)) : [];
  const options = allOptions.length > 0 ? allOptions : null;
  const companyBySlug = options ? new Map(options.map((c) => [c.slug, c.id])) : null;
  const params2 = { de: first(sp.de), ate: first(sp.ate), empresa: first(sp.empresa) };
  const filters = resolveDashboardFilters(
    params2,
    dashboard.defaultFilters,
    companyBySlug,
    scope.kind === "company" ? scope.company.id : null,
  );
  const urlOnly = resolveDashboardFilters(params2, {}, companyBySlug, null);
  const today = dayKey(new Date());

  const readOnly = !dashboard.isOwner;
  // Adicionar widget precisa listar relatórios e funis, o que exige view_reports.
  const canAdd = !readOnly && perms.viewReports;
  const [reports, lookups] = !canAdd
    ? [[], null]
    : await Promise.all([listReports(empresa), getReportLookups(empresa)]);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <Link href={`/${empresa}/relatorios/dashboards`} className="text-sm text-muted-foreground hover:underline">
            Dashboards
          </Link>
          <h1 className="font-heading text-2xl font-semibold">{dashboard.name}</h1>
        </div>
        {canAdd && lookups ? (
          <AddWidgetDialog
            dashboardId={dashboard.id}
            reports={reports.map((r) => ({ id: r.id, name: r.name }))}
            pipelines={lookups.fields.pipeline ?? []}
            defaultPipeline={lookups.defaultPipeline}
          />
        ) : null}
      </header>

      <DashboardFilters
        today={today}
        period={urlOnly.period ?? null}
        companies={options ? options.map((c) => ({ slug: c.slug, name: c.name })) : null}
        company={options?.find((c) => urlOnly.company?.[0] === c.id)?.slug ?? ""}
      />

      <DashboardView
        dashboardId={dashboard.id}
        widgets={dashboard.widgets}
        filters={filters}
        readOnly={readOnly}
        load={runWidgetResult}
      />
    </div>
  );
}
