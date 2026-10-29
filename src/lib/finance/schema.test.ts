import { describe, expect, it } from "vitest";
import { entryInputSchema, settleSchema } from "./schema";

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
