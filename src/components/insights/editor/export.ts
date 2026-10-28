import type { ShapedChart } from "@/lib/insights/chart-shape";
import type { InsightResult, RecordsResult } from "@/lib/insights/types";

function slug(name: string) {
  return name.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase() || "relatorio";
}

function cell(v: unknown): string {
  const s = v == null ? "" : String(v);
  return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function download(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** CSV (separado por ponto e vírgula, para o Excel em pt-BR) da tabela do gráfico. */
export function exportChartCsv(name: string, result: InsightResult, shaped: ShapedChart) {
  const head = [result.x_field?.label ?? "", ...(shaped.segmented ? shaped.series.map((s) => s.label) : []), "Total"];
  const lines = shaped.rows.map((r) => [r.label, ...(shaped.segmented ? shaped.series.map((s) => r.values[s.key] ?? 0) : []), r.total]);
  const csv = [head, ...lines].map((l) => l.map(cell).join(";")).join("\n");
  download(`${slug(name)}.csv`, new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8" }));
}

export function exportRecordsCsv(name: string, records: RecordsResult) {
  const head = records.columns.map((c) => c.label);
  const lines = records.rows.map((r) => r.slice(1));
  const csv = [head, ...lines].map((l) => l.map(cell).join(";")).join("\n");
  download(`${slug(name)}-registros.csv`, new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8" }));
}

export async function exportPng(node: HTMLElement, name: string) {
  const { toPng } = await import("html-to-image");
  const bg = getComputedStyle(document.body).backgroundColor;
  const url = await toPng(node, { pixelRatio: 2, backgroundColor: bg, cacheBust: true });
  const a = document.createElement("a");
  a.href = url;
  a.download = `${slug(name)}.png`;
  a.click();
}
