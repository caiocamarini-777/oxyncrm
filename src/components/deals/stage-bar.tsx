"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { RequiredFieldsDialog } from "@/components/deals/required-fields-dialog";
import type { CustomFieldDef } from "@/lib/custom-fields/schema";
import { getDealEditSnapshot, moveDeal, type DealEditSnapshot } from "@/lib/deals/actions";
import { endPosition } from "@/lib/deals/kanban";
import type { AssignableOwner } from "@/lib/records/types";
import { cn } from "@/lib/utils";

export type StageBarStage = { id: string; name: string };

function daysText(days: number): string {
  if (days <= 0) return "Entrou nesta etapa hoje";
  return `Há ${days} ${days === 1 ? "dia" : "dias"} nesta etapa`;
}

/** Barra de etapas do funil: atual em teal, anteriores em teal claro; clicar move o negócio. */
export function StageBar({
  dealId,
  companyId,
  dealHref,
  stages,
  currentStageId,
  daysInStage,
  canMove,
  defs,
  owners,
}: {
  dealId: string;
  companyId: string;
  dealHref: string;
  /** Etapas não arquivadas do funil, na ordem (a atual sempre está na lista). */
  stages: StageBarStage[];
  currentStageId: string;
  daysInStage: number;
  /** Só negócios abertos, com permissão de edição. */
  canMove: boolean;
  defs: CustomFieldDef[];
  owners: AssignableOwner[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [dialog, setDialog] = useState<{ snapshot: DealEditSnapshot; stage: StageBarStage; missing: string[] } | null>(null);
  const currentIndex = stages.findIndex((s) => s.id === currentStageId);

  const move = (stageId: string) => moveDeal(dealId, stageId, endPosition());

  function go(stage: StageBarStage) {
    if (!canMove || pending || stage.id === currentStageId) return;
    start(async () => {
      const res = await move(stage.id);
      if (res.ok) {
        router.refresh();
        return;
      }
      if (res.missing && res.missing.length > 0) {
        const snap = await getDealEditSnapshot(dealId);
        if (!snap.ok) {
          toast.error(snap.error);
          return;
        }
        setDialog({ snapshot: snap.data, stage, missing: res.missing });
        return;
      }
      toast.error(res.error);
    });
  }

  return (
    <div className="flex flex-col gap-1.5">
      <ol aria-label="Etapas do funil" className="flex gap-1 overflow-x-auto">
        {stages.map((s, i) => {
          const current = s.id === currentStageId;
          const past = currentIndex >= 0 && i < currentIndex;
          return (
            <li key={s.id} className="min-w-24 flex-1">
              <button
                type="button"
                data-testid="stage-segment"
                data-state={current ? "current" : past ? "past" : "future"}
                aria-current={current ? "step" : undefined}
                disabled={!canMove || pending}
                onClick={() => go(s)}
                className={cn(
                  "h-9 w-full truncate px-3 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-default",
                  "[clip-path:polygon(0_0,calc(100%-10px)_0,100%_50%,calc(100%-10px)_100%,0_100%,10px_50%)] first:[clip-path:polygon(0_0,calc(100%-10px)_0,100%_50%,calc(100%-10px)_100%,0_100%)]",
                  current
                    ? "bg-primary text-primary-foreground"
                    : past
                      ? "bg-primary/25 text-foreground enabled:hover:bg-primary/35"
                      : "bg-muted text-muted-foreground enabled:hover:bg-muted/70",
                )}
              >
                {s.name}
              </button>
            </li>
          );
        })}
      </ol>
      <p data-testid="stage-days" className="text-xs text-muted-foreground">
        {daysText(daysInStage)}
      </p>
      {dialog ? (
        <RequiredFieldsDialog
          deal={dialog.snapshot}
          stageName={dialog.stage.name}
          missing={dialog.missing}
          companyId={companyId}
          dealHref={dealHref}
          defs={defs}
          owners={owners}
          onRetry={() => move(dialog.stage.id)}
          onClose={() => {
            setDialog(null);
            router.refresh();
          }}
        />
      ) : null}
    </div>
  );
}
