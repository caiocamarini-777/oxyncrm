import { formatCell, type CellType } from "./format";
import type { Chart, ReportResult, ResultColumn } from "./spec";

export const EMPTY_TEXT = "Sem dados no período";
export const TRUNCATED_TEXT = "Mostrando os primeiros 500 resultados.";

const NUMERIC: CellType[] = ["number", "currency", "percent", "days"];
export const isNumeric = (c: ResultColumn) => NUMERIC.includes(c.type);
const toNum = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** Divide as colunas em categoria (a primeira não numérica) e séries (as numéricas). */
export function shape(result: ReportResult) {
  const catIdx = result.columns.findIndex((c) => !isNumeric(c));
  const series = result.columns
    .map((col, idx) => ({ col, idx }))
    .filter(({ col, idx }) => isNumeric(col) && idx !== catIdx);
  const cat = catIdx >= 0 ? result.columns[catIdx] : null;
  const data = result.rows.map((row, i) => {
    const rec: Record<string, unknown> = {
      __cat: cat ? formatCell(row[catIdx], cat.type) : String(i + 1),
    };
    for (const { col, idx } of series) rec[col.key] = toNum(row[idx]);
    return rec;
  });
  return { cat, series, data, catIdx };
}

export function summarize(result: ReportResult, chart: Chart): string {
  if (result.rows.length === 0) return EMPTY_TEXT;
  const { series, data } = shape(result);
  const first = series[0];
  if (chart === "number" && first) {
    return `${first.col.label}: ${formatCell(result.rows[0]?.[first.idx], first.col.type)}`;
  }
  if (!first) return `${result.rows.length} linhas`;
  let best = data[0]!;
  for (const d of data) if ((d[first.col.key] as number) > (best[first.col.key] as number)) best = d;
  return `${data.length} itens. Maior: ${String(best.__cat)} com ${formatCell(best[first.col.key], first.col.type)} em ${first.col.label}.`;
}

