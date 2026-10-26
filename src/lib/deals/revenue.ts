export type ContractLike = {
  setupTotal: number;
  setupInstallments: number | null;
  /** "YYYY-MM" */
  setupFirstDue: string | null;
  mrr: number;
  mrrStart: string | null;
  contractMonths: number | null;
};

export type ScheduleRow = { month: string; setup: number; mrr: number };

function addMonths(ym: string, n: number): string {
  const [y, m] = ym.split("-").map(Number);
  const idx = y * 12 + (m - 1) + n;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}`;
}

/** Espelho de `build_revenue_schedule` (banco): trabalha em centavos para evitar erro de ponto flutuante. */
export function buildRevenueSchedule(input: ContractLike): ScheduleRow[] {
  const rows = new Map<string, ScheduleRow>();
  const at = (m: string) => {
    let r = rows.get(m);
    if (!r) rows.set(m, (r = { month: m, setup: 0, mrr: 0 }));
    return r;
  };
  const setupCents = Math.round((input.setupTotal ?? 0) * 100);
  if (setupCents > 0 && input.setupFirstDue) {
    const n = Math.max(input.setupInstallments ?? 1, 1);
    const per = Math.floor(setupCents / n);
    for (let i = 0; i < n; i++) {
      const cents = i < n - 1 ? per : setupCents - per * (n - 1);
      at(addMonths(input.setupFirstDue, i)).setup = cents / 100;
    }
  }
  if ((input.mrr ?? 0) > 0 && input.mrrStart) {
    for (let i = 0; i < (input.contractMonths ?? 0); i++) at(addMonths(input.mrrStart, i)).mrr = input.mrr;
  }
  return [...rows.values()].sort((a, b) => a.month.localeCompare(b.month));
}

/** Mesma fórmula da coluna gerada `contract_value`. */
export function contractValue(input: Pick<ContractLike, "setupTotal" | "mrr" | "contractMonths"> & Partial<ContractLike>): number {
  return Math.round((input.setupTotal + input.mrr * (input.contractMonths ?? 0)) * 100) / 100;
}
