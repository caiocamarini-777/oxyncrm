import { describe, expect, it } from "vitest";
import type { ReportResult } from "@/lib/reports/spec";
import { goalValueType, isGoalProgressResult } from "./goal-progress";

const KEYS = ["goal", "target", "actual", "percent", "period_start", "period_end", "metric"];
const result = (keys: string[]): ReportResult => ({
  columns: keys.map((key) => ({ key, label: key, type: "text" })),
  rows: [],
  total: null,
  truncated: false,
  chart: "table",
});

describe("isGoalProgressResult", () => {
  it("exige todas as colunas, inclusive metric", () => {
    expect(isGoalProgressResult(result(KEYS))).toBe(true);
    expect(isGoalProgressResult(result(KEYS.filter((k) => k !== "metric")))).toBe(false);
    expect(isGoalProgressResult(result(["goal", "target"]))).toBe(false);
  });
});

describe("goalValueType", () => {
  it("moeda para valor e MRR ganhos, número para o resto", () => {
    expect(goalValueType("won_value")).toBe("currency");
    expect(goalValueType("won_mrr")).toBe("currency");
    expect(goalValueType("meetings_held")).toBe("number");
    expect(goalValueType("")).toBe("number");
  });
});
