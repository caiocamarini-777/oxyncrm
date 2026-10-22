import "server-only";
import type { CompanyScope } from "@/lib/companies/pure";
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

const BATCH = 1000;
const MAX_ROWS = 50_000;

export async function exportPersons(
  scope: CompanyScope,
  query: ListQuery,
  companyIds: string[],
): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  for (let from = 0; from < MAX_ROWS; from += BATCH) {
    const { rows } = await fetchPersonRows(scope, query, { from, to: from + BATCH - 1 }, companyIds);
    out.push(...rows.map(personExportRow));
    if (rows.length < BATCH) break;
  }
  return out;
}
