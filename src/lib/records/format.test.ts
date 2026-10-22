import { describe, expect, it } from "vitest";
import { formatDate, formatMoney, formatPhone, normalizeEmail, normalizePhone } from "./format";

describe("format", () => {
  it("formatDate", () => {
    expect(formatDate("2026-10-21T10:00:00Z")).toBe("21/10/2026");
    expect(formatDate("2026-10-21")).toBe("21/10/2026");
    expect(formatDate(null)).toBe("");
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
