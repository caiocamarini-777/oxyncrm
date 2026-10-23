import { describe, expect, it } from "vitest";
import { toGoalRow, toWidgetRow } from "./rows";

describe("toWidgetRow", () => {
  it("usa a spec do relatório salvo e o nome dele como título padrão", () => {
    const w = toWidgetRow({
      id: "w", dashboard_id: "d", report_id: "r", spec: null, title: "", position: 2, col_span: 2, row_span: 1,
      reports: { name: "Receita", spec: { kind: "forecast" } },
    });
    expect(w).toMatchObject({ spec: { kind: "forecast" }, title: "Receita", colSpan: 2, position: 2 });
  });
  it("widget com spec própria e relatório ilegível", () => {
    expect(toWidgetRow({ id: "w", dashboard_id: "d", report_id: null, spec: { kind: "aging" }, title: "Parados",
      position: 0, col_span: 1, row_span: 1 }).spec).toEqual({ kind: "aging" });
    expect(toWidgetRow({ id: "w", dashboard_id: "d", report_id: "r", spec: null, title: "", position: 0,
      col_span: 1, row_span: 1, reports: null }).spec).toBeNull();
  });
});

describe("toGoalRow", () => {
  it("converte a saída de goals_progress_self", () => {
    expect(toGoalRow({ id: "g", company_id: "c", label: "Valor ganho (Oxyn)", target_kind: "company",
      target_user_id: null, target_team_id: null, metric: "won_value", period: "month", starts_on: "2026-10-01",
      target_value: 1000, actual: 250, percent: 25, period_start: "2026-10-01", period_end: "2026-10-31" }))
      .toMatchObject({ id: "g", companyId: "c", targetValue: 1000, actual: 250, percent: 25, periodEnd: "2026-10-31" });
  });
});
