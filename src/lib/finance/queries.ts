import "server-only";
import { createServerClient } from "@/lib/supabase/server";
import type { EntryRow, Snapshot } from "./calc";
import type { FinanceFilters } from "./filters";

const PAGE = 1000;

function fail(what: string, error: { message: string; code?: string }): never {
  console.error(`[financeiro] ${what}:`, error.code, error.message);
  throw new Error(`Falha ao carregar o financeiro (${what}).`);
}

const num = (v: number | string | null): number => (v === null ? 0 : Number(v));

const ENTRY_COLUMNS =
  "id, direction, status, due_date, settled_on, competence, gross, retention, amount, settled_amount, account_id, organization_id, service_category_id, income_category_id, expense_category_id, nature, description, locked";

/** Primeira conta ativa da empresa (por nome): destino dos lançamentos sem conta no saldo. */
async function defaultAccountId(supabase: Awaited<ReturnType<typeof createServerClient>>, companyId: string) {
  const { data, error } = await supabase
    .from("fin_accounts")
    .select("id")
    .eq("company_id", companyId)
    .eq("active", true)
    .order("name")
    .limit(1);
  if (error) fail("contas", error);
  return data?.[0]?.id ?? null;
}

type RawEntry = {
  id: string;
  direction: string;
  status: string;
  due_date: string;
  settled_on: string | null;
  competence: string;
  gross: number | string | null;
  retention: number | string | null;
  amount: number | string | null;
  settled_amount: number | string | null;
  account_id: string | null;
  organization_id: string | null;
  service_category_id: string | null;
  income_category_id: string | null;
  expense_category_id: string | null;
  nature: string | null;
  description: string | null;
  locked: boolean;
};

function mapEntry(r: RawEntry, fallbackAccountId: string | null): EntryRow {
  return {
    id: r.id,
    direction: r.direction as EntryRow["direction"],
    status: r.status as EntryRow["status"],
    dueDate: r.due_date,
    settledOn: r.settled_on,
    competence: r.competence,
    gross: num(r.gross),
    retention: num(r.retention),
    amount: num(r.amount),
    settledAmount: r.settled_amount === null ? null : num(r.settled_amount),
    accountId: r.account_id ?? fallbackAccountId,
    organizationId: r.organization_id,
    serviceCategoryId: r.service_category_id,
    expenseCategoryId: r.expense_category_id,
    nature: r.nature as EntryRow["nature"],
    description: r.description,
    incomeCategoryId: r.income_category_id,
    locked: r.locked,
  };
}

/**
 * Lançamentos da empresa no período (vencimento entre `from` e `to`), já com os filtros da tela.
 * Canceladas ficam de fora, a menos que o filtro de status as peça. Renovações pendentes e comissões
 * estimadas só entram quando os respectivos interruptores estão ligados.
 *
 * Lançamentos sem conta (account_id nulo) são atribuídos à primeira conta ativa da empresa (por nome)
 * no EntryLite.accountId devolvido, para que o saldo (balanceSeries) os conte; sem conta ativa, ficam nulos.
 */
export async function listEntries(companyId: string, f: FinanceFilters): Promise<EntryRow[]> {
  const supabase = await createServerClient();
  const fallback = await defaultAccountId(supabase, companyId);
  const rows: EntryRow[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await filteredQuery(supabase, companyId, f)
      .order("due_date")
      .order("id")
      .range(offset, offset + PAGE - 1);
    if (error) fail("lançamentos", error);
    for (const r of data ?? []) rows.push(mapEntry(r, fallback));
    if (!data || data.length < PAGE) break;
  }
  return rows;
}

function filteredQuery(supabase: Awaited<ReturnType<typeof createServerClient>>, companyId: string, f: FinanceFilters, count = false) {
  let q = supabase
    .from("fin_entries")
    .select(ENTRY_COLUMNS, count ? { count: "exact" } : undefined)
    .eq("company_id", companyId)
    .gte("due_date", f.from)
    .lte("due_date", f.to);
  if (!f.includePendingRenewals) q = q.eq("renewal_pending", false);
  if (!f.includeEstimatedCommissions) q = q.eq("estimated", false);
  q = f.statuses.length > 0 ? q.in("status", f.statuses) : q.neq("status", "cancelled");
  if (f.clients.length > 0) q = q.in("organization_id", f.clients);
  if (f.serviceCategories.length > 0) q = q.in("service_category_id", f.serviceCategories);
  if (f.expenseCategories.length > 0) q = q.in("expense_category_id", f.expenseCategories);
  if (f.natures.length > 0) q = q.in("nature", f.natures);
  if (f.accounts.length > 0) q = q.in("account_id", f.accounts);
  return q;
}

/** Uma página (base 1) da lista de Lançamentos, com o total que casa com os filtros. Contas ficam como no banco. */
export async function listEntriesPage(
  companyId: string,
  f: FinanceFilters,
  page: number,
  pageSize: number,
): Promise<{ rows: EntryRow[]; total: number }> {
  const supabase = await createServerClient();
  const from = (page - 1) * pageSize;
  const { data, error, count } = await filteredQuery(supabase, companyId, f, true)
    .order("due_date")
    .order("id")
    .range(from, from + pageSize - 1);
  if (error) fail("lançamentos", error);
  return { rows: (data ?? []).map((r) => mapEntry(r, null)), total: count ?? 0 };
}

/**
 * Base do saldo: ignora os demais filtros da tela. Devolve lançamentos não cancelados que estão em aberto
 * com vencimento até `to`, ou liquidados com `settled_on` em (`since`, `to`]. Sem conta, vale a regra de
 * atribuição de listEntries.
 */
export async function listBalanceEntries(
  companyId: string,
  since: string,
  to: string,
  opts: { includePendingRenewals: boolean; includeEstimatedCommissions: boolean },
): Promise<EntryRow[]> {
  const supabase = await createServerClient();
  const fallback = await defaultAccountId(supabase, companyId);
  const rows: EntryRow[] = [];
  for (let offset = 0; ; offset += PAGE) {
    let q = supabase
      .from("fin_entries")
      .select(ENTRY_COLUMNS)
      .eq("company_id", companyId)
      .or(`and(status.eq.open,due_date.lte.${to}),and(status.eq.settled,settled_on.gt.${since},settled_on.lte.${to})`);
    if (!opts.includePendingRenewals) q = q.eq("renewal_pending", false);
    if (!opts.includeEstimatedCommissions) q = q.eq("estimated", false);
    const { data, error } = await q.order("due_date").order("id").range(offset, offset + PAGE - 1);
    if (error) fail("lançamentos do saldo", error);
    for (const r of data ?? []) rows.push(mapEntry(r, fallback));
    if (!data || data.length < PAGE) break;
  }
  return rows;
}

/** Saldos informados por conta (todos, do mais antigo ao mais novo). */
export async function listSnapshots(companyId: string): Promise<Snapshot[]> {
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("fin_balance_snapshots")
    .select("account_id, as_of, balance")
    .eq("company_id", companyId)
    .order("as_of");
  if (error) fail("saldos", error);
  return (data ?? []).map((s) => ({ accountId: s.account_id, asOf: s.as_of, balance: num(s.balance) }));
}

export type FinanceLookups = {
  accounts: { id: string; name: string }[];
  serviceCategories: { id: string; name: string }[];
  expenseCategories: { id: string; name: string; defaultNature: "fixed" | "variable" | "non_recurring" }[];
  incomeCategories: { id: string; name: string }[];
  /** Organizações que têm contrato (os "clientes" do Financeiro). */
  clients: { id: string; name: string }[];
};

/** Listas para os filtros e formulários: contas, categorias e clientes com contrato (só ativas). */
export async function listFinanceLookups(companyId: string): Promise<FinanceLookups> {
  const supabase = await createServerClient();
  const [accounts, services, expenses, incomes, contracts] = await Promise.all([
    supabase.from("fin_accounts").select("id, name").eq("company_id", companyId).eq("active", true).order("name"),
    supabase.from("service_categories").select("id, name").eq("company_id", companyId).eq("active", true).order("position").order("name"),
    supabase.from("fin_expense_categories").select("id, name, default_nature").eq("company_id", companyId).eq("active", true).order("position").order("name"),
    supabase.from("fin_income_categories").select("id, name").eq("company_id", companyId).eq("active", true).order("position").order("name"),
    supabase.from("fin_contracts").select("organization_id, organizations(id, name)").eq("company_id", companyId).not("organization_id", "is", null),
  ]);
  for (const [what, r] of [["contas", accounts], ["categorias de serviço", services], ["categorias de despesa", expenses], ["categorias de receita", incomes], ["clientes", contracts]] as const) {
    if (r.error) fail(what, r.error);
  }
  const clients = new Map<string, string>();
  for (const c of contracts.data ?? []) {
    const o = Array.isArray(c.organizations) ? c.organizations[0] : c.organizations;
    if (o) clients.set(o.id, o.name);
  }
  return {
    accounts: accounts.data ?? [],
    serviceCategories: services.data ?? [],
    expenseCategories: (expenses.data ?? []).map((e) => ({
      id: e.id,
      name: e.name,
      defaultNature: e.default_nature as FinanceLookups["expenseCategories"][number]["defaultNature"],
    })),
    incomeCategories: incomes.data ?? [],
    clients: [...clients].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, "pt-BR")),
  };
}
