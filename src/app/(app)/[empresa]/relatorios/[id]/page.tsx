import { notFound } from "next/navigation";
import { connection } from "next/server";
import { ReportBuilder } from "@/components/reports/report-builder";
import { ReportChart } from "@/components/reports/report-chart";
import { requireUser } from "@/lib/auth/session";
import { getAccessibleCompanies, resolveCompanyScope } from "@/lib/companies/scope";
import { getReportLookups } from "@/lib/reports/lookups";
import { getReportPermissions, reportCompanyIds } from "@/lib/reports/permissions";
import { getReport, runReportResult } from "@/lib/reports/queries";

export const instant = false;

export default async function ReportPage({ params }: { params: Promise<{ empresa: string; id: string }> }) {
  await connection();
  const { empresa, id } = await params;
  const [perms, profile, companies] = await Promise.all([
    getReportPermissions(empresa),
    requireUser(),
    getAccessibleCompanies(),
  ]);
  if (!perms.viewReports) notFound();
  const scope = resolveCompanyScope(empresa, companies, profile.isSuperAdmin);
  if (!scope) notFound();
  const report = await getReport(id);
  if (!report) notFound();
  // Relatório de uma empresa: ela precisa estar no escopo e ter view_reports; roda só nela (como o widget).
  if (report.companyId && !(await reportCompanyIds(empresa)).includes(report.companyId)) notFound();

  if (report.spec.kind !== "custom") {
    const res = await runReportResult(report.spec, empresa, report.companyId);
    return (
      <div className="space-y-6">
        <h1 className="font-heading text-2xl font-semibold">{report.name}</h1>
        {res.ok ? (
          <ReportChart result={res.data} chart={report.spec.chart ?? "table"} title={report.name} />
        ) : (
          <p role="alert" className="py-8 text-center text-sm text-destructive">
            {res.error}
          </p>
        )}
      </div>
    );
  }

  const lookups = await getReportLookups(empresa);
  return (
    <div className="space-y-6">
      <h1 className="font-heading text-2xl font-semibold">{report.name}</h1>
      <ReportBuilder
        scopeSlug={empresa}
        companyId={report.companyId}
        lookups={lookups}
        initial={{ id: report.id, name: report.name, spec: report.spec }}
      />
    </div>
  );
}
