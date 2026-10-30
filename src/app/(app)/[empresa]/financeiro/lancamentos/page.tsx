import { Suspense } from "react";
import { notFound } from "next/navigation";
import { Download } from "lucide-react";
import { EntriesTable } from "@/components/finance/entries-table";
import { FinanceFilterBar } from "@/components/finance/finance-filters";
import { Pagination } from "@/components/records/pagination";
import { buttonVariants } from "@/components/ui/button";
import { requireUser } from "@/lib/auth/session";
import { getAccessibleCompanies, resolveCompanyScope } from "@/lib/companies/scope";
import { todaySaoPaulo } from "@/lib/finance/dates";
import { parseFinanceFilters, toFinanceSearchParams } from "@/lib/finance/filters";
import { getFinanceAccess } from "@/lib/finance/permissions";
import { listEntriesPage, listFinanceLookups } from "@/lib/finance/queries";
import { PAGE_SIZE } from "@/lib/records/types";

export const instant = false;

export default async function FinanceEntriesPage({
  params,
  searchParams,
}: {
  params: Promise<{ empresa: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ empresa }, sp, profile, companies] = await Promise.all([params, searchParams, requireUser(), getAccessibleCompanies()]);
  const scope = resolveCompanyScope(empresa, companies, profile.isSuperAdmin);
  if (!scope || scope.kind === "all") notFound();
  const company = scope.company;

  const today = todaySaoPaulo();
  const filters = parseFinanceFilters(sp, today);
  const rawPage = Number(Array.isArray(sp.page) ? sp.page[0] : sp.page);
  const page = Number.isInteger(rawPage) && rawPage > 1 ? rawPage : 1;

  const [access, lookups, { rows, total }] = await Promise.all([
    getFinanceAccess(company.id),
    listFinanceLookups(company.id),
    listEntriesPage(company.id, filters, page, PAGE_SIZE),
  ]);
  const qs = toFinanceSearchParams(filters, today).toString();

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <FinanceFilterBar
          filters={filters}
          lookups={lookups}
          today={today}
          controls={["period", "clients", "services", "expenses", "natures", "accounts", "statuses", "renewals", "estimated", "changed"]}
        />
        <a
          href={`/${company.slug}/financeiro/lancamentos/export${qs ? `?${qs}` : ""}`}
          className={buttonVariants({ variant: "outline", size: "sm" })}
        >
          <Download /> Exportar CSV
        </a>
      </div>
      <EntriesTable entries={rows} lookups={lookups} companyId={company.id} today={today} canManage={access.manage} />
      <Suspense>
        <Pagination total={total} page={page} />
      </Suspense>
    </div>
  );
}
