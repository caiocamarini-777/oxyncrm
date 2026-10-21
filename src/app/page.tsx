import { Suspense } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import {
  LAST_COMPANY_COOKIE,
  getAccessibleCompanies,
  pickDefaultCompany,
} from "@/lib/companies/scope";

async function Redirector(): Promise<never> {
  const profile = await requireUser();
  const companies = await getAccessibleCompanies();
  const last = (await cookies()).get(LAST_COMPANY_COOKIE)?.value;
  const company = pickDefaultCompany(companies, last);
  if (!company) {
    redirect(profile.isSuperAdmin ? "/configuracoes/empresas" : "/sem-acesso");
  }
  redirect(`/${company.slug}/inicio`);
}

export default function Home() {
  return (
    <Suspense>
      <Redirector />
    </Suspense>
  );
}
