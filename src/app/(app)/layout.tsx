import { cookies } from "next/headers";
import { AppShell } from "@/components/shell/app-shell";
import { requireUser } from "@/lib/auth/session";
import { LAST_COMPANY_COOKIE } from "@/lib/companies/constants";
import { getAccessibleCompanies, hideTestCompanies } from "@/lib/companies/scope";
import { financeCompanySlugs, salesCompanySlugs } from "@/lib/finance/permissions";
import { hasSharedDashboards, reportCompanySlugs } from "@/lib/reports/permissions";

// Bloqueante de propósito: o 404 de empresa precisa sair com status 404, e não
// em um stream que já começou com 200. A página depende da sessão de qualquer forma.
export const instant = false;

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const [profile, companies, cookieStore, reportSlugs, financeSlugs, salesSlugs, sharedDashboards] = await Promise.all([
    requireUser(),
    getAccessibleCompanies(),
    cookies(),
    reportCompanySlugs(),
    financeCompanySlugs(),
    salesCompanySlugs(),
    hasSharedDashboards(),
  ]);
  const lastSlug = cookieStore.get(LAST_COMPANY_COOKIE)?.value;
  return (
    <AppShell
      profile={{
        fullName: profile.fullName,
        email: profile.email,
        avatarUrl: profile.avatarUrl,
        isSuperAdmin: profile.isSuperAdmin,
      }}
      companies={hideTestCompanies(companies, profile.email)}
      lastSlug={lastSlug}
      reportSlugs={reportSlugs}
      financeSlugs={financeSlugs}
      salesSlugs={salesSlugs}
      hasSharedDashboards={sharedDashboards}
    >
      {children}
    </AppShell>
  );
}
