import { notFound } from "next/navigation";
import { Sidebar } from "@/components/shell/sidebar";
import { Topbar } from "@/components/shell/topbar";
import { LastCompanyCookie } from "@/components/shell/last-company-cookie";
import { TooltipProvider } from "@/components/ui/tooltip";
import { requireUser } from "@/lib/auth/session";
import { getAccessibleCompanies, resolveCompanyScope } from "@/lib/companies/scope";

export const instant = false;

export default async function CompanyLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ empresa: string }>;
}) {
  const { empresa } = await params;
  const profile = await requireUser();
  const companies = await getAccessibleCompanies();
  const scope = resolveCompanyScope(empresa, companies, profile.isSuperAdmin);
  if (!scope) notFound();
  const scopeSlug = scope.kind === "all" ? "todas" : scope.company.slug;
  const allowAll = profile.isSuperAdmin || companies.length >= 2;

  return (
    <TooltipProvider delayDuration={150}>
      <div className="flex min-h-screen">
        <Sidebar scopeSlug={scopeSlug} isSuperAdmin={profile.isSuperAdmin} />
        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar
            profile={{
              fullName: profile.fullName,
              email: profile.email,
              avatarUrl: profile.avatarUrl,
              isSuperAdmin: profile.isSuperAdmin,
            }}
            companies={companies}
            scopeSlug={scopeSlug}
            allowAll={allowAll}
          />
          <main className="flex-1 p-6">{children}</main>
        </div>
      </div>
      {scope.kind === "company" ? <LastCompanyCookie slug={scope.company.slug} /> : null}
    </TooltipProvider>
  );
}
