import { formatCell, type CellType } from "@/lib/reports/format";

/** Preenchimento normal: #6498A8 tem 3:1 ou mais contra a trilha (branca no claro, #111D17 no escuro). */
const TEAL = "#6498A8";
const TEAL_DARK = "#1A82A2";

/** Valor ganho e MRR ganho são moeda; as demais métricas são contagens. */
export const goalValueType = (metric: string): CellType =>
  metric === "won_value" || metric === "won_mrr" ? "currency" : "number";

export type GoalProgressProps = {
  label: string;
  /** Rótulo secundário (por exemplo, o nome da empresa). */
  caption?: string;
  type: CellType;
  target: number;
  actual: number;
  percent: number;
  periodStart: string;
  periodEnd: string;
};

/** Barra de progresso de uma meta: teal, em teal escuro (#1A82A2) a partir de 100%. */
export function GoalProgress({ label, caption, type, target, actual, percent, periodStart, periodEnd }: GoalProgressProps) {
  const done = percent >= 100;
  const width = Math.min(Math.max(percent, 0), 100);
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <p className="min-w-0 truncate text-sm font-medium" title={label}>
          {label}
          {caption ? <span className="ml-2 font-normal text-muted-foreground">{caption}</span> : null}
        </p>
        <p className="shrink-0 text-sm font-semibold tabular-nums">{formatCell(percent, "percent")}</p>
      </div>
      <div
        role="progressbar"
        aria-label={`Progresso de ${label}`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(width)}
        className="h-2.5 overflow-hidden rounded-full bg-white ring-1 ring-border dark:bg-[#111D17]"
      >
        <div className="h-full rounded-full" style={{ width: `${width}%`, background: done ? TEAL_DARK : TEAL }} />
      </div>
      <p className="text-xs text-muted-foreground">
        Realizado {formatCell(actual, type)} de {formatCell(target, type)}. Período de {formatCell(periodStart, "date")} a{" "}
        {formatCell(periodEnd, "date")}.
      </p>
    </div>
  );
}
