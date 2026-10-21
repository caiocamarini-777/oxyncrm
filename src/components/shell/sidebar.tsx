"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { NAV_ITEMS, isNavItemEnabled, navHref } from "@/lib/nav";
import { cn } from "@/lib/utils";

const base = "flex size-10 items-center justify-center rounded-lg";

export function Sidebar({
  scopeSlug,
  isSuperAdmin,
}: {
  scopeSlug: string | null;
  isSuperAdmin: boolean;
}) {
  const pathname = usePathname();
  const items = NAV_ITEMS.filter((i) => !i.superAdminOnly || isSuperAdmin);

  return (
    <aside className="sticky top-0 flex h-screen w-16 shrink-0 flex-col items-center gap-2 bg-[var(--color-sidebar)] py-3 text-sidebar-foreground">
      <Link
        href={scopeSlug ? `/${scopeSlug}/inicio` : "/"}
        aria-label="Início"
        className="mb-3 flex size-10 items-center justify-center"
      >
        <Image src="/oxyn-mark.png" alt="Oxyn" width={32} height={32} priority />
      </Link>
      <nav aria-label="Principal" className="flex flex-col items-center gap-1">
        {items.map((item) => {
          const Icon = item.icon;
          if (!isNavItemEnabled(item, isSuperAdmin) || (item.scoped && !scopeSlug)) {
            return (
              <Tooltip key={item.key}>
                <TooltipTrigger asChild>
                  <span
                    tabIndex={0}
                    aria-label={item.label}
                    aria-disabled="true"
                    className={cn(base, "cursor-not-allowed opacity-40")}
                  >
                    <Icon className="size-5" />
                  </span>
                </TooltipTrigger>
                <TooltipContent side="right">
                  {isNavItemEnabled(item, isSuperAdmin) ? "Selecione uma empresa" : "Disponível em breve"}
                </TooltipContent>
              </Tooltip>
            );
          }
          const href = navHref(item, scopeSlug ?? "");
          const segment = href.split("/").slice(0, item.scoped ? 3 : 2).join("/");
          const active = pathname === href || pathname.startsWith(`${segment}/`) || pathname === segment;
          return (
            <Tooltip key={item.key}>
              <TooltipTrigger asChild>
                <Link
                  href={href}
                  aria-label={item.label}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    base,
                    "transition-colors hover:bg-sidebar-accent",
                    active && "bg-[var(--color-brand)] text-white hover:bg-[var(--color-brand)]",
                  )}
                >
                  <Icon className="size-5" />
                </Link>
              </TooltipTrigger>
              <TooltipContent side="right">{item.label}</TooltipContent>
            </Tooltip>
          );
        })}
      </nav>
    </aside>
  );
}
