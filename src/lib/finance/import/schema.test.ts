import { describe, expect, it } from "vitest";
import { financeImportSchema } from "./schema";

const base = {
  companySlug: "oxyn",
  accounts: [{ key: "itau", name: "Itaú PJ", bank: "Itaú" }],
  contracts: [
    {
      key: "Renda:4",
      title: "Cliente X",
      organizationName: "Cliente X",
      dueDay: 10,
      retentionRate: 10,
      accountKey: "itau",
      endRule: null,
      adjustKind: "none",
      adjustRate: 0,
      lines: [
        {
          kind: "recurring",
          description: "Mensalidade",
          serviceCategory: "Consultoria Vendas",
          amount: 100,
          firstMonth: "2026-11-01",
          months: 2,
        },
      ],
    },
  ],
  recurringExpenses: [],
  entries: [],
  check: {},
};

describe("financeImportSchema", () => {
  it("contrato sem regra de fim de vigência falha com a mensagem do contrato", () => {
    const r = financeImportSchema.safeParse(base);
    expect(r.success).toBe(false);
    expect(r.error?.issues.map((i) => i.message)).toContain(
      "Defina a regra de fim de vigência do contrato Cliente X.",
    );
  });

  it("aceita o contrato com a regra preenchida", () => {
    const r = financeImportSchema.safeParse({
      ...base,
      contracts: [{ ...base.contracts[0], endRule: "confirm" }],
    });
    expect(r.success).toBe(true);
  });
});
