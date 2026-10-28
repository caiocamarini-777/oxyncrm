/** Intervalo de um período (mesma regra de insights_period_bounds): dias em São Paulo, semana de domingo a sábado. */
import type { InsightFilter, PeriodKey } from "./types";

const iso = (d: Date) => d.toISOString().slice(0, 10);
const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d));

/** Hoje em São Paulo, como data UTC à meia-noite. */
export function spToday(now = new Date()): Date {
  const s = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(now);
  const [y, m, d] = s.split("-").map(Number) as [number, number, number];
  return utc(y, m - 1, d);
}

export function periodBounds(period: PeriodKey, now = new Date(), custom?: { from?: string; to?: string }): { from: string | null; to: string | null } {
  const t = spToday(now);
  const y = t.getUTCFullYear();
  const m = t.getUTCMonth();
  const day = t.getUTCDate();
  const dow = t.getUTCDay();
  const addDays = (n: number) => utc(y, m, day + n);
  const month = (k: number) => [utc(y, m + k, 1), utc(y, m + k + 1, 0)] as const;
  const q = Math.floor(m / 3) * 3;
  const quarter = (k: number) => [utc(y, q + 3 * k, 1), utc(y, q + 3 * k + 3, 0)] as const;
  const year = (k: number) => [utc(y + k, 0, 1), utc(y + k, 11, 31)] as const;
  const week = (k: number) => [addDays(-dow + 7 * k), addDays(-dow + 7 * k + 6)] as const;
  let r: readonly [Date, Date] | null = null;
  switch (period) {
    case "today": r = [t, t]; break;
    case "yesterday": r = [addDays(-1), addDays(-1)]; break;
    case "tomorrow": r = [addDays(1), addDays(1)]; break;
    case "week": r = week(0); break;
    case "lastWeek": r = week(-1); break;
    case "nextWeek": r = week(1); break;
    case "month": r = month(0); break;
    case "lastMonth": r = month(-1); break;
    case "nextMonth": r = month(1); break;
    case "quarter": r = quarter(0); break;
    case "lastQuarter": r = quarter(-1); break;
    case "nextQuarter": r = quarter(1); break;
    case "year": r = year(0); break;
    case "lastYear": r = year(-1); break;
    case "nextYear": r = year(1); break;
    case "last7Days": r = [addDays(-6), t]; break;
    case "last30Days": r = [addDays(-29), t]; break;
    case "last90Days": r = [addDays(-89), t]; break;
    case "custom": return { from: custom?.from ?? null, to: custom?.to ?? null };
  }
  return r ? { from: iso(r[0]), to: iso(r[1]) } : { from: null, to: null };
}

/** Datas do filtro personalizado (operandos isMoreThan / isLessThan). */
export function customRange(f: InsightFilter): { from?: string; to?: string } {
  const from = f.operands.find((o) => o.name === "isMoreThan")?.defaultValue;
  const to = f.operands.find((o) => o.name === "isLessThan")?.defaultValue;
  return { from: typeof from === "string" ? from.slice(0, 10) : undefined, to: typeof to === "string" ? to.slice(0, 10) : undefined };
}

export function formatDay(isoDay: string | null | undefined): string {
  if (!isoDay) return "";
  const [y, m, d] = isoDay.split("-");
  return `${d}/${m}/${y}`;
}
