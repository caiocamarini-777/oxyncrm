import "server-only";
import type { CompanyScope } from "@/lib/companies/pure";
import { formatCnpj } from "@/lib/companies/cnpj";
import { formatDate } from "@/lib/records/format";
import type { ListQuery } from "@/lib/records/types";
import { fetchOrganizationRows, type OrganizationRow } from "./queries";

export const ORGANIZATION_EXPORT_COLUMNS = [
  { key: "name", header: "Nome" },
  { key: "cnpj", header: "CNPJ" },
  { key: "domain", header: "Domínio" },
  { key: "segment", header: "Segmento" },
  { key: "owner", header: "Responsável" },
  { key: "persons", header: "Pessoas vinculadas" },
  { key: "labels", header: "Etiquetas" },
  { key: "createdAt", header: "Criada em" },
  { key: "company", header: "Empresa" },
];

export function organizationExportRow(r: OrganizationRow): Record<string, unknown> {
  return {
    name: r.name,
    cnpj: r.cnpj ? formatCnpj(r.cnpj) : "",
    domain: r.domain ?? "",
    segment: r.segment ?? "",
    owner: r.ownerName,
    persons: r.personsCount,
    labels: r.labels.map((l) => l.name).join(", "),
    createdAt: formatDate(r.createdAt),
    company: r.companyName,
  };
}

const BATCH = 1000;
const MAX_ROWS = 50_000;

export async function exportOrganizations(
  scope: CompanyScope,
  query: ListQuery,
  companyIds: string[],
): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  for (let from = 0; from < MAX_ROWS; from += BATCH) {
    const { rows } = await fetchOrganizationRows(scope, query, { from, to: from + BATCH - 1 }, companyIds);
    out.push(...rows.map(organizationExportRow));
    if (rows.length < BATCH) break;
  }
  return out;
}
