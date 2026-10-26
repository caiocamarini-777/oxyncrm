import { describe, expect, it } from "vitest";
import { buildRevenueSchedule, contractValue } from "./revenue";

const base = { setupTotal: 0, setupInstallments: 1, setupFirstDue: null, mrr: 0, mrrStart: null, contractMonths: null };

describe("buildRevenueSchedule", () => {
  it("março a maio: setup em 3 parcelas e MRR a partir de abril", () => {
    const s = buildRevenueSchedule({
      setupTotal: 30000, setupInstallments: 3, setupFirstDue: "2026-03", mrr: 5000, mrrStart: "2026-04", contractMonths: 12,
    });
    expect(s.slice(0, 3)).toEqual([
      { month: "2026-03", setup: 10000, mrr: 0 },
      { month: "2026-04", setup: 10000, mrr: 5000 },
      { month: "2026-05", setup: 10000, mrr: 5000 },
    ]);
    expect(s).toHaveLength(13);
    expect(s[12]).toEqual({ month: "2027-03", setup: 0, mrr: 5000 });
    expect(s.reduce((a, r) => a + r.setup, 0)).toBe(30000);
  });
  it("o resto vai para a última parcela", () => {
    const s = buildRevenueSchedule({ ...base, setupTotal: 100, setupInstallments: 3, setupFirstDue: "2026-03" });
    expect(s.map((r) => r.setup)).toEqual([33.33, 33.33, 33.34]);
  });
  it("sem contrato, sem linhas", () => {
    expect(buildRevenueSchedule(base)).toEqual([]);
  });
  it("vira o ano", () => {
    const s = buildRevenueSchedule({ ...base, mrr: 10, mrrStart: "2026-11", contractMonths: 3 });
    expect(s.map((r) => r.month)).toEqual(["2026-11", "2026-12", "2027-01"]);
  });
  it("ignora setup sem data e MRR sem início", () => {
    expect(buildRevenueSchedule({ ...base, setupTotal: 10 })).toEqual([]);
    expect(buildRevenueSchedule({ ...base, mrr: 10, contractMonths: 3 })).toEqual([]);
  });
});

describe("contractValue", () => {
  it("soma setup e MRR vezes meses", () => {
    expect(contractValue({ ...base, setupTotal: 1000, mrr: 500, mrrStart: "2026-01", contractMonths: 12 })).toBe(7000);
    expect(contractValue({ ...base, setupTotal: 1000 })).toBe(1000);
  });
});
