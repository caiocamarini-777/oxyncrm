"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { LEAD_STATUSES, type LeadStatus } from "@/lib/leads/schema";
import { cn } from "@/lib/utils";

const TABS: { status: LeadStatus; label: string }[] = [
  { status: "open", label: "Abertos" },
  { status: "disqualified", label: "Desqualificados" },
  { status: "archived", label: "Arquivados" },
];

/** Abas por status: valor na URL (`?status=`), `open` por padrão. Mantém os demais filtros. */
export function LeadStatusTabs() {
  const pathname = usePathname();
  const params = useSearchParams();
  const raw = params.get("status");
  const active = (LEAD_STATUSES as readonly string[]).includes(raw ?? "") ? raw : "open";
  return (
    <nav aria-label="Status dos leads" className="flex gap-1 border-b">
      {TABS.map((t) => {
        const next = new URLSearchParams(params.toString());
        next.delete("page");
        next.delete("status");
        if (t.status !== "open") next.set("status", t.status);
        const qs = next.toString();
        return (
          <Link
            key={t.status}
            href={qs ? `${pathname}?${qs}` : pathname}
            aria-current={active === t.status ? "page" : undefined}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors",
              active === t.status
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
