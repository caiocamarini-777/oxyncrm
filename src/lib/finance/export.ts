import { toCsv } from "@/lib/records/csv";
import { formatDate } from "@/lib/records/format";
import type { EntryRow } from "./calc";

export const FINANCE_EXPORT_HEADER = [
  "Vencimento",
  "Tipo",
  "Descrição",
  "Cliente",
  "Categoria",
  "Natureza",
  "Valor bruto",
  "Retenção",
  "Valor",
  "Status",
  "Liquidado em",
  "Valor liquidado",
] as const;

const KEYS = ["due", "type", "description", "client", "category", "nature", "gross", "retention", "amount", "status", "settledOn", "settledAmount"];

export const NATURE_LABEL: Record<string, string> = { fixed: "Fixa", variable: "Variável", non_recurring: "Não recorrente" };
export const STATUS_LABEL: Record<string, string> = { open: "Em aberto", settled: "Liquidado", cancelled: "Cancelado" };

type Named = { id: string; name: string }[];
export type ExportLookups = {
  clients: Named;
  serviceCategories: Named;
  incomeCategories: Named;
  expenseCategories: Named;
};

/** 1234.5 -> "1234,50" (sem milhar, para o Excel BR ler como número). */
const dec = (v: number) => v.toFixed(2).replace(".", ",");

/** CSV dos lançamentos: `;`, vírgula decimal e BOM UTF-8 (mesmo padrão das outras exportações). */
export function entriesToCsv(entries: EntryRow[], lookups: ExportLookups): string {
  const name = (list: Named, id: string | null) => (id ? (list.find((x) => x.id === id)?.name ?? "") : "");
  const rows = entries.map((e) => ({
    due: formatDate(e.dueDate),
    type: e.direction === "in" ? "Entrada" : "Saída",
    description: e.description ?? "",
    client: name(lookups.clients, e.organizationId),
    category:
      e.direction === "in"
        ? name(lookups.serviceCategories, e.serviceCategoryId) || name(lookups.incomeCategories, e.incomeCategoryId)
        : name(lookups.expenseCategories, e.expenseCategoryId),
    nature: e.nature ? NATURE_LABEL[e.nature] : "",
    gross: dec(e.gross),
    retention: dec(e.retention),
    amount: dec(e.amount),
    status: STATUS_LABEL[e.status] ?? e.status,
    settledOn: formatDate(e.settledOn),
    settledAmount: e.settledAmount === null ? "" : dec(e.settledAmount),
  }));
  return toCsv(
    KEYS.map((key, i) => ({ key, header: FINANCE_EXPORT_HEADER[i] })),
    rows,
  );
}
