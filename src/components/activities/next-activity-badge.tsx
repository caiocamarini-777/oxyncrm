import { Clock } from "lucide-react";
import { cn } from "cn";
import type { NextActivity } from "@/lib/activities/next";

/** Relógio: vermelho neutro se atrasada, cinza sem atividade aberta, data curta nos demais casos. */
export function NextActivityBadge({ next, className }: { next: NextActivity | null; className?: string }) {
  const overdue = next?.status === "overdue";
  const label = next ? next.label : "Sem atividade";
  return (
    <span
      data-testid="next-activity"
      data-status={next ? next.status : "none"}
      title={next ? next.subject : undefined}
      aria-label={next ? `Próxima atividade: ${label}. ${next.subject}` : "Sem atividade aberta"}
      className={cn(
        "inline-flex items-center gap-1 text-xs",
        overdue ? "font-medium text-red-700 dark:text-red-400" : "text-muted-foreground",
        className,
      )}
    >
      <Clock className="size-3.5" aria-hidden />
      {label}
    </span>
  );
}
