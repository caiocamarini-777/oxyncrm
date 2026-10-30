import { notFound } from "next/navigation";
import { FinanceTabs } from "@/components/finance/finance-tabs";
import { requireUser } from "@/lib/auth/session";
import { getAccessibleCompanies, resolveCompanyScope } from "@/lib/companies/scope";
import { getFinanceAccess } from "@/lib/finance/permissions";

export const instant = false;

/** Financeiro: só dentro de uma empresa com o módulo ativado e view_finance; o resto é 404. */
export default async function FinanceLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ empresa: string }>;
}) {
  const [{ empresa }, profile, companies] = await Promise.all([params, requireUser(), getAccessibleCompanies()]);
  const scope = resolveCompanyScope(empresa, companies, profile.isSuperAdmin);
  if (!scope || scope.kind === "all") notFound();
  const access = await getFinanceAccess(scope.company.id);
  if (!access.view) notFound();

  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-heading text-xl font-semibold">Financeiro</h1>
      <FinanceTabs empresa={scope.company.slug} canManage={access.manage} />
      {children}
    </div>
  );
}
