"use client";

import { useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { motion, useAnimate } from "motion/react";
import { cn } from "cn";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cardValue } from "@/lib/deals/kanban";
import type { BoardDeal } from "@/lib/deals/queries";
import { formatMoneyCompact } from "@/lib/records/format";
import { DealCardBody, type CardValueField } from "./deal-card";

export const COLUMN_PREFIX = "col:";

export type ColumnStage = { id: string; name: string; probability: number };

const LAYOUT_SPRING = { type: "spring", stiffness: 520, damping: 42, mass: 0.8 } as const;

function DraggableCard({
  deal,
  field,
  href,
  canDrag,
  reduced,
  shakeToken,
}: {
  deal: BoardDeal;
  field: CardValueField;
  href: string;
  canDrag: boolean;
  reduced: boolean;
  shakeToken: number;
}) {
  const router = useRouter();
  const data = { type: "card", stageId: deal.stageId };
  const drag = useDraggable({ id: deal.id, data, disabled: !canDrag });
  const drop = useDroppable({ id: deal.id, data });
  const [scope, animate] = useAnimate<HTMLDivElement>();
  const descId = `deal-desc-${deal.id}`;
  const instructions = drag.attributes["aria-describedby"];

  const setRefs = useCallback(
    (node: HTMLDivElement | null) => {
      drag.setNodeRef(node);
      drop.setNodeRef(node);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [drag.setNodeRef, drop.setNodeRef],
  );

  useEffect(() => {
    if (!shakeToken || reduced || !scope.current) return;
    animate(scope.current, { x: [0, -6, 6, -4, 4, 0] }, { duration: 0.3, ease: "easeInOut" });
  }, [shakeToken, reduced, animate, scope]);

  return (
    <motion.li
      layout={reduced ? false : "position"}
      transition={{ layout: LAYOUT_SPRING }}
      className="list-none"
    >
      {/*
        O contêiner recebe só os eventos de ponteiro (sem role/tabIndex): o único ponto de foco é o
        link do título, que também ativa o arraste pelo teclado (Espaço) via setActivatorNodeRef.
      */}
      <div
        ref={setRefs}
        data-testid="deal-card"
        data-deal-id={deal.id}
        data-shaking={shakeToken ? "true" : "false"}
        {...drag.listeners}
        onClick={() => router.push(href)}
        className={cn("rounded-lg", canDrag ? "cursor-grab touch-none active:cursor-grabbing" : "cursor-pointer")}
      >
        <div ref={scope}>
          {drag.isDragging ? (
            <div className="rounded-lg border-2 border-dashed border-primary/40 bg-primary/5">
              <div className="invisible">
                <DealCardBody deal={deal} field={field} href={href} lifted />
              </div>
            </div>
          ) : (
            <DealCardBody
              deal={deal}
              field={field}
              href={href}
              activatorRef={canDrag ? drag.setActivatorNodeRef : undefined}
              describedBy={[descId, canDrag ? instructions : null].filter(Boolean).join(" ")}
              descriptionId={descId}
            />
          )}
        </div>
      </div>
    </motion.li>
  );
}

/** Coluna de uma etapa: cabeçalho com probabilidade, quantidade e soma; cards por `position`. */
export function KanbanColumn({
  stage,
  deals,
  hiddenCount,
  truncated,
  stageLimit,
  field,
  dealHref,
  canDrag,
  reduced,
  shake,
}: {
  stage: ColumnStage;
  deals: BoardDeal[];
  /** Negócios da etapa que não vieram (acima do limite carregado). */
  hiddenCount: number;
  truncated: boolean;
  /** Limite de cards carregados por etapa (texto do aviso de soma parcial). */
  stageLimit: number;
  field: CardValueField;
  dealHref: (id: string) => string;
  canDrag: boolean;
  reduced: boolean;
  shake: { id: string; token: number } | null;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `${COLUMN_PREFIX}${stage.id}`, data: { type: "column", stageId: stage.id } });
  const sum = deals.reduce((acc, d) => acc + cardValue(d, field), 0);
  const sumText = `${formatMoneyCompact(sum)}${truncated ? "+" : ""}`;

  return (
    <section
      ref={setNodeRef}
      aria-label={stage.name}
      data-testid="kanban-column"
      className={cn(
        "flex w-72 shrink-0 flex-col rounded-xl bg-muted/50 transition-colors",
        isOver && "bg-primary/5 ring-1 ring-primary/30",
      )}
    >
      <header className="flex flex-col gap-0.5 border-b px-3 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <h2 className="truncate font-heading text-sm font-semibold">{stage.name}</h2>
          <span className="shrink-0 text-xs text-muted-foreground" title="Probabilidade">
            {stage.probability}%
          </span>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span data-testid="column-count">{deals.length + hiddenCount}</span>
          <span aria-hidden>·</span>
          {truncated ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span data-testid="column-sum" className="cursor-help tabular-nums underline decoration-dotted underline-offset-2">
                  {sumText}
                </span>
              </TooltipTrigger>
              <TooltipContent>Soma dos {stageLimit} primeiros negócios</TooltipContent>
            </Tooltip>
          ) : (
            <span data-testid="column-sum" className="tabular-nums">
              {sumText}
            </span>
          )}
        </div>
      </header>
      <ul className="flex min-h-24 flex-1 flex-col gap-2 overflow-y-auto p-2">
        {deals.map((d) => (
          <DraggableCard
            key={d.id}
            deal={d}
            field={field}
            href={dealHref(d.id)}
            canDrag={canDrag}
            reduced={reduced}
            shakeToken={shake?.id === d.id ? shake.token : 0}
          />
        ))}
        {deals.length === 0 ? (
          <li className="flex flex-1 items-center justify-center rounded-lg border border-dashed px-3 py-6 text-center text-xs text-muted-foreground">
            Nenhum negócio nesta etapa.
          </li>
        ) : null}
      </ul>
    </section>
  );
}
