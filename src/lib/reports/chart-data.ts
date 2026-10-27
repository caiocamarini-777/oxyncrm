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

export type Shape = {
  cat: ResultColumn | null;
  series: { col: ResultColumn; idx: number }[];
  data: Record<string, unknown>[];
  catIdx: number;
  /** Segmentado (linhas [grupo, segmento, valor]): as séries são os segmentos. */
  segmented: boolean;
};

const isSegment = (c: ResultColumn) => c.key.startsWith("segment:");

/**
 * Divide as colunas em categoria (a primeira não numérica) e séries (as numéricas). Com segmento, gira as linhas:
 * uma série por segmento (na ordem em que aparecem) e um registro por grupo.
 */
export function shape(result: ReportResult): Shape {
  const segIdx = result.columns.findIndex(isSegment);
  if (segIdx > 0) {
    const cat = result.columns[0]!;
    const valIdx = result.columns.findIndex((c, i) => i !== segIdx && isNumeric(c));
    const valCol = result.columns[valIdx];
    const segNames: string[] = [];
    const byCat = new Map<string, Record<string, unknown>>();
    for (const row of result.rows) {
      const c = formatCell(row[0], cat.type);
      const sname = formatCell(row[segIdx], result.columns[segIdx]!.type);
      if (!segNames.includes(sname)) segNames.push(sname);
      const rec = byCat.get(c) ?? { __cat: c };
      rec[`s:${sname}`] = toNum(rec[`s:${sname}`]) + toNum(row[valIdx]);
      byCat.set(c, rec);
    }
    const series = segNames.map((n) => ({ col: { key: `s:${n}`, label: n, type: valCol?.type ?? "number" } as ResultColumn, idx: valIdx }));
    const data = [...byCat.values()].map((rec) => {
      for (const s of series) rec[s.col.key] = toNum(rec[s.col.key]);
      return rec;
    });
    return { cat, series, data, catIdx: 0, segmented: true };
  }
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
  return { cat, series, data, catIdx, segmented: false };
}

/** Soma acumulada por série, na ordem das categorias (previsão de receita do Pipedrive). */
export function accumulate(s: Shape): Shape {
  const run: Record<string, number> = {};
  const data = s.data.map((rec) => {
    const out = { ...rec };
    for (const { col } of s.series) {
      run[col.key] = (run[col.key] ?? 0) + toNum(rec[col.key]);
      out[col.key] = run[col.key];
    }
    return out;
  });
  return { ...s, data };
}

/** Variação do cartão de número contra o período anterior; null sem comparação. */
export function delta(current: unknown, previous: number | null | undefined): { diff: number; pct: number | null } | null {
  if (previous === null || previous === undefined) return null;
  const cur = toNum(current);
  const diff = cur - previous;
  return { diff, pct: previous === 0 ? null : (diff / previous) * 100 };
}

export function summarize(result: ReportResult, chart: Chart): string {
  if (result.rows.length === 0) return EMPTY_TEXT;
  const { series, data } = shape(result);
  const first = series[0];
  if (chart === "list") return `${result.rows.length} registros`;
  if (chart === "number" && first) {
    return `${first.col.label}: ${formatCell(result.rows[0]?.[first.idx], first.col.type)}`;
  }
  if (!first) return `${result.rows.length} linhas`;
  let best = data[0]!;
  for (const d of data) if ((d[first.col.key] as number) > (best[first.col.key] as number)) best = d;
  return `${data.length} itens. Maior: ${String(best.__cat)} com ${formatCell(best[first.col.key], first.col.type)} em ${first.col.label}.`;
}

