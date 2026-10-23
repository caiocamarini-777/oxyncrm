"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useState } from "react";
import type { ActivityRow } from "@/lib/activities/queries";
import { dayKey, monthGrid } from "@/lib/activities/time";
import { groupByDay } from "@/lib/activities/view";
import { cn } from "cn";
import { AgendaItem } from "./activity-popover";
import { AgendaNav } from "./agenda-nav";
import { CompleteHost } from "./complete-host";
import type { PageCtx } from "./page-context";

const PER_DAY = 3;
const WEEKDAYS = ["seg.", "ter.", "qua.", "qui.", "sex.", "sáb.", "dom."];
const monthFmt = new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC", month: "long", year: "numeric" });
const utc = (key: string) => new Date(`${key}T00:00:00Z`);

/** Mês em semanas de segunda a domingo; até 3 atividades por dia e "+N" que abre o dia na semana. */
export function AgendaMonth({ rows, anchor, ctx }: { rows: ActivityRow[]; anchor: string; ctx: PageCtx }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const [completing, setCompleting] = useState<ActivityRow | null>(null);
  const weeks = monthGrid(anchor);
  const byDay = groupByDay(rows);
  const today = dayKey(ctx.nowIso);
  const month = anchor.slice(0, 7);

  function dayHref(day: string) {
    const next = new URLSearchParams(params.toString());
    next.set("visao", "semana");
    next.set("data", day);
    return `${pathname}?${next.toString()}`;
  }

  return (
    <div className="flex flex-col gap-3">
      <AgendaNav view="mes" anchor={anchor} label={monthFmt.format(utc(`${month}-01`))} />
      <div className="overflow-x-auto">
        <div className="min-w-[44rem]" data-testid="agenda-month">
          <div className="grid grid-cols-7 gap-1 pb-1">
            {WEEKDAYS.map((w) => (
              <span key={w} className="px-1 text-xs font-medium capitalize text-muted-foreground">
                {w}
              </span>
            ))}
          </div>
          <div className="flex flex-col gap-1">
            {weeks.map((week) => (
              <div key={week[0]} className="grid grid-cols-7 gap-1">
                {week.map((d) => {
                  const items = byDay.get(d) ?? [];
                  const extra = items.length - PER_DAY;
                  return (
                    <section
                      key={d}
                      data-testid="agenda-day"
                      data-day={d}
                      aria-label={`Dia ${Number(d.slice(8))}`}
                      className={cn(
                        "flex min-h-24 flex-col gap-1 rounded-md border p-1.5",
                        !d.startsWith(month) && "bg-muted/40",
                        d === today && "border-primary",
                      )}
                    >
                      <span
                        className={cn(
                          "text-xs",
                          d === today ? "font-semibold text-primary" : d.startsWith(month) ? "text-foreground" : "text-muted-foreground",
                        )}
                      >
                        {Number(d.slice(8))}
                      </span>
                      {items.slice(0, PER_DAY).map((a) => (
                        <AgendaItem key={a.id} activity={a} ctx={ctx} onComplete={setCompleting} />
                      ))}
                      {extra > 0 ? (
                        <Link
                          href={dayHref(d)}
                          aria-label={`Ver as ${items.length} atividades do dia ${Number(d.slice(8))}`}
                          className="px-1.5 text-xs font-medium text-primary hover:underline"
                        >
                          +{extra}
                        </Link>
                      ) : null}
                    </section>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
      <CompleteHost activity={completing} ctx={ctx} onClose={() => setCompleting(null)} />
    </div>
  );
}
