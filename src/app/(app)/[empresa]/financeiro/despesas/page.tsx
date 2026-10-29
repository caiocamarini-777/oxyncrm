import { notFound } from "next/navigation";
import { ExpensesManager } from "@/components/finance/expense-form";
import { requireUser } from "@/lib/auth/session";
import { getAccessibleCompanies, resolveCompanyScope } from "@/lib/companies/scope";
import { todaySaoPaulo } from "@/lib/finance/dates";
import { getFinanceAccess } from "@/lib/finance/permissions";
import { listFinanceLookups, listRecurringExpenses } from "@/lib/finance/queries";

export const instant = false;

export default async function FinanceExpensesPage({ params }: { params: Promise<{ empresa: string }> }) {
  const [{ empresa }, profile, companies] = await Promise.all([params, requireUser(), getAccessibleCompanies()]);
  const scope = resolveCompanyScope(empresa, companies, profile.isSuperAdmin);
  if (!scope || scope.kind === "all") notFound();
  const company = scope.company;

  const [access, expenses, lookups] = await Promise.all([
    getFinanceAccess(company.id),
    listRecurringExpenses(company.id),
    listFinanceLookups(company.id),
  ]);

  return (
    <ExpensesManager
      companyId={company.id}
      expenses={expenses}
      categories={lookups.expenseCategories}
      accounts={lookups.accounts}
      canManage={access.manage}
      startDefault={todaySaoPaulo().slice(0, 7)}
    />
  );
}
