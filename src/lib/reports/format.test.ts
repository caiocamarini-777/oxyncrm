import { describe, expect, it } from "vitest";
import { formatCell } from "./format";

describe("formatCell", () => {
  it("moeda BRL", () => {
    expect(formatCell(1234.5, "currency")).toMatch(/R\$\s1\.234,50/);
  });
  it("moeda e dias nulos ou NaN viram 0", () => {
    expect(formatCell(null, "currency")).toBe("0");
    expect(formatCell(Number.NaN, "currency")).toBe("0");
    expect(formatCell(null, "days")).toBe("0");
    expect(formatCell(Number.NaN, "days")).toBe("0");
    expect(formatCell(undefined, "days")).toBe("0");
  });
  it("porcentagem com uma casa", () => {
    expect(formatCell(25, "percent")).toBe("25,0%");
    expect(formatCell(Number.NaN, "percent")).toBe("0,0%");
    expect(formatCell(null, "percent")).toBe("0,0%");
  });
  it("número", () => {
    expect(formatCell(null, "number")).toBe("0");
    expect(formatCell(1234567, "number")).toBe("1.234.567");
    expect(formatCell(2.5, "number")).toBe("2,5");
    expect(formatCell("12", "number")).toBe("12");
  });
  it("dias", () => {
    expect(formatCell(1, "days")).toBe("1 dia");
    expect(formatCell(3.5, "days")).toBe("3,5 dias");
    expect(formatCell(0, "days")).toBe("0 dias");
  });
  it("mês", () => {
    expect(formatCell("2026-10-01", "month")).toBe("out/2026");
    expect(formatCell("2026-01-15", "month")).toBe("jan/2026");
    expect(formatCell(null, "month")).toBe("");
    expect(formatCell("lixo", "month")).toBe("lixo");
  });
  it("data dd/mm/aaaa em São Paulo", () => {
    expect(formatCell("2026-10-05", "date")).toBe("05/10/2026");
    // 02:00 UTC ainda é o dia anterior em São Paulo (UTC-3)
    expect(formatCell("2026-10-06T02:00:00Z", "date")).toBe("05/10/2026");
    expect(formatCell(null, "date")).toBe("");
  });
  it("texto", () => {
    expect(formatCell("Ana", "text")).toBe("Ana");
    expect(formatCell(null, "text")).toBe("");
    expect(formatCell(7, "text")).toBe("7");
  });
});
