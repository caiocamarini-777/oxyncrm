"use client";

import { CommandPalette } from "./command-palette";
import { CompanySwitcher } from "./company-switcher";
import { NotificationsBell } from "./notifications-bell";
import { QuickCreate } from "./quick-create";
import { ThemeToggle } from "./theme-toggle";
import { UserMenu, type MenuProfile } from "./user-menu";
import type { CompanySummary } from "@/lib/companies/pure";

export function Topbar({
  profile,
  companies,
  scopeSlug,
  allowAll,
  canViewReports,
}: {
  profile: MenuProfile;
  companies: CompanySummary[];
  scopeSlug: string | null;
  allowAll: boolean;
  canViewReports: boolean;
}) {
  return (
    <header className="flex h-14 items-center gap-3 border-b bg-background px-4">
      <CompanySwitcher companies={companies} scopeSlug={scopeSlug} allowAll={allowAll} />
      <div className="flex flex-1 justify-center">
        <CommandPalette
          companies={companies}
          scopeSlug={scopeSlug}
          allowAll={allowAll}
          isSuperAdmin={profile.isSuperAdmin}
          canViewReports={canViewReports}
        />
      </div>
      <QuickCreate isSuperAdmin={profile.isSuperAdmin} />
      <NotificationsBell />
      <ThemeToggle />
      <UserMenu profile={profile} />
    </header>
  );
}
