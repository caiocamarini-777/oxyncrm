"use client";

import { useState } from "react";
import type { ActivityRow } from "@/lib/activities/queries";
import { dayKey, weekGrid } from "@/lib/activities/time";
import { groupByDay } from "@/lib/activities/view";
import { cn } from "cn";
import { AgendaItem } from "./activity-popover";
import { AgendaNav, TruncatedNotice } from "./agenda-nav";
import { CompleteHost } from "./complete-host";
import type { PageCtx } from "./page-context";

const dayFmt = new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC", weekday: "short", day: "2-digit", month: "2-digit" });
const rangeFmt = new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC", day: "numeric", month: "long", year: "numeric" });
const utc = (key: string) => new Date(`${key}T00:00:00Z`);

/** Semana de segunda a domingo; cada dia lista as atividades por horário. */
export function AgendaWeek({ rows, anchor, ctx, truncated = false }: { rows: ActivityRow[]; anchor: string; ctx: PageCtx; truncated?: boolean }) {
  const [completing, setCompleting] = useState<ActivityRow | null>(null);
  const days = weekGrid(anchor);
  const byDay = groupByDay(rows);
  const today = dayKey(ctx.nowIso);
  const label = `${rangeFmt.format(utc(days[0]))} a ${rangeFmt.format(utc(days[6]))}`;
  return (
    <div className="flex flex-col gap-3">
      <AgendaNav view="semana" anchor={anchor} label={label} />
      {truncated ? <TruncatedNotice /> : null}
      <div className="grid grid-cols-1 gap-2 md:grid-cols-7" data-testid="agenda-week">
        {days.map((d) => {
          const items = byDay.get(d) ?? [];
          return (
            <section
              key={d}
              data-testid="agenda-day"
              data-day={d}
              aria-label={dayFmt.format(utc(d))}
              className={cn("flex min-h-24 flex-col gap-1 rounded-md border p-2", d === today && "border-primary", d === anchor && "ring-2 ring-primary/40")}
            >
              <h3 className={cn("text-xs font-medium capitalize", d === today ? "text-primary" : "text-muted-foreground")}>
                {dayFmt.format(utc(d))}
              </h3>
              {items.map((a) => (
                <div key={a.id} className="flex flex-col gap-0.5">
                  <AgendaItem activity={a} ctx={ctx} onComplete={setCompleting} />
                  {ctx.allCompanies ? (
                    <span className="truncate px-1.5 text-[11px] text-muted-foreground">{a.companyName}</span>
                  ) : null}
                </div>
              ))}
            </section>
          );
        })}
      </div>
      <CompleteHost activity={completing} ctx={ctx} onClose={() => setCompleting(null)} />
    </div>
  );
}
