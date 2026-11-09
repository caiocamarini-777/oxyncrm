"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { NAV_ITEMS, isNavItemEnabled, navHref, reportsSharedOnly, type ReportsNavAccess } from "@/lib/nav";
import { cn } from "cn";

const base = "flex size-10 items-center justify-center rounded-lg";

export function Sidebar({
  scopeSlug,
  isSuperAdmin,
  reports,
  pendingMeetings,
}: {
  scopeSlug: string | null;
  isSuperAdmin: boolean;
  reports: ReportsNavAccess;
  /** Reuniões do usuário que esperam decisão (sem vínculo e sugestões pendentes); 0 não mostra contador. */
  pendingMeetings: number;
}) {
  const pathname = usePathname();
  const sharedOnly = reportsSharedOnly(isSuperAdmin, reports);
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
          if (!isNavItemEnabled(item, isSuperAdmin, reports) || (item.scoped && !scopeSlug)) {
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
                  {!isNavItemEnabled(item, isSuperAdmin, { canViewReports: true, hasSharedDashboards: false })
                    ? "Disponível em breve"
                    : item.scoped && !scopeSlug
                      ? "Selecione uma empresa"
                      : "Sem permissão para relatórios"}
                </TooltipContent>
              </Tooltip>
            );
          }
          const href = navHref(item, scopeSlug ?? "", sharedOnly);
          const count = item.key === "reunioes" ? pendingMeetings : 0;
          const segment = href.split("/").slice(0, item.scoped ? 3 : 2).join("/");
          const active = pathname === href || pathname.startsWith(`${segment}/`) || pathname === segment;
          return (
            <Tooltip key={item.key}>
              <TooltipTrigger asChild>
                <Link
                  href={href}
                  aria-label={count > 0 ? `${item.label}, ${count} aguardando decisão` : item.label}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    base,
                    "relative transition-colors hover:bg-sidebar-accent",
                    active && "bg-[var(--color-brand)] text-white hover:bg-[var(--color-brand)]",
                  )}
                >
                  <Icon className="size-5" />
                  {count > 0 && (
                    <span
                      data-testid="meetings-pending-count"
                      className="absolute right-0 top-0 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground ring-2 ring-[var(--color-sidebar)]"
                    >
                      {count > 99 ? "99+" : count}
                    </span>
                  )}
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
