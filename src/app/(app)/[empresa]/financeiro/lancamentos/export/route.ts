import { type NextRequest } from "next/server";
import { getCurrentProfile } from "@/lib/auth/session";
import { getAccessibleCompanies, resolveCompanyScope } from "@/lib/companies/scope";
import { todaySaoPaulo } from "@/lib/finance/dates";
import { entriesToCsv } from "@/lib/finance/export";
import { parseFinanceFilters } from "@/lib/finance/filters";
import { getFinanceAccess } from "@/lib/finance/permissions";
import { listEntries, listFinanceLookups } from "@/lib/finance/queries";

const text = (status: number, body: string) =>
  new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });

export async function GET(request: NextRequest, { params }: { params: Promise<{ empresa: string }> }) {
  const { empresa } = await params;
  const profile = await getCurrentProfile();
  if (!profile || !profile.active) return text(401, "Sessão expirada.");

  const companies = await getAccessibleCompanies();
  const scope = resolveCompanyScope(empresa, companies, profile.isSuperAdmin);
  if (!scope || scope.kind === "all") return text(404, "Não encontrado.");
  const access = await getFinanceAccess(scope.company.id);
  if (!access.view) return text(404, "Não encontrado.");

  const sp = Object.fromEntries(
    [...new Set(request.nextUrl.searchParams.keys())].map((k) => [k, request.nextUrl.searchParams.getAll(k)]),
  );
  const today = todaySaoPaulo();
  const [entries, lookups] = await Promise.all([
    listEntries(scope.company.id, parseFinanceFilters(sp, today)),
    listFinanceLookups(scope.company.id),
  ]);
  return new Response(entriesToCsv(entries, lookups), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="lancamentos-${scope.company.slug}-${today}.csv"`,
      "cache-control": "no-store",
    },
  });
}
