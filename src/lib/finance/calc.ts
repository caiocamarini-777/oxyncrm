// Cálculos puros do Financeiro: saldo, projeção mensal, participação e custos.
// Datas são strings ISO 'YYYY-MM-DD'; meses são 'YYYY-MM-01'.

export type EntryLite = {
  id: string;
  direction: "in" | "out";
  status: "open" | "settled" | "cancelled";
  dueDate: string;
  settledOn: string | null;
  competence: string;
  gross: number;
  retention: number;
  amount: number;
  settledAmount: number | null;
  accountId: string | null;
  organizationId: string | null;
  serviceCategoryId: string | null;
  expenseCategoryId: string | null;
  nature: "fixed" | "variable" | "non_recurring" | null;
};

/** Lançamento com os campos de exibição (listas, tabela e CSV). */
export type EntryRow = EntryLite & {
  description: string | null;
  incomeCategoryId: string | null;
  locked: boolean;
};

export type Snapshot = { accountId: string; asOf: string; balance: number };

export type MonthRow = {
  month: string;
  grossIn: number;
  retention: number;
  netIn: number;
  fixed: number;
  variable: number;
  nonRecurring: number;
  result: number;
  realized: boolean;
};

const toCents = (v: number) => Math.round(v * 100);
const fromCents = (c: number) => c / 100;

function addDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** Valor efetivo em centavos: liquidado usa settledAmount, aberto usa amount. */
function effectiveCents(e: EntryLite): number {
  return toCents(e.status === "settled" ? (e.settledAmount ?? e.amount) : e.amount);
}

/** Data em que o lançamento afeta o caixa; null se não conta. */
function cashDate(e: EntryLite, today: string): string | null {
  if (e.status === "cancelled") return null;
  if (e.status === "settled") return e.settledOn;
  return e.dueDate > today ? e.dueDate : today;
}

export function balanceSeries(
  snapshots: Snapshot[],
  entries: EntryLite[],
  from: string,
  to: string,
  today: string,
): { date: string; balance: number }[] | null {
  if (snapshots.length === 0) return null;

  const dates: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) dates.push(d);

  // Snapshot base por conta: último com asOf <= from, senão o primeiro depois.
  const base = new Map<string, Snapshot>();
  for (const s of [...snapshots].sort((a, b) => a.asOf.localeCompare(b.asOf))) {
    const cur = base.get(s.accountId);
    if (!cur) base.set(s.accountId, s);
    else if (s.asOf <= from) base.set(s.accountId, s);
  }

  const totals = dates.map(() => 0);
  for (const [accountId, snap] of base) {
    const events = entries
      .filter((e) => e.accountId === accountId)
      .map((e) => ({
        date: cashDate(e, today),
        open: e.status === "open",
        cents: (e.direction === "in" ? 1 : -1) * effectiveCents(e),
      }))
      .filter((x): x is { date: string; open: boolean; cents: number } => x.date !== null);

    dates.forEach((d, i) => {
      let c = toCents(snap.balance);
      for (const ev of events) {
        // Em aberto nunca faz parte de um saldo informado: conta assim que o dia chega.
        if (ev.open) {
          if (ev.date <= d) c += ev.cents;
        } else if (ev.date > snap.asOf && ev.date <= d) c += ev.cents;
        else if (ev.date <= snap.asOf && ev.date > d) c -= ev.cents; // dias antes do snapshot
      }
      totals[i] += c;
    });
  }
  return dates.map((date, i) => ({ date, balance: fromCents(totals[i]) }));
}

export function monthlyProjection(entries: EntryLite[], months: string[], today: string): MonthRow[] {
  const currentMonth = `${today.slice(0, 7)}-01`;
  return months.map((month) => {
    const realized = month < currentMonth;
    let grossIn = 0, retention = 0, netIn = 0, fixed = 0, variable = 0, nonRecurring = 0;
    for (const e of entries) {
      if (e.status === "cancelled") continue;
      if (e.competence.slice(0, 7) !== month.slice(0, 7)) continue;
      if (e.status === "open" && realized) continue;
      if (e.direction === "in") {
        grossIn += toCents(e.gross);
        retention += toCents(e.retention);
        netIn += effectiveCents(e);
      } else {
        const c = effectiveCents(e);
        if (e.nature === "fixed") fixed += c;
        else if (e.nature === "non_recurring") nonRecurring += c;
        else variable += c; // sem natureza cai em variável
      }
    }
    return {
      month,
      grossIn: fromCents(grossIn),
      retention: fromCents(retention),
      netIn: fromCents(netIn),
      fixed: fromCents(fixed),
      variable: fromCents(variable),
      nonRecurring: fromCents(nonRecurring),
      result: fromCents(netIn - fixed - variable - nonRecurring),
      realized,
    };
  });
}

export function shareBy(
  entries: EntryLite[],
  key: "organizationId" | "serviceCategoryId" | "expenseCategoryId",
): { key: string | null; amount: number; share: number }[] {
  const sums = new Map<string | null, number>();
  for (const e of entries) {
    if (e.status === "cancelled") continue;
    sums.set(e[key], (sums.get(e[key]) ?? 0) + effectiveCents(e));
  }
  const total = [...sums.values()].reduce((a, b) => a + b, 0);
  return [...sums.entries()]
    .map(([k, c]) => ({ key: k, amount: fromCents(c), share: total > 0 ? c / total : 0 }))
    .sort((a, b) => b.amount - a.amount);
}

export function breakEven(fixed: number, variable: number, revenue: number): number | null {
  if (revenue <= 0 || variable >= revenue) return null;
  return Math.round((fixed / (1 - variable / revenue)) * 100) / 100;
}

export function coverageMonths(balance: number, avgMonthlyFixed: number): number | null {
  if (avgMonthlyFixed <= 0) return null;
  return balance / avgMonthlyFixed;
}
