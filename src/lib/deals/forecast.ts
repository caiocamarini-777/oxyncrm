export type ForecastDeal = {
  status: string;
  /** "YYYY-MM-DD" */
  expectedCloseDate: string | null;
  value: number;
  /** 0 a 100, da etapa. */
  probability: number;
};

export type ForecastBucket<D> = {
  key: string;
  label: string;
  count: number;
  total: number;
  weighted: number;
  deals: D[];
};

const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

/** Mês atual "YYYY-MM" em America/Sao_Paulo (UTC-3). */
export function currentMonth(now: Date): string {
  const d = new Date(now.getTime() - 3 * 3600_000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Colunas: "Atrasados" (data antes do mês atual), um bucket por mês a partir do atual e "Sem data".
 * Só negócios abertos; datas além da janela ficam de fora.
 */
export function forecastBuckets<D extends ForecastDeal>(deals: D[], now: Date, months = 6): ForecastBucket<D>[] {
  const cur = currentMonth(now);
  const [cy, cm] = cur.split("-").map(Number);
  const buckets: ForecastBucket<D>[] = [{ key: "overdue", label: "Atrasados", count: 0, total: 0, weighted: 0, deals: [] }];
  for (let i = 0; i < months; i++) {
    const idx = cy * 12 + (cm - 1) + i;
    const y = Math.floor(idx / 12);
    const m = (idx % 12) + 1;
    buckets.push({
      key: `${y}-${String(m).padStart(2, "0")}`,
      label: `${MONTHS[m - 1]}/${y}`,
      count: 0, total: 0, weighted: 0, deals: [],
    });
  }
  buckets.push({ key: "none", label: "Sem data", count: 0, total: 0, weighted: 0, deals: [] });
  const byKey = new Map(buckets.map((b) => [b.key, b]));
  for (const d of deals) {
    if (d.status !== "open") continue;
    const ym = d.expectedCloseDate ? d.expectedCloseDate.slice(0, 7) : null;
    const key = ym === null ? "none" : ym < cur ? "overdue" : ym;
    const b = byKey.get(key);
    if (!b) continue;
    b.count += 1;
    b.total = round2(b.total + d.value);
    b.weighted = round2(b.weighted + (d.value * d.probability) / 100);
    b.deals.push(d);
  }
  return buckets;
}
