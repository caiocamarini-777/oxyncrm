/** Transforma o retorno do motor nas linhas e séries dos gráficos (ordem, acumulado, páginas e cores). */
import type { SortKey } from "./meta";
import { resolveColor, type ColorContext } from "./palette";
import type { InsightDefinition, InsightResult } from "./types";

export const VALUE_KEY = "__value";
const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

export type Series = { key: string; label: string; color: string };
export type ChartRow = { key: string; label: string; values: Record<string, number>; total: number };
export type ShapedChart = { rows: ChartRow[]; series: Series[]; pageCount: number; segmented: boolean };

/** Campo usado para as cores dos segmentos (status, done...). */
export function segmentColorField(result: InsightResult, def: InsightDefinition): string {
  if (def.report_type === "funnel_conversion") return "funnel";
  if (def.data_type === "leads" && def.report_type === "conversion") return "conversion";
  return result.segment_field?.id ?? "";
}

/** Rótulo do eixo X: datas pelo intervalo ("out 2026", "T4 2026"); o resto como veio. */
export function formatXLabel(key: string, label: string, interval: string | null | undefined): string {
  if (!interval || !/^\d{4}-\d{2}-\d{2}$/.test(key)) return label;
  const [y, m, d] = key.split("-").map(Number) as [number, number, number];
  switch (interval) {
    case "day":
      return `${d} ${MONTHS[m - 1]} ${y}`;
    case "week":
      return `${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}/${y}`;
    case "quarter":
      return `T${Math.floor((m - 1) / 3) + 1} ${y}`;
    case "year":
      return String(y);
    default:
      return `${MONTHS[m - 1]} ${y}`;
  }
}

export function accumulate(values: number[]): number[] {
  let acc = 0;
  return values.map((v) => (acc += v));
}

/** Variação do total em relação ao anterior. pct null quando o anterior é zero (ou não existe). */
export function delta(total: number | null | undefined, previous: number | null | undefined) {
  if (total == null || previous == null) return null;
  const abs = total - previous;
  return { abs, pct: previous === 0 ? null : abs / previous };
}

export function shapeChart(
  result: InsightResult,
  def: InsightDefinition,
  ctx: ColorContext,
  opts: { sort?: SortKey; page?: number; pageSize?: number | null } = {},
): ShapedChart {
  const segmented = result.segments.length > 0;
  const field = segmentColorField(result, def);
  const series: Series[] = segmented
    ? result.segments.map((s, i) => ({ key: s.key, label: s.label, color: resolveColor(field, s.key, i, ctx) }))
    : [{ key: VALUE_KEY, label: result.measure.label, color: resolveColor("", VALUE_KEY, 0, ctx) }];

  const interval = result.x_field?.interval ?? null;
  let rows: ChartRow[] = result.x.map((p, i) => {
    const vals = result.values[i] ?? [];
    const values: Record<string, number> = {};
    series.forEach((s, j) => (values[s.key] = Number(vals[j] ?? 0)));
    const total = result.totals?.[i] ?? Object.values(values).reduce((a, b) => a + b, 0);
    return { key: p.key, label: formatXLabel(p.key, p.label, interval), values, total: Number(total) };
  });

  if (def.parameters.is_cumulative) {
    for (const s of series) {
      const acc = accumulate(rows.map((r) => r.values[s.key] ?? 0));
      rows = rows.map((r, i) => ({ ...r, values: { ...r.values, [s.key]: acc[i]! } }));
    }
    const accT = accumulate(rows.map((r) => r.total));
    rows = rows.map((r, i) => ({ ...r, total: accT[i]! }));
  }

  const sort = opts.sort ?? "default";
  if (sort === "value_desc") rows = [...rows].sort((a, b) => b.total - a.total);
  else if (sort === "value_asc") rows = [...rows].sort((a, b) => a.total - b.total);
  else if (sort === "name") rows = [...rows].sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));

  const size = opts.pageSize && opts.pageSize > 0 ? opts.pageSize : null;
  const pageCount = size ? Math.max(1, Math.ceil(rows.length / size)) : 1;
  if (size) {
    const page = Math.min(Math.max(opts.page ?? 0, 0), pageCount - 1);
    rows = rows.slice(page * size, page * size + size);
  }
  return { rows, series, pageCount, segmented };
}

/** Cor de cada fatia da pizza (cor por valor do eixo X). */
export function pointColors(result: InsightResult, ctx: ColorContext): Record<string, string> {
  const field = result.x_field?.id ?? "";
  return Object.fromEntries(result.x.map((p, i) => [p.key, resolveColor(field, p.key, i, ctx)]));
}

/** Gráfico sem nada para mostrar (o número sempre mostra, mesmo zero). */
export function isEmptyResult(result: InsightResult | null | undefined, chart: InsightDefinition["chart_type"]): boolean {
  if (!result) return true;
  if (chart === "scorecard") return false;
  return result.x.length === 0 || result.values.every((row) => row.every((v) => !Number(v)));
}
