// Filtros do Financeiro: vivem na URL (pura, sem servidor) para a tela ser compartilhável.

export const NATURES = ["fixed", "variable", "non_recurring"] as const;
export const STATUSES = ["open", "settled", "cancelled"] as const;
export const HORIZONS = [3, 6, 12, 24, 36] as const;

export type Nature = (typeof NATURES)[number];
export type Status = (typeof STATUSES)[number];
export type Horizon = (typeof HORIZONS)[number];

export type FinanceFilters = {
  from: string;
  to: string;
  clients: string[];
  serviceCategories: string[];
  expenseCategories: string[];
  natures: Nature[];
  accounts: string[];
  statuses: Status[];
  includePendingRenewals: boolean;
  includeEstimatedCommissions: boolean;
  /** Só lançamentos alterados à mão (editados ou pagos com valor diferente do previsto). */
  onlyChanged: boolean;
  horizon: Horizon;
};

type SearchParams = Record<string, string | string[] | undefined>;

const DEFAULT_HORIZON: Horizon = 12;

function isIsoDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function monthBounds(today: string): { from: string; to: string } {
  const [y, m] = today.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const ym = today.slice(0, 7);
  return { from: `${ym}-01`, to: `${ym}-${String(last).padStart(2, "0")}` };
}

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

/** Lista na URL: `a,b` ou chave repetida; vazios e repetidos saem. */
function list(v: string | string[] | undefined): string[] {
  const raw = Array.isArray(v) ? v : v ? [v] : [];
  const out = raw.flatMap((x) => x.split(",")).map((x) => x.trim()).filter(Boolean);
  return [...new Set(out)];
}

function only<T extends string>(values: readonly T[], v: string | string[] | undefined): T[] {
  return list(v).filter((x): x is T => (values as readonly string[]).includes(x));
}

export function parseFinanceFilters(sp: SearchParams, today: string): FinanceFilters {
  const def = monthBounds(today);
  const f = first(sp.from);
  const t = first(sp.to);
  let from = f && isIsoDate(f) ? f : def.from;
  let to = t && isIsoDate(t) ? t : def.to;
  if (from > to) [from, to] = [to, from];
  const h = Number(first(sp.horizon));
  return {
    from,
    to,
    clients: list(sp.clients),
    serviceCategories: list(sp.services),
    expenseCategories: list(sp.expenses),
    natures: only(NATURES, sp.natures),
    accounts: list(sp.accounts),
    statuses: only(STATUSES, sp.statuses),
    includePendingRenewals: first(sp.pending) === "1",
    includeEstimatedCommissions: first(sp.estimated) === "1",
    onlyChanged: first(sp.changed) === "1",
    horizon: (HORIZONS as readonly number[]).includes(h) ? (h as Horizon) : DEFAULT_HORIZON,
  };
}

/** Parâmetros da URL; os valores padrão não aparecem (a URL limpa é o mês corrente). */
export function toFinanceSearchParams(f: FinanceFilters, today?: string): URLSearchParams {
  const sp = new URLSearchParams();
  // Sem "hoje" não há como saber o mês padrão: o padrão de from/to é o mês de f.from/f.to inteiro.
  const def = today ? monthBounds(today) : null;
  if (!def || f.from !== def.from) sp.set("from", f.from);
  if (!def || f.to !== def.to) sp.set("to", f.to);
  const lists: [string, string[]][] = [
    ["clients", f.clients],
    ["services", f.serviceCategories],
    ["expenses", f.expenseCategories],
    ["natures", f.natures],
    ["accounts", f.accounts],
    ["statuses", f.statuses],
  ];
  for (const [k, v] of lists) if (v.length > 0) sp.set(k, v.join(","));
  if (f.includePendingRenewals) sp.set("pending", "1");
  if (f.includeEstimatedCommissions) sp.set("estimated", "1");
  if (f.onlyChanged) sp.set("changed", "1");
  if (f.horizon !== DEFAULT_HORIZON) sp.set("horizon", String(f.horizon));
  return sp;
}
