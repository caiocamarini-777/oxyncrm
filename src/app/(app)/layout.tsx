import { cookies } from "next/headers";
import { AppShell } from "@/components/shell/app-shell";
import { requireUser } from "@/lib/auth/session";
import { LAST_COMPANY_COOKIE } from "@/lib/companies/constants";
import { getAccessibleCompanies } from "@/lib/companies/scope";

// Bloqueante de propósito: o 404 de empresa precisa sair com status 404, e não
// em um stream que já começou com 200. A página depende da sessão de qualquer forma.
export const instant = false;

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const profile = await requireUser();
  const companies = await getAccessibleCompanies();
  const lastSlug = (await cookies()).get(LAST_COMPANY_COOKIE)?.value;
  return (
    <AppShell
      profile={{
        fullName: profile.fullName,
        email: profile.email,
        avatarUrl: profile.avatarUrl,
        isSuperAdmin: profile.isSuperAdmin,
      }}
      companies={companies}
      lastSlug={lastSlug}
    >
      {children}
    </AppShell>
  );
}
