"use client";

import Link from "next/link";
import { TRASH_TABS } from "@/lib/trash/tabs";
import { cn } from "@/lib/utils";

export function TrashTabs({ scopeSlug, active }: { scopeSlug: string; active: string }) {
  return (
    <nav aria-label="Lixeira" className="flex gap-1 border-b">
      {TRASH_TABS.map((t) => (
        <Link
          key={t.key}
          href={`/${scopeSlug}/lixeira?aba=${t.key}`}
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
