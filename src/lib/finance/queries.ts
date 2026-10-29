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

// --- Contratos, despesas recorrentes e configurações ---------------------------

export type ContractStatus = "draft" | "active" | "ended" | "cancelled";

export type ContractSummary = {
  id: string;
  title: string;
  status: ContractStatus;
  organizationId: string | null;
  organizationName: string | null;
  sourceChanged: boolean;
  dealId: string | null;
};

type OrgJoin = { id: string; name: string } | { id: string; name: string }[] | null;
const orgOf = (o: OrgJoin) => (Array.isArray(o) ? (o[0] ?? null) : o);

/** Contagem por status e a lista dos contratos de um grupo de status. */
export async function listContracts(
  companyId: string,
  statuses: ContractStatus[],
): Promise<{ rows: ContractSummary[]; pending: number }> {
  const supabase = await createServerClient();
  const [list, pending] = await Promise.all([
    supabase
      .from("fin_contracts")
      .select("id, title, status, organization_id, source_changed, deal_id, organizations(id, name)")
      .eq("company_id", companyId)
      .in("status", statuses)
      .order("created_at", { ascending: false })
      .limit(500),
    supabase.from("fin_contracts").select("id", { count: "exact", head: true }).eq("company_id", companyId).eq("status", "draft"),
  ]);
  if (list.error) fail("contratos", list.error);
  if (pending.error) fail("contratos pendentes", pending.error);
  return {
    pending: pending.count ?? 0,
    rows: (list.data ?? []).map((c) => ({
      id: c.id,
      title: c.title,
      status: c.status as ContractStatus,
      organizationId: c.organization_id,
      organizationName: orgOf(c.organizations as OrgJoin)?.name ?? null,
      sourceChanged: c.source_changed,
      dealId: c.deal_id,
    })),
  };
}

export type ContractLineRow = {
  kind: "setup" | "recurring" | "commission";
  description: string;
  serviceCategoryId: string | null;
  amount: number | null;
  firstMonth: string;
  installments: number;
  months: number | null;
  setupRate: number | null;
  recurringRate: number | null;
  estimatedMonthly: number | null;
};

export type ContractDetail = {
  id: string;
  companyId: string;
  title: string;
  status: ContractStatus;
  organizationId: string | null;
  organizationName: string | null;
  dueDay: number | null;
  retentionRate: number;
  accountId: string | null;
  endRule: "ends" | "auto_renew" | "renew_adjust" | "confirm" | null;
  renewalMonths: number | null;
  adjustKind: "none" | "percent" | "index";
  adjustIndex: "IPCA" | "IGP-M" | "INPC" | null;
  adjustRate: number;
  sourceChanged: boolean;
  dealId: string | null;
  notes: string | null;
  lines: ContractLineRow[];
  entries: EntryRow[];
};

export async function getContract(companyId: string, id: string): Promise<ContractDetail | null> {
  const supabase = await createServerClient();
  const c = await supabase
    .from("fin_contracts")
    .select("*, organizations(id, name)")
    .eq("id", id)
    .eq("company_id", companyId)
    .maybeSingle();
  if (c.error) fail("contrato", c.error);
  if (!c.data) return null;
  const [lines, entries] = await Promise.all([
    supabase.from("fin_contract_lines").select("*").eq("contract_id", id).order("created_at").order("id"),
    supabase.from("fin_entries").select(ENTRY_COLUMNS).eq("contract_id", id).neq("status", "cancelled").order("due_date").order("id").limit(1000),
  ]);
  if (lines.error) fail("linhas do contrato", lines.error);
  if (entries.error) fail("lançamentos do contrato", entries.error);
  const d = c.data;
  return {
    id: d.id,
    companyId: d.company_id,
    title: d.title,
    status: d.status as ContractStatus,
    organizationId: d.organization_id,
    organizationName: orgOf(d.organizations as OrgJoin)?.name ?? null,
    dueDay: d.due_day,
    retentionRate: num(d.retention_rate),
    accountId: d.account_id,
    endRule: d.end_rule as ContractDetail["endRule"],
    renewalMonths: d.renewal_months,
    adjustKind: d.adjust_kind as ContractDetail["adjustKind"],
    adjustIndex: d.adjust_index as ContractDetail["adjustIndex"],
    adjustRate: num(d.adjust_rate),
    sourceChanged: d.source_changed,
    dealId: d.deal_id,
    notes: d.notes,
    lines: (lines.data ?? []).map((l) => ({
      kind: l.kind as ContractLineRow["kind"],
      description: l.description,
      serviceCategoryId: l.service_category_id,
      amount: l.amount === null ? null : num(l.amount),
      firstMonth: l.first_month,
      installments: l.installments,
      months: l.months,
      setupRate: l.setup_rate === null ? null : num(l.setup_rate),
      recurringRate: l.recurring_rate === null ? null : num(l.recurring_rate),
      estimatedMonthly: l.estimated_monthly === null ? null : num(l.estimated_monthly),
    })),
    entries: (entries.data ?? []).map((r) => mapEntry(r as RawEntry, null)),
  };
}

/** Todas as organizações da empresa (para escolher o cliente de um contrato). */
export async function listOrganizations(companyId: string): Promise<{ id: string; name: string }[]> {
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("organizations")
    .select("id, name")
    .eq("company_id", companyId)
    .is("deleted_at", null)
    .order("name")
    .limit(1000);
  if (error) fail("organizações", error);
  return data ?? [];
}

export type RecurringExpenseRow = {
  id: string;
  description: string;
  payee: string | null;
  expenseCategoryId: string;
  nature: "fixed" | "variable" | "non_recurring";
  amount: number;
  frequency: "monthly" | "quarterly" | "yearly";
  dueDay: number;
  startMonth: string;
  endMonth: string | null;
  installments: number | null;
  adjustRate: number;
  adjustMonth: number | null;
  accountId: string | null;
  active: boolean;
};

export async function listRecurringExpenses(companyId: string): Promise<RecurringExpenseRow[]> {
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("fin_recurring_expenses")
    .select("*")
    .eq("company_id", companyId)
    .order("active", { ascending: false })
    .order("description");
  if (error) fail("despesas recorrentes", error);
  return (data ?? []).map((r) => ({
    id: r.id,
    description: r.description,
    payee: r.payee,
    expenseCategoryId: r.expense_category_id,
    nature: r.nature as RecurringExpenseRow["nature"],
    amount: num(r.amount),
    frequency: r.frequency as RecurringExpenseRow["frequency"],
    dueDay: r.due_day,
    startMonth: r.start_month,
    endMonth: r.end_month,
    installments: r.installments,
    adjustRate: num(r.adjust_rate),
    adjustMonth: r.adjust_month,
    accountId: r.account_id,
    active: r.active,
  }));
}

export type SettingsData = {
  accounts: { id: string; name: string; bank: string | null; active: boolean; balance: number | null; balanceAsOf: string | null }[];
  expenseCategories: { id: string; name: string; defaultNature: "fixed" | "variable" | "non_recurring"; active: boolean }[];
  incomeCategories: { id: string; name: string; active: boolean }[];
};

/** Configurações do Financeiro: contas (com o último saldo informado) e categorias, ativas e inativas. */
export async function getFinanceSettings(companyId: string): Promise<SettingsData> {
  const supabase = await createServerClient();
  const [accounts, snaps, expenses, incomes] = await Promise.all([
    supabase.from("fin_accounts").select("id, name, bank, active").eq("company_id", companyId).order("active", { ascending: false }).order("name"),
    supabase.from("fin_balance_snapshots").select("account_id, as_of, balance").eq("company_id", companyId).order("as_of", { ascending: false }),
    supabase.from("fin_expense_categories").select("id, name, default_nature, active").eq("company_id", companyId).order("position").order("name"),
    supabase.from("fin_income_categories").select("id, name, active").eq("company_id", companyId).order("position").order("name"),
  ]);
  for (const [what, r] of [["contas", accounts], ["saldos", snaps], ["categorias de despesa", expenses], ["categorias de receita", incomes]] as const) {
    if (r.error) fail(what, r.error);
  }
  const latest = new Map<string, { asOf: string; balance: number }>();
  for (const s of snaps.data ?? []) if (!latest.has(s.account_id)) latest.set(s.account_id, { asOf: s.as_of, balance: num(s.balance) });
  return {
    accounts: (accounts.data ?? []).map((a) => ({
      ...a,
      balance: latest.get(a.id)?.balance ?? null,
      balanceAsOf: latest.get(a.id)?.asOf ?? null,
    })),
    expenseCategories: (expenses.data ?? []).map((e) => ({
      id: e.id,
      name: e.name,
      defaultNature: e.default_nature as SettingsData["expenseCategories"][number]["defaultNature"],
      active: e.active,
    })),
    incomeCategories: incomes.data ?? [],
  };
}
