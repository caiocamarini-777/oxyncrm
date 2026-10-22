"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

/** Abas da área Contatos. */
export function ContactsTabs({ scopeSlug }: { scopeSlug: string }) {
  const pathname = usePathname();
  const tabs = [
    { label: "Pessoas", href: `/${scopeSlug}/contatos/pessoas` },
    { label: "Organizações", href: `/${scopeSlug}/contatos/organizacoes` },
  ];
  return (
    <nav aria-label="Contatos" className="flex gap-1 border-b">
      {tabs.map((t) => {
        const active = pathname === t.href || pathname.startsWith(`${t.href}/`);
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors",
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
