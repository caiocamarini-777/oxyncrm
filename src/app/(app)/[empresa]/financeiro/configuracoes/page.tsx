import { notFound } from "next/navigation";
import { AccountsManager } from "@/components/finance/accounts-manager";
import { CategoriesManager } from "@/components/finance/categories-manager";
import { requireUser } from "@/lib/auth/session";
import { getAccessibleCompanies, resolveCompanyScope } from "@/lib/companies/scope";
import { todaySaoPaulo } from "@/lib/finance/dates";
import { getFinanceAccess } from "@/lib/finance/permissions";
import { getFinanceSettings } from "@/lib/finance/queries";

export const instant = false;

export default async function FinanceSettingsPage({ params }: { params: Promise<{ empresa: string }> }) {
  const [{ empresa }, profile, companies] = await Promise.all([params, requireUser(), getAccessibleCompanies()]);
  const scope = resolveCompanyScope(empresa, companies, profile.isSuperAdmin);
  if (!scope || scope.kind === "all") notFound();
  const company = scope.company;
  const access = await getFinanceAccess(company.id);
  // A aba só existe para quem gerencia o financeiro.
  if (!access.manage) notFound();
  const settings = await getFinanceSettings(company.id);

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3" aria-label="Contas">
        <h2 className="font-heading text-base font-semibold">Contas</h2>
        <AccountsManager companyId={company.id} accounts={settings.accounts} canManage today={todaySaoPaulo()} />
      </section>
      <section className="flex flex-col gap-3" aria-label="Categorias de despesa">
        <h2 className="font-heading text-base font-semibold">Categorias de despesa</h2>
        <CategoriesManager kind="expense" companyId={company.id} categories={settings.expenseCategories} canManage />
      </section>
      <section className="flex flex-col gap-3" aria-label="Categorias de receita">
        <h2 className="font-heading text-base font-semibold">Categorias de receita</h2>
        <CategoriesManager kind="income" companyId={company.id} categories={settings.incomeCategories} canManage />
      </section>
    </div>
  );
}
