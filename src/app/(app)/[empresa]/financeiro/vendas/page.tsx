import { notFound } from "next/navigation";
import { FinanceSalesTable } from "@/components/finance/sales-table";
import { requireUser } from "@/lib/auth/session";
import { getAccessibleCompanies, resolveCompanyScope } from "@/lib/companies/scope";
import { getFinanceAccess } from "@/lib/finance/permissions";
import { listSales, listSalesFilterOptions } from "@/lib/finance/queries";
import { z } from "zod";

export const instant = false;

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const uuidOrNull = (v: string | string[] | undefined) => {
  const r = z.string().uuid().safeParse(one(v));
  return r.success ? r.data : null;
};

export default async function FinanceSalesPage({
  params,
  searchParams,
}: {
  params: Promise<{ empresa: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ empresa }, sp, profile, companies] = await Promise.all([params, searchParams, requireUser(), getAccessibleCompanies()]);
  const scope = resolveCompanyScope(empresa, companies, profile.isSuperAdmin);
  if (!scope || scope.kind === "all") notFound();
  const company = scope.company;
  if (!(await getFinanceAccess(company.id)).view) notFound();

  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(one(sp.mes) ?? "") ? (one(sp.mes) as string) : null;
  const filters = { contractId: uuidOrNull(sp.contrato), sellerId: uuidOrNull(sp.vendedor), month };
  const [sales, options] = await Promise.all([listSales(company.id, filters), listSalesFilterOptions(company.id)]);

  return <FinanceSalesTable sales={sales} empresa={company.slug} contracts={options.contracts} sellers={options.sellers} filters={filters} />;
}
