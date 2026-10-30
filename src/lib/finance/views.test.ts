import { describe, expect, it } from "vitest";
import type { EntryLite, MonthRow } from "./calc";
import { addMonths, clientContractInfo, cumulativeSeries, endsWithin, formatCoverage, formatShare, monthsBetween, shareOfDirection } from "./views";

const base = { status: "open", dueDate: "2026-10-10", settledOn: null, competence: "2026-10-01", gross: 0, retention: 0, settledAmount: null, accountId: null, serviceCategoryId: null, expenseCategoryId: null, nature: null } as const;
const e = (o: Partial<EntryLite>): EntryLite => ({ id: "x", direction: "in", organizationId: null, amount: 0, ...base, ...o }) as EntryLite;

describe("views", () => {
  it("monthsBetween e addMonths", () => {
    expect(monthsBetween("2026-10-15", "2027-01-02")).toEqual(["2026-10-01", "2026-11-01", "2026-12-01", "2027-01-01"]);
    expect(addMonths("2026-11-01", 3)).toBe("2027-02-01");
  });
  it("MRR e fim da vigência por cliente", () => {
    const m = clientContractInfo(
      [
        { organizationId: "A", endRule: "ends", amount: 1000, firstMonth: "2026-09-01", months: 12, contractId: "c1" },
        { organizationId: "A", endRule: "auto_renew", amount: 500, firstMonth: "2026-11-01", months: 3, contractId: "c1" },
        { organizationId: "B", endRule: "confirm", amount: 700, firstMonth: "2026-01-01", months: 6, contractId: "c2" },
      ],
      "2026-10-29",
    );
    expect(m.get("A")).toEqual({ mrr: 1000, endsOn: "2027-08-31", endRule: "ends" });
    expect(m.get("B")?.mrr).toBe(0);
    expect(m.get("B")?.endsOn).toBe("2026-06-30");
  });
  it("vence em até 90 dias", () => {
    expect(endsWithin("2027-01-20", "2026-10-29")).toBe(true);
    expect(endsWithin("2027-02-01", "2026-10-29")).toBe(false);
    expect(endsWithin("2026-10-01", "2026-10-29")).toBe(false);
    expect(endsWithin(null, "2026-10-29")).toBe(false);
  });
  it("participação só da direção pedida", () => {
    const r = shareOfDirection(
      [e({ organizationId: "A", amount: 60 }), e({ organizationId: "B", amount: 40 }), e({ direction: "out", organizationId: "A", amount: 999 })],
      "in",
      "organizationId",
    );
    expect(r.map((x) => [x.key, x.share])).toEqual([["A", 0.6], ["B", 0.4]]);
  });
  it("formatação", () => {
    expect(formatShare(0.6)).toBe("60,0%");
    expect(formatCoverage(12.34)).toBe("12,3 meses");
    expect(formatCoverage(null)).toBe("—");
  });
});

describe("cumulativeSeries", () => {
  const row = (month: string, netIn: number, out: number): MonthRow => ({
    month, grossIn: netIn, retention: 0, netIn, fixed: out, variable: 0, nonRecurring: 0, result: netIn - out, realized: false,
  });
  it("acumula entradas, saídas e resultado", () => {
    const s = cumulativeSeries([row("2026-01-01", 200, 100), row("2026-02-01", 50, 100), row("2026-03-01", 130, 100)]);
    expect(s.map((x) => x.resultAcc)).toEqual([100, 50, 80]);
    expect(s.map((x) => x.inAcc)).toEqual([200, 250, 380]);
    expect(s.map((x) => x.outAcc)).toEqual([100, 200, 300]);
  });
});
