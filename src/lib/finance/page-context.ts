import "server-only";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { getAccessibleCompanies, resolveCompanyScope } from "@/lib/companies/scope";
import { todaySaoPaulo } from "./dates";
import { parseFinanceFilters } from "./filters";
import { getFinanceAccess } from "./permissions";
import { listFinanceLookups } from "./queries";

/** Contexto comum das telas analíticas: empresa (404 fora de uma empresa), hoje, filtros da URL, acesso e listas. */
export async function loadFinancePage(
  params: Promise<{ empresa: string }>,
  searchParams: Promise<Record<string, string | string[] | undefined>>,
) {
  const [{ empresa }, sp, profile, companies] = await Promise.all([params, searchParams, requireUser(), getAccessibleCompanies()]);
  const scope = resolveCompanyScope(empresa, companies, profile.isSuperAdmin);
  if (!scope || scope.kind === "all") notFound();
  const company = scope.company;
  const today = todaySaoPaulo();
  const filters = parseFinanceFilters(sp, today);
  const [access, lookups] = await Promise.all([getFinanceAccess(company.id), listFinanceLookups(company.id)]);
  return { company, today, filters, access, lookups };
}
