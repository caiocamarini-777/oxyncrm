import { notFound } from "next/navigation";
import { connection } from "next/server";
import { ReportBuilder } from "@/components/reports/report-builder";
import { requireUser } from "@/lib/auth/session";
import { getAccessibleCompanies, resolveCompanyScope } from "@/lib/companies/scope";
import { getReportLookups } from "@/lib/reports/lookups";
import { getReportPermissions } from "@/lib/reports/permissions";

export const instant = false;

export default async function NewReportPage({ params }: { params: Promise<{ empresa: string }> }) {
  await connection();
  const { empresa } = await params;
  const [perms, profile, companies] = await Promise.all([
    getReportPermissions(empresa),
    requireUser(),
    getAccessibleCompanies(),
  ]);
  if (!perms.viewReports) notFound();
  const scope = resolveCompanyScope(empresa, companies, profile.isSuperAdmin);
  if (!scope) notFound();
  const lookups = await getReportLookups(empresa);

  return (
    <div className="space-y-6">
      <h1 className="font-heading text-2xl font-semibold">Novo relatório</h1>
      <ReportBuilder
        scopeSlug={empresa}
        companyId={scope.kind === "company" ? scope.company.id : null}
        lookups={lookups}
      />
    </div>
  );
}
