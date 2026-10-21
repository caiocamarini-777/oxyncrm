import { notFound } from "next/navigation";
import { LastCompanyCookie } from "@/components/shell/last-company-cookie";
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

  return (
    <>
      {children}
      {scope.kind === "company" ? <LastCompanyCookie slug={scope.company.slug} /> : null}
    </>
  );
}
