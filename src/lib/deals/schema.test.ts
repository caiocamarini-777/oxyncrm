import { describe, expect, it } from "vitest";
import { contractDatesNeeded, contractSchema, dealStatusOf, dealItemSchema, dealSchema, lostSchema } from "./schema";

const msg = (r: { success: boolean; error?: { issues: { message: string }[] } }) => r.error?.issues[0].message;

describe("dealSchema", () => {
  it("exige título e normaliza valor", () => {
    expect(msg(dealSchema.safeParse({ title: " " }))).toBe("Informe o título.");
    const ok = dealSchema.parse({ title: "Neg", estimatedValue: "1.500,25", expectedCloseDate: "2026-12-31" });
    expect(ok.estimatedValue).toBe(1500.25);
    expect(ok.personId).toBeNull();
  });
  it("rejeita data inválida", () => {
    expect(dealSchema.safeParse({ title: "x", expectedCloseDate: "31/12/2026" }).success).toBe(false);
  });
});

describe("contractSchema", () => {
  it("setup exige mês da primeira parcela", () => {
    expect(msg(contractSchema.safeParse({ setupTotal: 100 }))).toBe("Informe o mês da primeira parcela.");
  });
  it("MRR exige início e duração", () => {
    expect(msg(contractSchema.safeParse({ mrr: 100 }))).toBe("Informe o mês de início e a duração do contrato.");
    expect(msg(contractSchema.safeParse({ mrr: 100, mrrStart: "2026-01" }))).toBe(
      "Informe o mês de início e a duração do contrato.",
    );
  });
  it("limites de parcelas e meses", () => {
    expect(contractSchema.safeParse({ setupInstallments: 61 }).success).toBe(false);
    expect(contractSchema.safeParse({ setupInstallments: 0 }).success).toBe(false);
    expect(contractSchema.safeParse({ mrr: 1, mrrStart: "2026-01", contractMonths: 121 }).success).toBe(false);
  });
  it("aceita contrato completo", () => {
    const r = contractSchema.parse({
      setupTotal: "1.000,00", setupInstallments: 2, setupFirstDue: "2026-03", mrr: "500", mrrStart: "2026-04", contractMonths: 12,
    });
    expect(r).toMatchObject({ setupTotal: 1000, mrr: 500, contractMonths: 12 });
  });
  it("vazio é válido", () => {
    expect(contractSchema.safeParse({}).success).toBe(true);
  });
});

describe("dealItemSchema", () => {
  const productId = "11111111-1111-4111-8111-111111111111";
  it("quantidade positiva e desconto até o subtotal", () => {
    expect(dealItemSchema.safeParse({ productId, quantity: 0, unitPrice: 10 }).success).toBe(false);
    expect(msg(dealItemSchema.safeParse({ productId, quantity: 2, unitPrice: 10, discount: 21 }))).toBe(
      "O desconto não pode passar do subtotal.",
    );
    expect(dealItemSchema.safeParse({ productId, quantity: 2, unitPrice: 10, discount: 20 }).success).toBe(true);
  });
});

describe("lostSchema", () => {
  it("motivo obrigatório e nota até 1.000", () => {
    expect(msg(lostSchema.safeParse({}))).toBe("Escolha um motivo.");
    expect(
      lostSchema.safeParse({ reasonId: "11111111-1111-4111-8111-111111111111", note: "x".repeat(1001) }).success,
    ).toBe(false);
  });
});

describe("contractDatesNeeded", () => {
  const none = { mrrStart: null, contractMonths: null, setupFirstDue: null };
  it("recorrente precisa de início e duração", () => {
    expect(contractDatesNeeded(none, "recurring")).toBe("mrr");
    expect(contractDatesNeeded({ ...none, mrrStart: "2026-01" }, "recurring")).toBe("mrr");
    expect(contractDatesNeeded({ ...none, mrrStart: "2026-01", contractMonths: 12 }, "recurring")).toBeNull();
  });
  it("setup precisa da primeira parcela", () => {
    expect(contractDatesNeeded(none, "setup")).toBe("setup");
    expect(contractDatesNeeded({ ...none, setupFirstDue: "2026-03" }, "setup")).toBeNull();
  });
});

describe("dealStatusOf", () => {
  it("primeiro status válido, padrão open", () => {
    expect(dealStatusOf({ status: [] })).toBe("open");
    expect(dealStatusOf({ status: ["x", "lost", "won"] })).toBe("lost");
  });
});
