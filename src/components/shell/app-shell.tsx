"use client";

import { usePathname } from "next/navigation";
import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";
import type { MenuProfile } from "./user-menu";
import { TooltipProvider } from "@/components/ui/tooltip";
import { scopeCanSell, scopeCanViewFinance, scopeCanViewReports, type ReportsNavAccess } from "@/lib/nav";
import { ALL_COMPANIES_SLUG, deriveScopeSlug, type CompanySummary } from "@/lib/companies/pure";

export function AppShell({
  profile,
  companies,
  lastSlug,
  reportSlugs,
  financeSlugs,
  salesSlugs,
  hasSharedDashboards,
  children,
}: {
  profile: MenuProfile;
  companies: CompanySummary[];
  lastSlug: string | undefined;
  /** Empresas em que o usuário tem view_reports (libera o menu Relatórios). */
  reportSlugs: string[];
  /** Empresas com Financeiro ativado e view_finance do usuário (libera o menu Financeiro). */
  financeSlugs: string[];
  /** Empresas com Financeiro ativado e permissão de registrar vendas (libera o menu Vendas). */
  salesSlugs: string[];
  /** Há dashboard compartilhado comigo: sem view_reports, o menu Relatórios leva aos dashboards. */
  hasSharedDashboards: boolean;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const scopeSlug = deriveScopeSlug(pathname, companies, profile.isSuperAdmin, lastSlug);
  const reports: ReportsNavAccess = {
    canViewReports: scopeCanViewReports(scopeSlug, ALL_COMPANIES_SLUG, reportSlugs),
    hasSharedDashboards,
    canViewFinance: scopeCanViewFinance(scopeSlug, ALL_COMPANIES_SLUG, financeSlugs),
    canSell: scopeCanSell(scopeSlug, ALL_COMPANIES_SLUG, salesSlugs),
  };
  const allowAll = profile.isSuperAdmin || companies.length >= 2;

  return (
    <TooltipProvider delayDuration={150}>
      <div className="flex min-h-screen">
        <Sidebar scopeSlug={scopeSlug} isSuperAdmin={profile.isSuperAdmin} reports={reports} />
        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar
            profile={profile}
            companies={companies}
            scopeSlug={scopeSlug}
            allowAll={allowAll}
            reports={reports}
          />
          <main className="flex-1 p-6">{children}</main>
        </div>
      </div>
    </TooltipProvider>
  );
}
