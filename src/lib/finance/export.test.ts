import { describe, expect, it } from "vitest";
import type { EntryRow } from "./calc";
import { entriesToCsv, FINANCE_EXPORT_HEADER } from "./export";

const lookups = {
  clients: [{ id: "c1", name: "Acme" }],
  serviceCategories: [{ id: "s1", name: "Consultoria Vendas" }],
  incomeCategories: [],
  expenseCategories: [{ id: "x1", name: "Tecnologia" }],
};

const row = (o: Partial<EntryRow>): EntryRow => ({
  id: "e1",
  direction: "in",
  status: "open",
  dueDate: "2026-10-29",
  settledOn: null,
  competence: "2026-10-01",
  gross: 1234.5,
  retention: 0,
  amount: 1234.5,
  settledAmount: null,
  accountId: null,
  organizationId: "c1",
  serviceCategoryId: "s1",
  expenseCategoryId: null,
  nature: null,
  description: "Mensalidade",
  incomeCategoryId: null,
  locked: false,
  originalGross: null,
  originalDueDate: null,
  ...o,
});

describe("entriesToCsv", () => {
  it("começa com BOM e o cabeçalho exato", () => {
    const csv = entriesToCsv([], lookups);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.slice(1)).toBe(
      "Vencimento;Tipo;Descrição;Cliente;Categoria;Natureza;Valor bruto;Retenção;Valor;Status;Liquidado em;Valor liquidado",
    );
    expect(FINANCE_EXPORT_HEADER).toHaveLength(12);
  });

  it("usa vírgula decimal: 1234.5 vira 1234,50", () => {
    const lines = entriesToCsv([row({})], lookups).split("\r\n");
    expect(lines[1]).toBe("29/10/2026;Entrada;Mensalidade;Acme;Consultoria Vendas;;1234,50;0,00;1234,50;Em aberto;;");
  });

  it("coloca entre aspas a descrição com ponto e vírgula", () => {
    const lines = entriesToCsv([row({ description: "a;b" })], lookups).split("\r\n");
    expect(lines[1]).toContain(';"a;b";');
  });

  it("saída liquidada mostra natureza, categoria de despesa e valor liquidado", () => {
    const r = row({
      direction: "out", status: "settled", settledOn: "2026-10-30", settledAmount: 99.9, gross: 100, amount: 100,
      serviceCategoryId: null, expenseCategoryId: "x1", nature: "fixed", organizationId: null,
    });
    expect(entriesToCsv([r], lookups).split("\r\n")[1]).toBe(
      "29/10/2026;Saída;Mensalidade;;Tecnologia;Fixa;100,00;0,00;100,00;Liquidado;30/10/2026;99,90",
    );
  });
});
