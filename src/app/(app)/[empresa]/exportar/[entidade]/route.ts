import { type NextRequest } from "next/server";
import { getCurrentProfile } from "@/lib/auth/session";
import { getAccessibleCompanies, resolveCompanyScope } from "@/lib/companies/scope";
import { EXPORTERS, EXPORT_SEGMENTS } from "@/lib/records/export";
import { getEntityPermissions } from "@/lib/records/permissions";
import { parseListQuery } from "@/lib/records/query";
import { toCsv } from "@/lib/records/csv";

const text = (status: number, body: string) =>
  new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ empresa: string; entidade: string }> },
) {
  const { empresa, entidade } = await params;
  const profile = await getCurrentProfile();
  if (!profile || !profile.active) return text(401, "Sessão expirada.");

  const entity = EXPORT_SEGMENTS[entidade];
  const exporter = entity ? EXPORTERS[entity] : undefined;
  if (!entity || !exporter) return text(404, "Não encontrado.");

  const companies = await getAccessibleCompanies();
  const scope = resolveCompanyScope(empresa, companies, profile.isSuperAdmin);
  if (!scope) return text(404, "Não encontrado.");

  const scoped = scope.kind === "all" ? companies : [scope.company];
  const allowed: string[] = [];
  for (const c of scoped) {
    if ((await getEntityPermissions(c.id, entity)).export) allowed.push(c.id);
  }
  if (allowed.length === 0) return text(403, "Você não tem permissão para exportar.");

  const query = (exporter.parseQuery ?? parseListQuery)(request.nextUrl.searchParams, exporter.allowedSorts);
  const rows = await exporter.fetchRows(scope, query, allowed);
  const columns = scope.kind === "all" ? exporter.columns : exporter.columns.filter((c) => c.key !== "company");
  const csv = toCsv(columns, rows);
  const date = new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
  const slug = scope.kind === "all" ? "todas" : scope.company.slug;
  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${exporter.filePrefix}-${slug}-${date}.csv"`,
      "cache-control": "no-store",
    },
  });
}
