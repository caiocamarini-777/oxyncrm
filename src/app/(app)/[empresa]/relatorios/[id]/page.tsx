import { notFound } from "next/navigation";
import { connection } from "next/server";
import { ReportBuilder } from "@/components/reports/report-builder";
import { ReportChart } from "@/components/reports/report-chart";
import { requireUser } from "@/lib/auth/session";
import { getAccessibleCompanies, resolveCompanyScope } from "@/lib/companies/scope";
import { getReportLookups } from "@/lib/reports/lookups";
import { getReportPermissions } from "@/lib/reports/permissions";
import { getReport, runReport } from "@/lib/reports/queries";

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

  if (report.spec.kind !== "custom") {
    const result = await runReport(report.spec, empresa);
    return (
      <div className="space-y-6">
        <h1 className="font-heading text-2xl font-semibold">{report.name}</h1>
        <ReportChart result={result} chart={report.spec.chart ?? "table"} title={report.name} />
      </div>
    );
  }

  const lookups = await getReportLookups(empresa);
  return (
    <div className="space-y-6">
      <h1 className="font-heading text-2xl font-semibold">{report.name}</h1>
      <ReportBuilder
        scopeSlug={empresa}
        companyId={scope.kind === "company" ? scope.company.id : null}
        lookups={lookups}
        initial={{ id: report.id, name: report.name, spec: report.spec }}
      />
    </div>
  );
}
