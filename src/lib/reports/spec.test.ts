import { describe, expect, it } from "vitest";
import {
  BASES,
  BASE_KEYS,
  PRESET_KEYS,
  dimensionsFor,
  fieldsFor,
  metricsFor,
  reportSpecSchema,
  sumFieldsFor,
  toReportResult,
} from "./spec";

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ok = (s: unknown) => reportSpecSchema.safeParse(s).success;
const custom = (over: Record<string, unknown> = {}) => ({
  kind: "custom",
  base: "deals",
  metric: { op: "count" },
  chart: "bar",
  ...over,
});

describe("catálogo espelha o banco", () => {
  it("bases", () => {
    expect(BASE_KEYS).toEqual(["leads", "deals", "activities", "revenue", "stage_history", "organizations", "persons"]);
    expect(BASES.map((b) => b.key)).toEqual([...BASE_KEYS]);
  });
  it("campos por base", () => {
    const keys = Object.fromEntries(BASE_KEYS.map((b) => [b, fieldsFor(b).map((f) => f.key)]));
    expect(keys).toEqual({
      leads: ["owner", "company", "team", "status", "source", "label", "created_at", "converted_at", "estimated_value",
        "organization", "activities_count", "activity_outcome", "activity_completed_at", "activity_owner"],
      deals: ["owner", "company", "team", "pipeline", "stage", "status", "lost_reason", "label", "created_at",
        "won_at", "lost_at", "expected_close_date", "contract_value", "setup_total", "mrr", "estimated_value",
        "value", "source", "close_or_won", "organization"],
      activities: ["owner", "company", "team", "type", "channel", "outcome", "outcome_classification",
        "meeting_outcome", "due_at", "completed_at", "created_at", "done", "organization", "lead", "lead_source"],
      revenue: ["owner", "company", "team", "pipeline", "deal_status", "month", "setup", "mrr", "total"],
      stage_history: ["owner", "company", "team", "pipeline", "from_stage", "to_stage", "moved_at", "deal_status",
        "deal_won_at"],
      organizations: ["owner", "company", "team", "created_at", "updated_at", "label", "activities_count",
        "lead_created_at", "activity_completed_at", "activity_owner"],
      persons: ["owner", "company", "team", "created_at", "label", "organization", "activities_count"],
    });
  });
  it("dimensões por base", () => {
    const keys = Object.fromEntries(BASE_KEYS.map((b) => [b, dimensionsFor(b).map((d) => d.key)]));
    expect(keys).toEqual({
      leads: ["owner", "team", "company", "status", "source", "label", "organization", "month"],
      deals: ["owner", "team", "company", "status", "pipeline", "stage", "lost_reason", "label", "source",
        "organization", "month"],
      activities: ["owner", "team", "company", "kind", "type", "channel", "outcome", "outcome_classification",
        "meeting_outcome", "done", "organization", "month"],
      revenue: ["owner", "company", "deal_status", "pipeline", "month"],
      stage_history: ["owner", "pipeline", "from_stage", "to_stage", "month"],
      organizations: ["owner", "team", "company", "label", "month"],
      persons: ["owner", "team", "company", "label", "organization", "month"],
    });
  });
  it("métricas e campos somáveis por base", () => {
    const ops = Object.fromEntries(BASE_KEYS.map((b) => [b, metricsFor(b).map((m) => m.key)]));
    expect(ops).toEqual({
      leads: ["count", "sum", "avg", "conversion_rate", "avg_days"],
      deals: ["count", "sum", "avg", "conversion_rate", "avg_days"],
      activities: ["count"],
      revenue: ["count", "sum", "avg"],
      stage_history: ["count", "avg_days"],
      organizations: ["count"],
      persons: ["count"],
    });
    expect(sumFieldsFor("deals").map((f) => f.key)).toEqual(["contract_value", "setup_total", "mrr", "estimated_value", "value"]);
    expect(sumFieldsFor("activities")).toEqual([]);
  });
  it("segmento, período relativo e lista", () => {
    expect(ok(custom({ base: "leads", group_by: "source", segment_by: "status", chart: "column" }))).toBe(true);
    expect(ok(custom({ base: "leads", segment_by: "status" }))).toBe(false);
    expect(ok(custom({ period: { field: "created_at", relative: "this_month" }, chart: "number" }))).toBe(true);
    expect(ok(custom({ period: { field: "created_at", relative: "ontem" } }))).toBe(false);
    expect(ok(custom({ chart: "list", columns: ["title", "value", "custom:temperatura"] }))).toBe(true);
    expect(ok(custom({ chart: "list" }))).toBe(false);
    expect(ok(custom({ chart: "list", columns: ["nope"] }))).toBe(false);
    expect(ok(custom({ base: "leads", filters: [{ field: "person.custom:canal_de_origem", op: "eq", value: "Jitterbit" }] }))).toBe(true);
    expect(ok(custom({ base: "leads", filters: [{ field: "source", op: "not_in", value: [U(1)] }] }))).toBe(true);
  });
  it("presets", () => {
    expect([...PRESET_KEYS]).toEqual(["channel_funnel", "channel_success", "conversion_influence",
      "stage_conversion", "forecast", "revenue_monthly", "pipeline_overview", "aging", "activities_by_user",
      "lost_reasons", "goal_progress"]);
  });
});

describe("reportSpecSchema aceita", () => {
  it("uma spec válida de cada base", () => {
    expect(ok(custom({ base: "leads", metric: { op: "conversion_rate" }, group_by: "source" }))).toBe(true);
    expect(ok(custom({ base: "deals", metric: { op: "sum", field: "mrr" }, group_by: "month" }))).toBe(true);
    expect(ok(custom({ base: "activities", group_by: "outcome_classification", chart: "pie" }))).toBe(true);
    expect(ok(custom({ base: "revenue", metric: { op: "sum", field: "total" }, group_by: "month", chart: "line" }))).toBe(true);
    expect(ok(custom({ base: "stage_history", metric: { op: "avg_days" }, group_by: "to_stage" }))).toBe(true);
  });
  it("filtros, período e agrupamento por campo personalizado", () => {
    expect(ok(custom({
      group_by: "custom:segmento",
      filters: [
        { field: "owner", op: "in", value: [U(1), U(2)] },
        { field: "status", op: "eq", value: "won" },
        { field: "won_at", op: "between", value: ["2026-01-01", "2026-03-31"] },
        { field: "mrr", op: "gte", value: 100 },
        { field: "lost_reason", op: "is_null" },
      ],
      period: { field: "created_at", from: "2026-01-01", to: "2026-12-31" },
    }))).toBe(true);
  });
  it("presets, com e sem params", () => {
    expect(ok({ kind: "forecast" })).toBe(true);
    expect(ok({ kind: "stage_conversion", params: { pipeline: U(1), group_by: "month" } })).toBe(true);
    expect(ok({ kind: "lost_reasons", filters: [{ field: "pipeline", op: "eq", value: U(1) }],
      period: { from: "2026-01-01", to: "2026-01-31" }, chart: "pie" })).toBe(true);
  });
});

describe("reportSpecSchema rejeita", () => {
  it("campo fora do catálogo da base", () => {
    expect(ok(custom({ filters: [{ field: "outcome", op: "eq", value: U(1) }] }))).toBe(false);
    expect(ok(custom({ base: "activities", metric: { op: "sum", field: "mrr" } }))).toBe(false);
    expect(ok(custom({ group_by: "channel" }))).toBe(false);
    expect(ok(custom({ base: "activities", group_by: "custom:x" }))).toBe(false);
  });
  it("sum sem campo somável", () => {
    expect(ok(custom({ metric: { op: "sum" } }))).toBe(false);
    expect(ok(custom({ metric: { op: "sum", field: "status" } }))).toBe(false);
    expect(ok(custom({ base: "activities", metric: { op: "sum", field: "due_at" } }))).toBe(false);
  });
  it("conversion_rate em activities e métrica com campo indevido", () => {
    expect(ok(custom({ base: "activities", metric: { op: "conversion_rate" } }))).toBe(false);
    expect(ok(custom({ metric: { op: "count", field: "mrr" } }))).toBe(false);
    expect(ok(custom({ base: "revenue", metric: { op: "avg_days" } }))).toBe(false);
  });
  it("operador desconhecido ou incompatível", () => {
    expect(ok(custom({ filters: [{ field: "status", op: "like", value: "x" }] }))).toBe(false);
    expect(ok(custom({ filters: [{ field: "status", op: "gte", value: "x" }] }))).toBe(false);
    expect(ok(custom({ filters: [{ field: "label", op: "is_null" }] }))).toBe(false);
  });
  it("valores inválidos de filtro", () => {
    expect(ok(custom({ filters: [{ field: "owner", op: "eq", value: "nao-uuid" }] }))).toBe(false);
    expect(ok(custom({ filters: [{ field: "owner", op: "in", value: [] }] }))).toBe(false);
    expect(ok(custom({ filters: [{ field: "mrr", op: "between", value: [10, 1] }] }))).toBe(false);
    expect(ok(custom({ filters: [{ field: "won_at", op: "eq", value: "2026-02-31" }] }))).toBe(false);
    expect(ok(custom({ filters: [{ field: "owner", op: "is_null", value: U(1) }] }))).toBe(false);
  });
  it("mais de 20 filtros", () => {
    const f = { field: "owner", op: "eq", value: U(1) };
    expect(ok(custom({ filters: Array.from({ length: 20 }, () => f) }))).toBe(true);
    expect(ok(custom({ filters: Array.from({ length: 21 }, () => f) }))).toBe(false);
    expect(ok({ kind: "forecast", filters: Array.from({ length: 21 }, () => ({ ...f })) })).toBe(false);
  });
  it("period.from maior que to, ou campo que não é data", () => {
    expect(ok(custom({ period: { field: "created_at", from: "2026-02-01", to: "2026-01-01" } }))).toBe(false);
    expect(ok(custom({ period: { field: "status", from: "2026-01-01", to: "2026-02-01" } }))).toBe(false);
    expect(ok({ kind: "forecast", period: { from: "2026-02-01", to: "2026-01-01" } })).toBe(false);
  });
  it("chart e kind inválidos, chaves extras", () => {
    expect(ok(custom({ chart: "radar" }))).toBe(false);
    expect(ok({ kind: "inexistente" })).toBe(false);
    expect(ok(custom({ extra: 1 }))).toBe(false);
  });
  it("params de preset", () => {
    expect(ok({ kind: "stage_conversion" })).toBe(false);
    expect(ok({ kind: "stage_conversion", params: { pipeline: U(1), group_by: "team" } })).toBe(false);
    expect(ok({ kind: "forecast", params: { x: 1 } })).toBe(false);
    expect(ok({ kind: "aging", filters: [{ field: "owner", op: "gte", value: U(1) }] })).toBe(false);
    expect(ok({ kind: "channel_funnel", filters: [{ field: "pipeline", op: "eq", value: U(1) }] })).toBe(false);
  });
});

describe("toReportResult", () => {
  it("normaliza a saída do banco", () => {
    expect(toReportResult({ columns: [{ key: "a", label: "A", type: "text" }], rows: [["x"]], total: 3, truncated: true, chart: "pie" }))
      .toEqual({ columns: [{ key: "a", label: "A", type: "text" }], rows: [["x"]], total: 3, truncated: true, chart: "pie" });
    expect(toReportResult(null)).toEqual({ columns: [], rows: [], total: null, truncated: false, chart: null });
    expect(toReportResult({ chart: "radar" }).chart).toBeNull();
  });
});
