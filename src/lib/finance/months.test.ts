import { describe, expect, it } from "vitest";
import { addMonths, contractVigencia, monthsBetween, vigenciaLabel } from "./months";

describe("monthsBetween", () => {
  it("conta início e fim inclusive", () => {
    expect(monthsBetween("2026-11", "2027-10")).toBe(12);
    expect(monthsBetween("2026-11-01", "2026-11-01")).toBe(1);
    expect(monthsBetween("2026-12", "2027-02")).toBe(3);
  });
  it("devolve valor menor que 1 quando o fim é antes do início", () => {
    expect(monthsBetween("2026-11", "2026-10")).toBe(0);
  });
});

describe("addMonths", () => {
  it("devolve o último mês da vigência", () => {
    expect(addMonths("2026-11", 11)).toBe("2027-10");
    expect(addMonths("2026-01-01", 0)).toBe("2026-01");
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
