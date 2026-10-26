import "server-only";
import type { CompanyScope } from "@/lib/companies/pure";
import { exportInBatches } from "@/lib/records/list-helpers";
import { formatDate, formatPhone } from "@/lib/records/format";
import type { ListQuery } from "@/lib/records/types";
import { fetchPersonRows, type PersonRow } from "./queries";

export const PERSON_EXPORT_COLUMNS = [
  { key: "name", header: "Nome" },
  { key: "jobTitle", header: "Cargo" },
  { key: "organization", header: "Organização" },
  { key: "email", header: "E-mail principal" },
  { key: "phone", header: "Telefone principal" },
  { key: "owner", header: "Responsável" },
  { key: "labels", header: "Etiquetas" },
  { key: "createdAt", header: "Criada em" },
  { key: "company", header: "Empresa" },
];

export function personExportRow(r: PersonRow): Record<string, unknown> {
  return {
    name: r.fullName,
    jobTitle: r.jobTitle ?? "",
    organization: r.organization?.name ?? "",
    email: r.primaryEmail ?? "",
    phone: r.primaryPhone ? formatPhone(r.primaryPhone) : "",
    owner: r.ownerName,
    labels: r.labels.map((l) => l.name).join(", "),
    createdAt: formatDate(r.createdAt),
    company: r.companyName,
  };
}

export function exportPersons(
  scope: CompanyScope,
  query: ListQuery,
  companyIds: string[],
): Promise<Record<string, unknown>[]> {
  return exportInBatches((range) => fetchPersonRows(scope, query, range, companyIds), personExportRow);
}
