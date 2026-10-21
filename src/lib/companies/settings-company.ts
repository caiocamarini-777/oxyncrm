import { cookies } from "next/headers";
import { getAccessibleCompanies, LAST_COMPANY_COOKIE, type CompanySummary } from "./scope";

/** Empresa das telas de configuração: ?empresa=slug, depois o cookie da última empresa, depois a primeira. */
export async function resolveSettingsCompany(
  param: string | undefined,
): Promise<{ companies: CompanySummary[]; selected: CompanySummary | null }> {
  const companies = await getAccessibleCompanies();
  const last = (await cookies()).get(LAST_COMPANY_COOKIE)?.value;
  const selected =
    companies.find((c) => c.slug === param) ??
    companies.find((c) => c.slug === last) ??
    companies[0] ??
    null;
  return { companies, selected };
}
