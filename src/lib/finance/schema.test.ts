import { describe, expect, it } from "vitest";
import {
  accountSchema,
  balanceSnapshotSchema,
  contractLineSchema,
  contractSchema,
  expenseCategorySchema,
  recurringExpenseSchema,
  entryInputSchema,
  settleSchema,
} from "./schema";

const CAT = "00000000-0000-4000-8000-000000000001";
const base = { dueDate: "2026-11-10", gross: "1.234,56", description: "Aluguel" };

describe("entryInputSchema", () => {
  it("saída sem categoria da despesa falha", () => {
    const r = entryInputSchema.safeParse({ ...base, direction: "out", nature: "fixed" });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0].message).toBe("Escolha a categoria da despesa.");
  });
  it("saída sem natureza falha", () => {
    expect(entryInputSchema.safeParse({ ...base, direction: "out", expenseCategoryId: CAT }).success).toBe(false);
  });
  it("entrada exige categoria de receita ou de serviço", () => {
    expect(entryInputSchema.safeParse({ ...base, direction: "in" }).success).toBe(false);
    expect(entryInputSchema.safeParse({ ...base, direction: "in", serviceCategoryId: CAT }).success).toBe(true);
  });
  it("converte valor em formato BRL", () => {
    const r = entryInputSchema.parse({ ...base, direction: "in", incomeCategoryId: CAT });
    expect(r.gross).toBe(1234.56);
  });
  it("rejeita valor zero, data inválida e descrição vazia", () => {
    const ok = { ...base, direction: "in", incomeCategoryId: CAT };
    expect(entryInputSchema.safeParse({ ...ok, gross: "0" }).success).toBe(false);
    expect(entryInputSchema.safeParse({ ...ok, dueDate: "2026-02-30" }).success).toBe(false);
    expect(entryInputSchema.safeParse({ ...ok, description: " " }).success).toBe(false);
  });
});

describe("settleSchema", () => {
  it("ids vazio falha", () => {
    expect(settleSchema.safeParse({ ids: [], settledOn: "2026-11-10" }).success).toBe(false);
  });
  it("valor só com um id", () => {
    const two = { ids: [CAT, "00000000-0000-4000-8000-000000000002"], settledOn: "2026-11-10", amount: "950,00" };
    expect(settleSchema.safeParse(two).success).toBe(false);
    const one = settleSchema.parse({ ids: [CAT], settledOn: "2026-11-10", amount: "950,00" });
    expect(one.amount).toBe(950);
    expect(settleSchema.parse({ ids: [CAT], settledOn: "2026-11-10" }).amount).toBeNull();
  });
});

const msg = (r: { success: boolean; error?: { issues: { message: string }[] } }) => r.error?.issues[0].message;

describe("contractSchema", () => {
  const base = { title: "Contrato", retentionRate: "0", adjustKind: "none", adjustRate: "0" };
  it("reajuste por índice sem índice falha", () => {
    const r = contractSchema.safeParse({ ...base, adjustKind: "index" });
    expect(r.success).toBe(false);
    expect(msg(r)).toBe("Informe o índice.");
    expect(contractSchema.safeParse({ ...base, adjustKind: "index", adjustIndex: "IPCA" }).success).toBe(true);
  });
  it("dia de vencimento de 1 a 31 e retenção de 0 a 100", () => {
    expect(contractSchema.safeParse({ ...base, dueDay: 32 }).success).toBe(false);
    expect(contractSchema.safeParse({ ...base, retentionRate: "101" }).success).toBe(false);
    expect(contractSchema.parse({ ...base, dueDay: "10", retentionRate: "11,5" })).toMatchObject({ dueDay: 10, retentionRate: 11.5 });
  });
});

describe("contractLineSchema", () => {
  const rec = { kind: "recurring", description: "Mensal", amount: "5.000,00", firstMonth: "2026-11", months: 12 };
  it("recorrente sem duração falha", () => {
    const r = contractLineSchema.safeParse({ ...rec, months: undefined });
    expect(r.success).toBe(false);
    expect(msg(r)).toBe("Informe a duração em meses.");
  });
  it("firstMonth YYYY-MM vira o primeiro dia do mês", () => {
    const r = contractLineSchema.parse(rec);
    expect(r.firstMonth).toBe("2026-11-01");
    expect(r.amount).toBe(5000);
    expect(r.installments).toBe(1);
  });
  it("setup exige valor e aceita parcelas", () => {
    expect(contractLineSchema.safeParse({ kind: "setup", description: "Setup", firstMonth: "2026-11" }).success).toBe(false);
    expect(contractLineSchema.parse({ kind: "setup", description: "Setup", amount: "900", firstMonth: "2026-11", installments: 3 }).installments).toBe(3);
  });
  it("comissão exige duração e ao menos um percentual, sem valor", () => {
    const c = { kind: "commission", description: "Comissão", firstMonth: "2026-11", months: 6 };
    const r = contractLineSchema.safeParse(c);
    expect(r.success).toBe(false);
    expect(msg(r)).toBe("Informe ao menos um percentual.");
    const ok = contractLineSchema.parse({ ...c, recurringRate: "10", estimatedMonthly: "2.000,00", amount: "99" });
    expect(ok.recurringRate).toBe(10);
    expect(ok.estimatedMonthly).toBe(2000);
    expect(ok.amount).toBeNull();
  });
});

describe("recurringExpenseSchema", () => {
  const base = { description: "Aluguel", expenseCategoryId: CAT, nature: "fixed", amount: "4.674,11", dueDay: 1, startMonth: "2026-11" };
  it("converte mês e valor e aplica padrões", () => {
    const r = recurringExpenseSchema.parse(base);
    expect(r).toMatchObject({ amount: 4674.11, startMonth: "2026-11-01", frequency: "monthly", adjustRate: 0, endMonth: null });
  });
  it("exige categoria e dia válido", () => {
    expect(recurringExpenseSchema.safeParse({ ...base, expenseCategoryId: "" }).success).toBe(false);
    expect(recurringExpenseSchema.safeParse({ ...base, dueDay: 0 }).success).toBe(false);
  });
});

describe("contas e categorias", () => {
  it("nome obrigatório", () => {
    expect(accountSchema.safeParse({ name: " " }).success).toBe(false);
    expect(expenseCategorySchema.safeParse({ name: "X", defaultNature: "fixed" }).success).toBe(true);
    expect(expenseCategorySchema.safeParse({ name: "X" }).success).toBe(false);
  });
  it("saldo aceita zero e negativo", () => {
    expect(balanceSnapshotSchema.parse({ asOf: "2026-11-01", balance: "-1.500,00" }).balance).toBe(-1500);
    expect(balanceSnapshotSchema.safeParse({ asOf: "2026-11-01", balance: "" }).success).toBe(false);
  });
});
