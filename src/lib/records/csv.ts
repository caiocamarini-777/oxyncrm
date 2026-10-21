function cell(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[";\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV para Excel BR: separador `;`, BOM UTF-8, linhas CRLF. */
export function toCsv(
  columns: { key: string; header: string }[],
  rows: Record<string, unknown>[],
): string {
  const lines = [columns.map((c) => cell(c.header)).join(";")];
  for (const row of rows) lines.push(columns.map((c) => cell(row[c.key])).join(";"));
  return "﻿" + lines.join("\r\n");
}
