import "server-only";
import type { CompanyScope } from "@/lib/companies/pure";
import { leadAgeLabel } from "@/lib/leads/schema";
import { exportInBatches } from "@/lib/records/list-helpers";
import { formatDate, formatMoney } from "@/lib/records/format";
import { fetchDealRows, type DealListQuery, type DealRow } from "./queries";

export const DEAL_EXPORT_COLUMNS = [
  { key: "title", header: "Título" },
  { key: "organization", header: "Organização" },
  { key: "person", header: "Pessoa" },
  { key: "stage", header: "Etapa" },
  { key: "status", header: "Status" },
  { key: "total", header: "Valor total" },
  { key: "mrr", header: "MRR" },
  { key: "setup", header: "Setup" },
  { key: "closeDate", header: "Data de fechamento" },
  { key: "owner", header: "Responsável" },
  { key: "labels", header: "Etiquetas" },
  { key: "age", header: "Idade" },
  { key: "createdAt", header: "Criado em" },
  { key: "company", header: "Empresa" },
];

const STATUS: Record<string, string> = { open: "Aberto", won: "Ganho", lost: "Perdido" };

export function dealExportRow(r: DealRow): Record<string, unknown> {
  return {
    title: r.title,
    organization: r.organization?.name ?? "",
    person: r.person?.name ?? "",
    stage: r.stageName,
    status: STATUS[r.status] ?? r.status,
    total: formatMoney(r.totalValue),
    mrr: formatMoney(r.mrr),
    setup: formatMoney(r.setupTotal),
    closeDate: r.expectedCloseDate ? formatDate(r.expectedCloseDate) : "",
    owner: r.ownerName,
    labels: r.labels.map((l) => l.name).join(", "),
    age: leadAgeLabel(r.createdAt),
    createdAt: formatDate(r.createdAt),
    company: r.companyName,
  };
}

export function exportDeals(
  scope: CompanyScope,
  query: DealListQuery,
  companyIds: string[],
): Promise<Record<string, unknown>[]> {
  return exportInBatches((range) => fetchDealRows(scope, query, range, companyIds), dealExportRow);
}
