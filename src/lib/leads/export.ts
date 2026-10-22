import "server-only";
import type { CompanyScope } from "@/lib/companies/pure";
import { exportInBatches } from "@/lib/records/list-helpers";
import { formatDate, formatMoney } from "@/lib/records/format";
import type { ListQuery } from "@/lib/records/types";
import { fetchLeadRows, type LeadRow } from "./queries";
import { leadAgeLabel } from "./schema";

export const LEAD_EXPORT_COLUMNS = [
  { key: "title", header: "Título" },
  { key: "person", header: "Pessoa" },
  { key: "organization", header: "Organização" },
  { key: "source", header: "Origem" },
  { key: "status", header: "Status" },
  { key: "value", header: "Valor estimado" },
  { key: "owner", header: "Responsável" },
  { key: "labels", header: "Etiquetas" },
  { key: "age", header: "Idade" },
  { key: "createdAt", header: "Criada em" },
  { key: "company", header: "Empresa" },
];

const STATUS: Record<string, string> = { open: "Aberto", disqualified: "Desqualificado", archived: "Arquivado" };

export function leadExportRow(r: LeadRow): Record<string, unknown> {
  return {
    title: r.title,
    person: r.person?.name ?? "",
    organization: r.organization?.name ?? "",
    source: r.sourceName ?? "",
    status: STATUS[r.status] ?? r.status,
    value: r.estimatedValue === null ? "" : formatMoney(r.estimatedValue),
    owner: r.ownerName,
    labels: r.labels.map((l) => l.name).join(", "),
    age: leadAgeLabel(r.createdAt),
    createdAt: formatDate(r.createdAt),
    company: r.companyName,
  };
}

export function exportLeads(
  scope: CompanyScope,
  query: ListQuery,
  companyIds: string[],
): Promise<Record<string, unknown>[]> {
  return exportInBatches((range) => fetchLeadRows(scope, query, range, companyIds), leadExportRow);
}
