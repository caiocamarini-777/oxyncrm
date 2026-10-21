"use client";

import { usePathname } from "next/navigation";
import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";
import type { MenuProfile } from "./user-menu";
import { TooltipProvider } from "@/components/ui/tooltip";
import { deriveScopeSlug, type CompanySummary } from "@/lib/companies/pure";

export function AppShell({
  profile,
  companies,
  lastSlug,
  children,
}: {
  profile: MenuProfile;
  companies: CompanySummary[];
  lastSlug: string | undefined;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const scopeSlug = deriveScopeSlug(pathname, companies, profile.isSuperAdmin, lastSlug);
  const allowAll = profile.isSuperAdmin || companies.length >= 2;

  return (
    <TooltipProvider delayDuration={150}>
      <div className="flex min-h-screen">
        <Sidebar scopeSlug={scopeSlug} isSuperAdmin={profile.isSuperAdmin} />
        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar profile={profile} companies={companies} scopeSlug={scopeSlug} allowAll={allowAll} />
          <main className="flex-1 p-6">{children}</main>
        </div>
      </div>
    </TooltipProvider>
  );
}
