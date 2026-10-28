import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { ShapedChart } from "@/lib/insights/chart-shape";
import { formatMeasure } from "@/lib/insights/format";
import type { InsightResult } from "@/lib/insights/types";

/** Tabela dinâmica: linhas do eixo X, colunas por segmento e o total (gráfico "tabela" e aba "Resumo"). */
export function PivotTable({ result, shaped, compact }: { result: InsightResult; shaped: ShapedChart; compact?: boolean }) {
  const type = result.measure.type;
  const cols = shaped.segmented ? shaped.series : [];
  const totals = cols.map((s) => shaped.rows.reduce((a, r) => a + (r.values[s.key] ?? 0), 0));
  return (
    <div className={`overflow-auto rounded-md border ${compact ? "h-full" : "max-h-[28rem]"}`}>
      <Table>
        <TableHeader className="sticky top-0 bg-background">
          <TableRow>
            <TableHead>{result.x_field?.label ?? ""}</TableHead>
            {cols.map((s) => (
              <TableHead key={s.key} className="text-right">
                <span className="inline-flex items-center gap-1.5">
                  <span className="size-2 rounded-sm" style={{ background: s.color }} aria-hidden />
                  {s.label}
                </span>
              </TableHead>
            ))}
            <TableHead className="text-right">{cols.length ? "Total" : result.measure.label}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {shaped.rows.map((r) => (
            <TableRow key={r.key}>
              <TableCell className="max-w-64 truncate" title={r.label}>
                {r.label}
              </TableCell>
              {cols.map((s) => (
                <TableCell key={s.key} className="text-right tabular-nums">
                  {formatMeasure(r.values[s.key] ?? 0, type)}
                </TableCell>
              ))}
              <TableCell className="text-right font-medium tabular-nums">{formatMeasure(r.total, type)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
        <TableFooter>
          <TableRow>
            <TableCell>Total</TableCell>
            {totals.map((t, i) => (
              <TableCell key={cols[i]!.key} className="text-right tabular-nums">
                {formatMeasure(t, type)}
              </TableCell>
            ))}
            <TableCell className="text-right font-semibold tabular-nums">{formatMeasure(Number(result.total ?? 0), type)}</TableCell>
          </TableRow>
        </TableFooter>
      </Table>
    </div>
  );
}
