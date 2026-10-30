import { describe, expect, it } from "vitest";
import { fillDefaults, serviceCategoryFor } from "./fill-defaults";
import { financeImportSchema, type FinanceImportDraft } from "./schema";

const draft: FinanceImportDraft = {
  companySlug: "",
  accounts: [],
  contracts: [
    {
      key: "Renda:4", title: "Harpix Operaçao", organizationName: "Harpix Operaçao", dueDay: 10, retentionRate: 5.1,
      accountKey: null, endRule: null, adjustKind: "none", adjustRate: 0,
      lines: [{ kind: "recurring", description: "Mensal", serviceCategory: null, amount: 1000, firstMonth: "2026-11-01", months: 2 }],
    },
  ],
  recurringExpenses: [
    { key: "Despesas:9", description: "Aluguel", expenseCategory: "Aluguel", nature: "fixed", amount: 500, frequency: "monthly", dueDay: 5, startMonth: "2026-11-01", accountKey: null },
  ],
  entries: [
    { key: "Renda:4:2026-10", direction: "in", status: "settled", date: "2026-10-10", gross: 1000, retention: 51, description: "Harpix Mentoria", organizationName: "Harpix Mentoria", incomeCategory: "Vendas" },
    { key: "Despesas:9:2026-10", direction: "out", status: "settled", date: "2026-10-05", gross: 500, retention: 0, description: "Aluguel", expenseCategory: "Aluguel", nature: "fixed" },
  ],
  check: {},
  warnings: ["aviso"],
};

describe("fillDefaults", () => {
  it("aplica conta Itaú, regra confirm e categorias de serviço", () => {
    const out = fillDefaults(draft, "oxyn");
    expect(out.companySlug).toBe("oxyn");
    expect(out.accounts).toEqual([{ key: "itau", name: "Itaú PJ", bank: "Itaú" }]);
    expect(out.contracts[0]).toMatchObject({ endRule: "confirm", accountKey: "itau" });
    expect(out.contracts[0].lines[0].serviceCategory).toBe("Terceirização Vendas");
    expect(out.recurringExpenses[0].accountKey).toBe("itau");
    expect(out.entries.map((e) => e.accountKey)).toEqual(["itau", "itau"]);
    expect(out.entries[0].serviceCategory).toBe("Consultoria Vendas");
    expect(out.entries[1].serviceCategory).toBeUndefined();
    expect("warnings" in out).toBe(false);
    expect(financeImportSchema.safeParse(out).success).toBe(true);
    expect(draft.contracts[0].endRule).toBeNull(); // não altera o rascunho
  });
  it("mapa de categorias ignora acentos e espaços e falha para cliente desconhecido", () => {
    expect(serviceCategoryFor("OMNI11")).toBe("Terceirização Vendas");
    expect(serviceCategoryFor("Naia")).toBe("Terceirização Vendas");
    expect(serviceCategoryFor("Harpix Fase 1")).toBe("Consultoria Vendas");
    expect(() => serviceCategoryFor("Outro")).toThrow("Sem categoria de serviço para Outro");
  });
});
