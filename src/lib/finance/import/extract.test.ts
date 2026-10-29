import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { extractWorkbook } from "./extract";
import type { FinanceImportDraft } from "./schema";

let draft: FinanceImportDraft;

beforeAll(async () => {
  draft = await extractWorkbook(readFileSync(resolve(__dirname, "fixtures/mini.xlsx")));
});

const entry = (key: string) => draft.entries.find((e) => e.key === key);

describe("extractWorkbook", () => {
  it("despesa fixa conferida vira entries liquidadas fixed, uma por mês", () => {
    const rows = draft.entries.filter((e) => e.key.startsWith("Despesas:5:"));
    expect(rows.map((e) => e.key)).toEqual(["Despesas:5:2026-01", "Despesas:5:2026-02"]);
    for (const e of rows) {
      expect(e).toMatchObject({
        direction: "out",
        status: "settled",
        gross: 100,
        nature: "fixed",
        expenseCategory: "Pessoas",
      });
    }
    expect(entry("Despesas:5:2026-01")?.date).toBe("2026-01-10");
  });

  it("no mês conferido até 26/10, a linha do dia 30 sai em aberto", () => {
    expect(entry("Despesas:6:2026-10")).toMatchObject({ status: "open", date: "2026-10-30", gross: 200 });
  });

  it("obras ficam non_recurring", () => {
    expect(entry("Despesas:12:2026-08")).toMatchObject({
      nature: "non_recurring",
      status: "settled",
      expenseCategory: "Escritório/administração geral",
    });
  });

  it("impostos retidos na fonte viram retenção da entrada e taxa do contrato", () => {
    expect(entry("Renda:4:2026-09")).toMatchObject({
      direction: "in",
      gross: 100,
      retention: 10,
      status: "settled",
      incomeCategory: "Vendas",
      organizationName: "Cliente X",
    });
    expect(draft.entries.some((e) => e.description.startsWith("Impostos retidos"))).toBe(false);
    const c = draft.contracts.find((c) => c.title === "Cliente X");
    expect(c).toMatchObject({ retentionRate: 10, endRule: null, dueDay: 10 });
    expect(c?.lines).toEqual([
      expect.objectContaining({ kind: "recurring", amount: 100, firstMonth: "2026-11-01", months: 2 }),
    ]);
  });

  it("linha com um único mês vira setup", () => {
    const c = draft.contracts.find((c) => c.title === "Cliente Y Setup");
    expect(c?.lines).toEqual([expect.objectContaining({ kind: "setup", amount: 1000, firstMonth: "2026-11-01" })]);
  });

  it("nov = dez vira despesa recorrente mensal a partir de nov", () => {
    expect(draft.recurringExpenses).toEqual([
      expect.objectContaining({
        description: "Aluguel",
        amount: 500,
        frequency: "monthly",
        startMonth: "2026-11-01",
        dueDay: 5,
        nature: "fixed",
        expenseCategory: "Escritório/administração geral",
      }),
    ]);
    // coberto pela recorrente: não vira entry
    expect(entry("Despesas:10:2026-11")).toBeUndefined();
  });

  it("valor futuro que não se repete vira entry em aberto, com aviso de dia ausente", () => {
    expect(entry("Despesas:13:2026-11")).toMatchObject({ status: "open", gross: 100, date: "2026-11-01" });
    expect(entry("Despesas:13:2026-12")).toMatchObject({ status: "open", gross: 120 });
    expect(draft.warnings.some((w) => w.includes("Internet"))).toBe(true);
  });

  it("grupo da aba Renda sem \"Total mensal:\" também abre um grupo novo", () => {
    const e = entry("Renda:8:2026-03");
    expect(e).toMatchObject({ direction: "in", gross: 1.5, incomeCategory: "Investimentos/rendimentos", status: "settled" });
    expect(e?.organizationName).toBeUndefined();
  });

  it("check soma entradas líquidas e saídas por mês a partir do primeiro não conferido", () => {
    expect(draft.check).toEqual({
      "2026-11": { in: 1090, out: 600 },
      "2026-12": { in: 90, out: 620 },
    });
  });
});
