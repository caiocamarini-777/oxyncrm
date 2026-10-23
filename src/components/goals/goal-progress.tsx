import { formatCell, type CellType } from "@/lib/reports/format";
import type { ReportResult } from "@/lib/reports/spec";

/** Preenchimento normal: #6498A8 tem 3:1 ou mais contra a trilha (branca no claro, #111D17 no escuro). */
const TEAL = "#6498A8";
const TEAL_DARK = "#1A82A2";

/** Valor ganho e MRR ganho são moeda; as demais métricas são contagens. */
export const goalValueType = (metric: string): CellType =>
  metric === "won_value" || metric === "won_mrr" ? "currency" : "number";

const GOAL_COLUMNS = ["goal", "target", "actual", "percent", "period_start", "period_end", "metric"];

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

/** Lista de barras para o resultado do preset goal_progress (colunas goal, target, actual, percent, period_*). */
export function GoalProgressList({ result }: { result: ReportResult }) {
  const idx = (key: string) => result.columns.findIndex((c) => c.key === key);
  const [g, t, a, p, s, e, m] = GOAL_COLUMNS.map(idx);
  return (
    <ul className="space-y-4">
      {result.rows.map((row, i) => {
        const label = String(row[g!] ?? "");
        return (
          <li key={i}>
            <GoalProgress
              label={label}
              type={goalValueType(String(row[m!] ?? ""))}
              target={Number(row[t!] ?? 0)}
              actual={Number(row[a!] ?? 0)}
              percent={Number(row[p!] ?? 0)}
              periodStart={String(row[s!] ?? "")}
              periodEnd={String(row[e!] ?? "")}
            />
          </li>
        );
      })}
    </ul>
  );
}

export const isGoalProgressResult = (result: ReportResult): boolean =>
  GOAL_COLUMNS.every((k) => result.columns.some((c) => c.key === k));
