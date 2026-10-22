import { describe, expect, it } from "vitest";
import { formatDate, formatMoney, formatMoneyCompact, formatPhone, normalizeEmail, normalizePhone } from "./format";

describe("format", () => {
  it("formatDate", () => {
    expect(formatDate("2026-10-21T10:00:00Z")).toBe("21/10/2026");
    expect(formatDate("2026-10-21")).toBe("21/10/2026");
    expect(formatDate(null)).toBe("");
  });
  it("formatMoneyCompact", () => {
    const f = (v: number) => formatMoneyCompact(v).replace(/\u00a0/g, " ");
    expect(f(0)).toBe("R$ 0");
    expect(f(950.4)).toBe("R$ 950");
    expect(f(3500)).toBe("R$ 3,5 mil");
    expect(f(125000)).toBe("R$ 125 mil");
    expect(f(1_500_000)).toBe("R$ 1,5 mi");
  });
  it("formatMoney", () => {
    expect(formatMoney(1234.5).replace(/ /g, " ")).toBe("R$ 1.234,50");
    expect(formatMoney(null)).toBe("");
  });
  it("formatPhone", () => {
    expect(formatPhone("11988887777")).toBe("(11) 98888-7777");
    expect(formatPhone("1133334444")).toBe("(11) 3333-4444");
    expect(formatPhone("123")).toBe("123");
  });
  it("normalizePhone e normalizeEmail", () => {
    expect(normalizePhone("(11) 98888-7777")).toBe("11988887777");
    expect(normalizePhone("+55 11 98888-7777")).toBe("11988887777");
    expect(normalizePhone("55 11 3333-4444")).toBe("1133334444");
    expect(normalizePhone("55999990000")).toBe("55999990000");
    expect(normalizeEmail("  Ana@Exemplo.COM ")).toBe("ana@exemplo.com");
  });
});

import { parseBRL } from "./format";

describe("parseBRL", () => {
  it("interpreta formatos BRL", () => {
    expect(parseBRL("1.500,25")).toBe(1500.25);
    expect(parseBRL("1500,5")).toBe(1500.5);
    expect(parseBRL("1500.25")).toBe(1500.25);
    expect(parseBRL(" ")).toBeNull();
    expect(parseBRL("abc")).toBeNaN();
  });

  it("sem vírgula, pontos em grupos de três são milhar", () => {
    expect(parseBRL("30.000")).toBe(30000);
    expect(parseBRL("1.500")).toBe(1500);
    expect(parseBRL("1.234.567")).toBe(1234567);
    expect(parseBRL("-1.500")).toBe(-1500);
  });

  it("sem vírgula, outros pontos continuam decimais", () => {
    expect(parseBRL("1.5")).toBe(1.5);
    expect(parseBRL("1500.25")).toBe(1500.25);
    expect(parseBRL("12.50")).toBe(12.5);
    expect(parseBRL("1.2345")).toBe(1.2345);
  });
});
