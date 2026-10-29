import { notFound } from "next/navigation";
import { FinanceSalesTable } from "@/components/finance/sales-table";
import { requireUser } from "@/lib/auth/session";
import { getAccessibleCompanies, resolveCompanyScope } from "@/lib/companies/scope";
import { todaySaoPaulo } from "@/lib/finance/dates";
import { createServerClient } from "@/lib/supabase/server";
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
  const access = await getFinanceAccess(company.id);
  if (!access.view) notFound();

  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(one(sp.mes) ?? "") ? (one(sp.mes) as string) : null;
  const filters = { contractId: uuidOrNull(sp.contrato), sellerId: uuidOrNull(sp.vendedor), month };
  const [sales, options] = await Promise.all([listSales(company.id, filters), listSalesFilterOptions(company.id)]);

  let manage;
  if (access.manage) {
    const lines = await (await createServerClient()).rpc("fin_sales_contracts", { p_company: company.id });
    if (lines.error) throw new Error("Falha ao carregar as vendas (contratos).");
    type L = { contract_id: string; line_id: string; contract_title: string; client_name: string | null };
    manage = {
      companyId: company.id,
      today: todaySaoPaulo(),
      contracts: ((lines.data ?? []) as L[]).map((c) => ({
        contractId: c.contract_id,
        lineId: c.line_id,
        contractTitle: c.contract_title,
        clientName: c.client_name,
      })),
    };
  }

  return (
    <FinanceSalesTable
      sales={sales}
      empresa={company.slug}
      contracts={options.contracts}
      sellers={options.sellers}
      filters={filters}
      manage={manage}
    />
  );
}
