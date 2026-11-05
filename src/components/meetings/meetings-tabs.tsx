"use client";

import Link from "next/link";
import { MEETING_TABS, type MeetingListTab } from "@/lib/meet/view";
import { cn } from "cn";

/** Abas da página Reuniões (`?aba=`): Pendentes, Sem vínculo, Com erro e Todas. */
export function MeetingsTabs({ scopeSlug, active }: { scopeSlug: string; active: MeetingListTab }) {
  return (
    <nav aria-label="Reuniões" className="flex gap-1 border-b">
      {MEETING_TABS.map((t) => (
        <Link
          key={t.key}
          href={`/${scopeSlug}/reunioes?aba=${t.key}`}
          aria-current={active === t.key ? "page" : undefined}
          className={cn(
            "-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors",
            active === t.key
              ? "border-primary text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
