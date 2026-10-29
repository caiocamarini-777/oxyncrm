import { describe, expect, it } from "vitest";
import {
  balanceSeries,
  breakEven,
  coverageMonths,
  monthlyProjection,
  shareBy,
  type EntryLite,
} from "./calc";

const e = (o: Partial<EntryLite>): EntryLite => ({
  id: "x",
  direction: "in",
  status: "open",
  dueDate: "2026-10-28",
  settledOn: null,
  competence: "2026-10-01",
  gross: 0,
  retention: 0,
  amount: 0,
  settledAmount: null,
  accountId: "a1",
  organizationId: null,
  serviceCategoryId: null,
  expenseCategoryId: null,
  nature: null,
  ...o,
});

describe("balanceSeries", () => {
  const snap = [{ accountId: "a1", asOf: "2026-10-26", balance: 10000 }];
  const entries = [
    e({ id: "1", direction: "in", status: "open", dueDate: "2026-10-28", amount: 5000 }),
    e({ id: "2", direction: "out", status: "settled", settledOn: "2026-10-27", settledAmount: 2000, amount: 2000 }),
    e({ id: "3", direction: "out", status: "settled", settledOn: "2026-10-25", settledAmount: 999, amount: 999 }),
    e({ id: "4", direction: "out", status: "cancelled", dueDate: "2026-10-28", amount: 777 }),
  ];

  it("sem snapshot devolve null", () => {
    expect(balanceSeries([], entries, "2026-10-26", "2026-10-29", "2026-10-29")).toBeNull();
  });

  it("aplica liquidadas, abertas vencidas hoje e ignora anteriores/canceladas", () => {
    const s = balanceSeries(snap, entries, "2026-10-26", "2026-10-29", "2026-10-29")!;
    const at = (d: string) => s.find((p) => p.date === d)!.balance;
    expect(s).toHaveLength(4);
    expect(at("2026-10-26")).toBe(10000);
    expect(at("2026-10-27")).toBe(8000);
    expect(at("2026-10-28")).toBe(8000);
    expect(at("2026-10-29")).toBe(13000);
  });
});

describe("breakEven / coverageMonths", () => {
  it("ponto de equilíbrio", () => {
    expect(breakEven(50000, 10000, 100000)).toBe(55555.56);
    expect(breakEven(1, 5, 5)).toBeNull();
    expect(breakEven(1, 0, 0)).toBeNull();
  });
  it("cobertura", () => {
    expect(coverageMonths(120000, 60000)).toBe(2);
    expect(coverageMonths(100, 0)).toBeNull();
  });
});

describe("shareBy", () => {
  it("ordena decrescente e soma 1", () => {
    const r = shareBy(
      [
        e({ organizationId: "b", amount: 30 }),
        e({ organizationId: "a", amount: 60 }),
        e({ organizationId: "c", status: "settled", amount: 12, settledAmount: 10 }),
      ],
      "organizationId",
    );
    expect(r.map((x) => x.key)).toEqual(["a", "b", "c"]);
    expect(r[0].share).toBeCloseTo(0.6);
    expect(r[1].share).toBeCloseTo(0.3);
    expect(r[2].share).toBeCloseTo(0.1);
    expect(r.reduce((s, x) => s + x.share, 0)).toBeCloseTo(1);
  });
});

describe("monthlyProjection", () => {
  const entries = [
    e({ id: "1", status: "settled", competence: "2026-09-01", gross: 1100, retention: 100, amount: 1000, settledAmount: 1000, settledOn: "2026-09-10" }),
    e({ id: "2", status: "open", competence: "2026-09-01", gross: 500, retention: 0, amount: 500 }),
    e({ id: "3", direction: "out", status: "settled", competence: "2026-09-01", amount: 300, settledAmount: 300, settledOn: "2026-09-12", nature: "fixed" }),
    e({ id: "4", status: "open", competence: "2026-11-01", gross: 2200, retention: 200, amount: 2000 }),
    e({ id: "5", direction: "out", status: "open", competence: "2026-11-01", amount: 400, nature: "fixed" }),
    e({ id: "6", direction: "out", status: "open", competence: "2026-11-01", amount: 100, nature: "variable" }),
    e({ id: "7", direction: "out", status: "open", competence: "2026-11-01", amount: 50, nature: "non_recurring" }),
    e({ id: "8", status: "cancelled", competence: "2026-11-01", gross: 9, amount: 9 }),
  ];
  const rows = monthlyProjection(entries, ["2026-09-01", "2026-11-01"], "2026-10-29");

  it("mês passado só liquidadas", () => {
    expect(rows[0]).toEqual({
      month: "2026-09-01", grossIn: 1100, retention: 100, netIn: 1000,
      fixed: 300, variable: 0, nonRecurring: 0, result: 700, realized: true,
    });
  });
  it("mês futuro soma abertas e calcula resultado", () => {
    expect(rows[1]).toEqual({
      month: "2026-11-01", grossIn: 2200, retention: 200, netIn: 2000,
      fixed: 400, variable: 100, nonRecurring: 50, result: 1450, realized: false,
    });
  });
});
