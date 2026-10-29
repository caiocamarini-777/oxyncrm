import { describe, expect, it } from "vitest";
import { saleSchema } from "./sales-schema";

const LINE = "11111111-1111-4111-8111-111111111111";
const base = {
  contractLineId: LINE,
  buyer: "Cliente Final",
  soldOn: "2026-10-29",
  setupValue: "3.000,00",
  setupInstallments: "1",
  setupFirstMonth: "2026-10",
  recurringValue: "",
  recurringStart: "",
  recurringMonths: "",
  note: "",
};

function firstMessage(input: unknown) {
  const r = saleSchema.safeParse(input);
  return r.success ? null : r.error.issues[0].message;
}

describe("saleSchema", () => {
  it("aceita venda só com setup e normaliza os campos", () => {
    const r = saleSchema.parse(base);
    expect(r).toEqual({
      contractLineId: LINE,
      buyer: "Cliente Final",
      soldOn: "2026-10-29",
      setupValue: 3000,
      setupInstallments: 1,
      setupFirstMonth: "2026-10-01",
      recurringValue: 0,
      recurringStart: null,
      recurringMonths: null,
      note: null,
    });
  });
  it("aceita venda só com recorrência", () => {
    const r = saleSchema.parse({
      ...base,
      setupValue: "0",
      setupFirstMonth: "",
      recurringValue: "500,50",
      recurringStart: "2026-11",
      recurringMonths: "12",
    });
    expect(r.recurringValue).toBe(500.5);
    expect(r.recurringStart).toBe("2026-11-01");
    expect(r.recurringMonths).toBe(12);
    expect(r.setupFirstMonth).toBeNull();
  });
  it("exige setup ou recorrência", () => {
    expect(firstMessage({ ...base, setupValue: "0", setupFirstMonth: "" })).toBe(
      "Informe o valor do setup ou da recorrência.",
    );
    expect(firstMessage({ ...base, setupValue: "", setupFirstMonth: "" })).toBe(
      "Informe o valor do setup ou da recorrência.",
    );
  });
  it("exige o mês do primeiro recebimento do setup", () => {
    expect(firstMessage({ ...base, setupFirstMonth: "" })).toBe("Informe o mês do primeiro recebimento do setup.");
  });
  it("exige início e meses da recorrência", () => {
    const rec = { ...base, setupValue: "0", setupFirstMonth: "", recurringValue: "100" };
    expect(firstMessage(rec)).toBe("Informe início e meses da recorrência.");
    expect(firstMessage({ ...rec, recurringStart: "2026-11" })).toBe("Informe início e meses da recorrência.");
    expect(firstMessage({ ...rec, recurringMonths: "6" })).toBe("Informe início e meses da recorrência.");
  });
  it("valida limites", () => {
    expect(firstMessage({ ...base, buyer: "  " })).toBeTruthy();
    expect(firstMessage({ ...base, buyer: "x".repeat(121) })).toBeTruthy();
    expect(firstMessage({ ...base, setupInstallments: "61" })).toBeTruthy();
    expect(firstMessage({ ...base, setupInstallments: "0" })).toBeTruthy();
    expect(firstMessage({ ...base, setupValue: "-1" })).toBeTruthy();
    expect(firstMessage({ ...base, soldOn: "2026-02-30" })).toBeTruthy();
    expect(firstMessage({ ...base, contractLineId: "x" })).toBeTruthy();
    expect(firstMessage({ ...base, note: "x".repeat(501) })).toBeTruthy();
    expect(firstMessage({ ...base, recurringValue: "10", recurringStart: "2026-11", recurringMonths: "121" })).toBeTruthy();
  });
});
