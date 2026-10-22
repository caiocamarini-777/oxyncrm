import "server-only";
import type { CompanyScope } from "@/lib/companies/pure";
import { formatCnpj } from "@/lib/companies/cnpj";
import { exportInBatches } from "@/lib/records/list-helpers";
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

export function exportOrganizations(
  scope: CompanyScope,
  query: ListQuery,
  companyIds: string[],
): Promise<Record<string, unknown>[]> {
  return exportInBatches((range) => fetchOrganizationRows(scope, query, range, companyIds), organizationExportRow);
}
