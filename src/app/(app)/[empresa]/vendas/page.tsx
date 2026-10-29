import { notFound } from "next/navigation";
import { SalesManager, type MySale, type SaleContractOption } from "@/components/finance/sale-form";
import { requireUser } from "@/lib/auth/session";
import { getAccessibleCompanies, resolveCompanyScope } from "@/lib/companies/scope";
import { todaySaoPaulo } from "@/lib/finance/dates";
import { getFinanceAccess } from "@/lib/finance/permissions";
import { createServerClient } from "@/lib/supabase/server";

export const instant = false;

type ContractRow = { contract_id: string; line_id: string; contract_title: string; client_name: string | null };
type SaleRowDb = {
  id: string;
  contract_title: string;
  buyer: string;
  sold_on: string;
  setup_value: number | string;
  recurring_value: number | string;
  recurring_months: number | null;
  status: string;
  editable: boolean;
  line_id: string;
  setup_installments: number;
  setup_first_month: string | null;
  recurring_start: string | null;
  note: string | null;
};

function fail(what: string, error: { message: string; code?: string }): never {
  console.error(`[vendas] ${what}:`, error.code, error.message);
  throw new Error(`Falha ao carregar as vendas (${what}).`);
}

/**
 * Tela do vendedor. Usa só as funções fin_sales_contracts e fin_my_sales: o vendedor não lê nada de
 * fin_* por RLS e nunca recebe percentuais nem valores de comissão.
 */
export default async function SalesPage({ params }: { params: Promise<{ empresa: string }> }) {
  const [{ empresa }, profile, companies] = await Promise.all([params, requireUser(), getAccessibleCompanies()]);
  const scope = resolveCompanyScope(empresa, companies, profile.isSuperAdmin);
  if (!scope || scope.kind === "all") notFound();
  const company = scope.company;
  if (!(await getFinanceAccess(company.id)).sell) notFound();

  const supabase = await createServerClient();
  const [contracts, mine] = await Promise.all([
    supabase.rpc("fin_sales_contracts", { p_company: company.id }),
    supabase.rpc("fin_my_sales", { p_company: company.id }),
  ]);
  if (contracts.error) fail("contratos", contracts.error);
  if (mine.error) fail("minhas vendas", mine.error);

  const options: SaleContractOption[] = ((contracts.data ?? []) as ContractRow[]).map((c) => ({
    contractId: c.contract_id,
    lineId: c.line_id,
    contractTitle: c.contract_title,
    clientName: c.client_name,
  }));
  const sales: MySale[] = ((mine.data ?? []) as SaleRowDb[]).map((s) => ({
    id: s.id,
    contractTitle: s.contract_title,
    buyer: s.buyer,
    soldOn: s.sold_on,
    setupValue: Number(s.setup_value),
    recurringValue: Number(s.recurring_value),
    recurringMonths: s.recurring_months,
    status: s.status,
    editable: s.editable,
    lineId: s.line_id,
    setupInstallments: s.setup_installments,
    setupFirstMonth: s.setup_first_month,
    recurringStart: s.recurring_start,
    note: s.note,
  }));

  return <SalesManager companyId={company.id} contracts={options} sales={sales} today={todaySaoPaulo()} />;
}
