"use client";

import { usePathname } from "next/navigation";
import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";
import type { MenuProfile } from "./user-menu";
import { TooltipProvider } from "@/components/ui/tooltip";
import { scopeCanViewReports } from "@/lib/nav";
import { ALL_COMPANIES_SLUG, deriveScopeSlug, type CompanySummary } from "@/lib/companies/pure";

export function AppShell({
  profile,
  companies,
  lastSlug,
  reportSlugs,
  children,
}: {
  profile: MenuProfile;
  companies: CompanySummary[];
  lastSlug: string | undefined;
  /** Empresas em que o usuário tem view_reports (libera o menu Relatórios). */
  reportSlugs: string[];
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const scopeSlug = deriveScopeSlug(pathname, companies, profile.isSuperAdmin, lastSlug);
  const canViewReports = scopeCanViewReports(scopeSlug, ALL_COMPANIES_SLUG, reportSlugs);
  const allowAll = profile.isSuperAdmin || companies.length >= 2;

  return (
    <TooltipProvider delayDuration={150}>
      <div className="flex min-h-screen">
        <Sidebar scopeSlug={scopeSlug} isSuperAdmin={profile.isSuperAdmin} canViewReports={canViewReports} />
        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar
            profile={profile}
            companies={companies}
            scopeSlug={scopeSlug}
            allowAll={allowAll}
            canViewReports={canViewReports}
          />
          <main className="flex-1 p-6">{children}</main>
        </div>
      </div>
    </TooltipProvider>
  );
}
