"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";

export type StatusTab = { status: string; label: string };

/**
 * Abas por status: valor na URL (`?status=`); a primeira aba é o padrão (sem parâmetro).
 * Mantém os demais filtros e volta para a página 1.
 */
export function StatusTabs({ tabs, ariaLabel }: { tabs: StatusTab[]; ariaLabel: string }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const raw = params.get("status");
  const active = tabs.some((t) => t.status === raw) ? raw : tabs[0].status;
  return (
    <nav aria-label={ariaLabel} className="flex gap-1 border-b">
      {tabs.map((t, i) => {
        const next = new URLSearchParams(params.toString());
        next.delete("page");
        next.delete("status");
        if (i > 0) next.set("status", t.status);
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
