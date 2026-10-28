/** Formatação de valores dos gráficos e da lista (pt-BR). */
import type { MeasureType } from "./types";

const int = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
const dec = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });
const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const pct = new Intl.NumberFormat("pt-BR", { style: "percent", maximumFractionDigits: 2 });

/** Número compacto: 915 mil, 1,2 mi. */
export function compact(n: number): string {
  const a = Math.abs(n);
  if (a >= 1_000_000) return `${dec.format(n / 1_000_000)} mi`;
  if (a >= 10_000) return `${int.format(n / 1_000)} mil`;
  return dec.format(n);
}

export function formatMeasure(v: number | null | undefined, type: MeasureType, opts: { compact?: boolean } = {}): string {
  if (v == null || Number.isNaN(Number(v))) return "-";
  const n = Number(v);
  if (type === "currency") return opts.compact && Math.abs(n) >= 10_000 ? `R$ ${compact(n)}` : brl.format(n);
  if (type === "days") return `${dec.format(n)} ${Math.abs(n) === 1 ? "dia" : "dias"}`;
  return opts.compact ? compact(n) : Number.isInteger(n) ? int.format(n) : dec.format(n);
}

export function formatPercent(p: number | null | undefined): string {
  return p == null ? "" : pct.format(p);
}

const DATE = new Intl.DateTimeFormat("pt-BR", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const DATETIME = new Intl.DateTimeFormat("pt-BR", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" });

/** Célula da lista de registros. Datas chegam como "AAAA-MM-DD" ou "AAAA-MM-DDTHH:MI" (já no horário de SP). */
export function formatCell(v: unknown, type: string): string {
  if (v == null || v === "") return "";
  if (type === "currency") return brl.format(Number(v));
  if (type === "number") return formatMeasure(Number(v), "number");
  if (type === "date" && typeof v === "string") return DATE.format(new Date(`${v.slice(0, 10)}T00:00:00Z`));
  if (type === "datetime" && typeof v === "string") return DATETIME.format(new Date(`${v}:00Z`));
  return String(v);
}
