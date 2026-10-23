"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { ActivityRow } from "@/lib/activities/queries";
import { formatDateTime, formatTime } from "@/lib/activities/time";
import { cn } from "cn";
import { ActivityChip, TypeIcon } from "./activity-chip";
import { primaryLink } from "./helpers";
import type { PageCtx } from "./page-context";

const TONE = {
  overdue: "bg-red-600/10 text-red-700 hover:bg-red-600/20 dark:text-red-400",
  today: "bg-primary/10 text-foreground hover:bg-primary/20",
  upcoming: "bg-primary/10 text-foreground hover:bg-primary/20",
  done: "bg-muted text-muted-foreground line-through hover:bg-muted/70",
} as const;

/** Item da agenda: abre um popover com os detalhes, o link do registro e o botão Concluir. */
export function AgendaItem({
  activity,
  ctx,
  onComplete,
}: {
  activity: ActivityRow;
  ctx: PageCtx;
  onComplete: (a: ActivityRow) => void;
}) {
  const [open, setOpen] = useState(false);
  const link = primaryLink(activity);
  const canEdit = ctx.companies.find((c) => c.id === activity.companyId)?.canEdit ?? false;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid="agenda-item"
          data-status={activity.status}
          className={cn(
            "flex w-full min-w-0 items-center gap-1.5 rounded px-1.5 py-1 text-left text-xs transition-colors focus-visible:outline-2 focus-visible:outline-ring",
            TONE[activity.status],
          )}
        >
          <TypeIcon name={activity.type.name} isMeeting={activity.type.isMeeting} className="size-3.5 shrink-0" />
          <span className="shrink-0 tabular-nums">{formatTime(activity.dueAt)}</span>
          <span className="truncate">{activity.subject}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent data-testid="agenda-popover">
        <div className="flex flex-col gap-2 text-sm">
          <p className="flex flex-wrap items-center gap-2 font-medium">
            <TypeIcon name={activity.type.name} isMeeting={activity.type.isMeeting} className="text-muted-foreground" />
            <span className={cn(activity.done && "line-through")}>{activity.subject}</span>
            <ActivityChip status={activity.status} />
          </p>
          <p className="text-xs text-muted-foreground">
            {formatDateTime(activity.dueAt)} · {activity.channel.name} · {activity.ownerName}
            {ctx.allCompanies ? ` · ${activity.companyName}` : ""}
          </p>
          {activity.done ? (
            <p className="text-xs text-muted-foreground">
              Concluída
              {activity.outcome ? ` · ${activity.outcome.name}` : ""}
            </p>
          ) : null}
          {activity.description ? <p className="whitespace-pre-wrap text-xs">{activity.description}</p> : null}
          <div className="flex items-center justify-between gap-2 pt-1">
            {link ? (
              <Link href={link.href} className="truncate text-xs font-medium text-primary hover:underline">
                Abrir {link.label}
              </Link>
            ) : (
              <span className="text-xs text-muted-foreground">Sem vínculo visível</span>
            )}
            {!activity.done && canEdit ? (
              <Button
                type="button"
                size="sm"
                onClick={() => {
                  setOpen(false);
                  onComplete(activity);
                }}
              >
                Concluir
              </Button>
            ) : null}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
