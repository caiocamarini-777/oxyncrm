import { describe, expect, it } from "vitest";
import { shiftMonth, contractVigencia, monthCount, vigenciaLabel } from "./months";

describe("monthCount", () => {
  it("conta início e fim inclusive", () => {
    expect(monthCount("2026-11", "2027-10")).toBe(12);
    expect(monthCount("2026-11-01", "2026-11-01")).toBe(1);
    expect(monthCount("2026-12", "2027-02")).toBe(3);
  });
  it("devolve valor menor que 1 quando o fim é antes do início", () => {
    expect(monthCount("2026-11", "2026-10")).toBe(0);
  });
});

describe("shiftMonth", () => {
  it("devolve o último mês da vigência", () => {
    expect(shiftMonth("2026-11", 11)).toBe("2027-10");
    expect(shiftMonth("2026-01-01", 0)).toBe("2026-01");
  });
});

describe("contractVigencia", () => {
  it("vai do menor início ao maior fim das linhas", () => {
    const v = contractVigencia([
      { kind: "recurring", firstMonth: "2026-11-01", installments: 1, months: 12 },
      { kind: "setup", firstMonth: "2026-10-01", installments: 3, months: null },
    ]);
    expect(v).toEqual({ start: "2026-10", end: "2027-10" });
    expect(vigenciaLabel(v)).toBe("Vigência: 10/2026 – 10/2027");
  });
  it("é nula sem linhas", () => {
    expect(contractVigencia([])).toBeNull();
    expect(vigenciaLabel(null)).toBe("Vigência: —");
  });
});
