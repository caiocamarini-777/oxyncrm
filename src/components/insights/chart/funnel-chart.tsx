import { formatMeasure, formatPercent } from "@/lib/insights/format";
import { resolveColor, type ColorContext } from "@/lib/insights/palette";
import type { InsightResult } from "@/lib/insights/types";

/**
 * Conversão etapa a etapa: uma coluna por etapa com quantos chegaram, a conversão para a etapa seguinte entre as
 * colunas e, no fim, os ganhos. No topo, a taxa de ganho (ganhos / os que entraram na primeira etapa).
 */
export function FunnelChart({ result, colors, compact }: { result: InsightResult; colors: ColorContext; compact?: boolean }) {
  const type = result.measure.type;
  const totals = (result.totals ?? []).map(Number);
  const max = Math.max(1, ...totals);
  const first = totals[0] ?? 0;
  const won = Number(result.won ?? totals[totals.length - 1] ?? 0);
  const reached = resolveColor("funnel", "reached", 0, colors);
  const wonColor = resolveColor("funnel", "won", 1, colors);
  return (
    <div className={`flex flex-col gap-3 ${compact ? "h-full min-h-0" : ""}`}>
      <p className="text-sm font-medium">Taxa de ganho é {formatPercent(first ? won / first : 0)}</p>
      <div className={`flex min-h-0 items-end gap-1 overflow-x-auto pb-1 ${compact ? "flex-1" : "h-72"}`}>
        {result.x.map((p, i) => {
          const v = totals[i] ?? 0;
          const isWon = p.key === "won";
          const next = totals[i + 1];
          return (
            <div key={p.key} className="flex h-full min-w-16 flex-1 items-end gap-1">
              <div className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1">
                <span className="text-xs tabular-nums">{formatMeasure(v, type, { compact: true })}</span>
                <div
                  className="w-full rounded-t"
                  style={{ height: `${Math.max(2, (v / max) * 100)}%`, background: isWon ? wonColor : reached }}
                  title={`${p.label}: ${formatMeasure(v, type)}`}
                />
                <span className="w-full truncate text-center text-[11px] text-muted-foreground" title={p.label}>
                  {p.label}
                </span>
              </div>
              {next !== undefined ? (
                <span className="mb-10 shrink-0 rounded bg-muted px-1 py-0.5 text-[10px] tabular-nums text-muted-foreground">
                  {formatPercent(v ? next / v : 0)}
                </span>
              ) : null}
            </div>
          );
        })}
      </div>
      <ul className="flex gap-3 text-xs text-muted-foreground">
        <li className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm" style={{ background: reached }} aria-hidden /> Chegou à etapa
        </li>
        <li className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm" style={{ background: wonColor }} aria-hidden /> Ganho
        </li>
      </ul>
    </div>
  );
}
