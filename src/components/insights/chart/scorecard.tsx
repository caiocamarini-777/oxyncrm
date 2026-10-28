import { ArrowDown, ArrowUp } from "lucide-react";
import { delta } from "@/lib/insights/chart-shape";
import { formatMeasure, formatPercent } from "@/lib/insights/format";
import type { InsightResult } from "@/lib/insights/types";

/** Cartão de número do Pipedrive: variação em relação ao período anterior, o total e o nome da medida. */
export function Scorecard({ result, compact }: { result: InsightResult; compact?: boolean }) {
  const d = delta(Number(result.total ?? 0), result.previous ?? null);
  const type = result.measure.type;
  const up = d ? d.abs >= 0 : true;
  return (
    <div className={`flex flex-col items-center justify-center gap-1 text-center ${compact ? "h-full" : "py-12"}`}>
      {d ? (
        <p className={`flex items-center gap-1 text-xs font-medium ${up ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400"}`}>
          {up ? <ArrowUp className="size-3.5" aria-hidden /> : <ArrowDown className="size-3.5" aria-hidden />}
          <span>
            {up ? "+" : ""}
            {formatMeasure(d.abs, type)}
            {d.pct !== null ? ` (${formatPercent(d.pct)})` : ""}
          </span>
          <span className="sr-only">em relação ao período anterior</span>
        </p>
      ) : null}
      <p className={`font-heading font-semibold tabular-nums ${compact ? "text-4xl" : "text-6xl"}`}>
        {formatMeasure(Number(result.total ?? 0), type, { compact: type === "currency" })}
      </p>
      <p className="text-sm text-muted-foreground">{result.measure.label}</p>
    </div>
  );
}
