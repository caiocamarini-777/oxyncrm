"use client";

import Link from "next/link";
import { cn } from "cn";
import { LabelChip } from "@/components/records/label-chip";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cardValue } from "@/lib/deals/kanban";
import type { BoardDeal } from "@/lib/deals/queries";
import { NextActivityBadge } from "@/components/activities/next-activity-badge";
import type { NextActivity } from "@/lib/activities/next";
import { formatMoney } from "@/lib/records/format";

export type CardValueField = "total" | "mrr" | "setup";

/** O que o card precisa; o quadro (BoardDeal) e a previsão (ForecastRow) satisfazem. */
export type CardDeal = Pick<
  BoardDeal,
  "id" | "title" | "organization" | "rotting" | "labels" | "ownerName" | "ownerAvatarUrl" | "contractValue" | "estimatedValue" | "mrr" | "setupTotal"
> & { nextActivity?: NextActivity | null };

function initials(name: string) {
  return (
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() ?? "")
      .join("") || "?"
  );
}

/** Selo "Esfriando": vermelho neutro, sem laranja. */
export function RottingBadge() {
  return (
    <span className="inline-flex items-center rounded-full bg-red-500/10 px-2 py-0.5 text-xs font-medium text-red-700 dark:text-red-400">
      Esfriando
    </span>
  );
}

/** Conteúdo visual do card (usado na coluna e no card levantado do arraste). */
export function DealCardBody({
  deal,
  field,
  href,
  lifted = false,
  activatorRef,
  describedBy,
  descriptionId,
}: {
  deal: CardDeal;
  field: CardValueField;
  href: string;
  /** Cópia visual (card levantado ou espaço reservado): sem foco nem leitura. */
  lifted?: boolean;
  /** Torna o link do título o ativador do arraste por teclado. */
  activatorRef?: (node: HTMLElement | null) => void;
  describedBy?: string;
  /** Id do resumo para leitores de tela (organização, valor, esfriando). */
  descriptionId?: string;
}) {
  const value = cardValue(deal, field);
  const extra = deal.labels.length - 2;
  return (
    <div
      className={cn(
        "flex flex-col gap-2 rounded-lg border bg-card p-3 text-card-foreground shadow-xs transition-shadow",
        lifted ? "shadow-xl ring-1 ring-primary/30" : "hover:shadow-md",
      )}
    >
      <div className="flex flex-col gap-0.5">
        <Link
          href={href}
          data-testid="deal-title"
          className="line-clamp-2 text-sm font-medium leading-snug hover:text-primary hover:underline"
          onClick={(e) => e.stopPropagation()}
          draggable={false}
          ref={activatorRef}
          aria-describedby={describedBy || undefined}
          tabIndex={lifted ? -1 : undefined}
          aria-hidden={lifted || undefined}
        >
          {deal.title}
        </Link>
        {descriptionId ? (
          <span id={descriptionId} className="sr-only">
            {[
              deal.organization ? `Organização: ${deal.organization.name}.` : null,
              `Valor: ${formatMoney(value)}.`,
              deal.rotting ? "Esfriando." : null,
              deal.nextActivity === undefined ? null : deal.nextActivity ? `Próxima atividade: ${deal.nextActivity.label}.` : "Sem atividade.",
            ]
              .filter(Boolean)
              .join(" ")}
          </span>
        ) : null}
        {deal.organization ? <span className="truncate text-xs text-muted-foreground">{deal.organization.name}</span> : null}
      </div>
      {deal.rotting || deal.labels.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1">
          {deal.rotting ? <RottingBadge /> : null}
          {deal.labels.slice(0, 2).map((l) => (
            <LabelChip key={l.id} color={l.color} name={l.name} />
          ))}
          {extra > 0 ? <span className="text-xs text-muted-foreground">+{extra}</span> : null}
        </div>
      ) : null}
      {deal.nextActivity !== undefined ? <NextActivityBadge next={deal.nextActivity} /> : null}
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold tabular-nums">{formatMoney(value)}</span>
        <Avatar size="sm" title={deal.ownerName} aria-label={`Responsável: ${deal.ownerName}`}>
          {deal.ownerAvatarUrl ? <AvatarImage src={deal.ownerAvatarUrl} alt="" /> : null}
          <AvatarFallback className="text-[10px]">{initials(deal.ownerName)}</AvatarFallback>
        </Avatar>
      </div>
    </div>
  );
}
