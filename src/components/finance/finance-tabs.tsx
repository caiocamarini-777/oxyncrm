"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { FINANCE_TABS } from "@/lib/finance/tabs";
import { cn } from "cn";

export function FinanceTabs({ empresa, canManage }: { empresa: string; canManage: boolean }) {
  const pathname = usePathname();
  const base = `/${empresa}/financeiro`;
  return (
    <nav aria-label="Financeiro" className="flex gap-1 overflow-x-auto border-b">
      {FINANCE_TABS.filter((t) => !t.manageOnly || canManage).map((t) => {
        const href = `${base}${t.path}`;
        const active = t.path === "" ? pathname === base : pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={t.key}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors",
              active
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
