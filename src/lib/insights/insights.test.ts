import { describe, expect, it } from "vitest";
import { accumulate, delta, formatXLabel, isEmptyResult, shapeChart, VALUE_KEY } from "./chart-shape";
import { defaultDefinition, parseDefinition } from "./definition";
import { PALETTE, PALETTE_ROWS, resolveColor, SERIES_ORDER } from "./palette";
import type { InsightResult } from "./types";

const base = (over: Partial<InsightResult> = {}): InsightResult => ({
  x: [
    { key: "2026-09-01", label: "2026-09-01" },
    { key: "2026-10-01", label: "2026-10-01" },
  ],
  segments: [
    { key: "open", label: "Aberto" },
    { key: "lost", label: "Perdido" },
  ],
  values: [
    [2, 1],
    [3, 0],
  ],
  totals: [3, 3],
  total: 6,
  measure: { id: "count", label: "Número de negócios", type: "number" },
  x_field: { id: "addTime", label: "Negócio criado em", type: "DATE_TIME", interval: "month" },
  segment_field: { id: "status", label: "Status", type: "SINGLE_OPTION" },
  ...over,
});

describe("definição", () => {
  it("padrão de negócios: colunas por mês com o período deste mês e segmento por status", () => {
    const d = defaultDefinition("deals", "stats");
    expect(d.chart_type).toBe("column");
    expect(d.parameters.group_by).toEqual({ filter: "addTime", interval: "month" });
    expect(d.parameters.segment_by).toBe("status");
    expect(d.parameters.filter_by).toEqual([{ filter: "addTime", type: "DATE_TIME", operands: [], period: "month" }]);
  });
  it("aceita o JSON do Pipedrive e recusa gráfico fora do tipo", () => {
    const pd = {
      data_type: "leads",
      report_type: "performance",
      chart_type: "scorecard",
      parameters: {
        group_by: { filter: "label", interval: false },
        measure_by: "count",
        segment_by: "none",
        filter_by: [{ filter: "active", type: "BOOLEAN", operands: [{ name: "isExactly", defaultValue: true }], period: null }],
      },
      columns: ["title"],
      colors: {},
    };
    expect(parseDefinition(pd)?.parameters.filter_by[0]?.filter).toBe("active");
    expect(parseDefinition({ ...pd, chart_type: "funnel" })).toBeNull();
  });
});

describe("cores", () => {
  it("paleta do sistema tem 42 cores em 3 linhas de 14", () => {
    expect(PALETTE).toHaveLength(42);
    expect(PALETTE_ROWS.every((r) => r.length === 14)).toBe(true);
  });
  it("prioridade: relatório > empresa > sistema > cadastro > paleta", () => {
    const ctx = { report: { won: "#000001" }, company: { "status:lost": "#000002" }, record: { x: "#000003" } };
    expect(resolveColor("status", "won", 0, ctx)).toBe("#000001");
    expect(resolveColor("status", "lost", 0, ctx)).toBe("#000002");
    expect(resolveColor("status", "open", 0, ctx)).toBe("#2a78d6");
    expect(resolveColor("label", "x", 5, ctx)).toBe("#000003");
    expect(resolveColor("channel", "y", 1, ctx)).toBe(SERIES_ORDER[1]);
  });
  it("depois de 42 valores a paleta recomeça", () => {
    const ctx = { report: {}, company: {} };
    expect(resolveColor("c", "k", SERIES_ORDER.length, ctx)).toBe(SERIES_ORDER[0]);
  });
});

describe("gráfico", () => {
  const ctx = { report: {}, company: {} };
  it("monta séries pelos segmentos e rótulos de mês", () => {
    const s = shapeChart(base(), defaultDefinition("deals", "stats"), ctx);
    expect(s.series.map((x) => x.key)).toEqual(["open", "lost"]);
    expect(s.rows[1]).toEqual({ key: "2026-10-01", label: "out 2026", values: { open: 3, lost: 0 }, total: 3 });
  });
  it("sem segmento: uma série com o nome da medida", () => {
    const s = shapeChart(base({ segments: [], values: [[3], [3]] }), defaultDefinition("deals", "stats"), ctx);
    expect(s.series).toEqual([{ key: VALUE_KEY, label: "Número de negócios", color: SERIES_ORDER[0] }]);
  });
  it("acumulado soma ao longo do eixo", () => {
    const def = defaultDefinition("deals", "stats");
    def.parameters.is_cumulative = true;
    const s = shapeChart(base(), def, ctx);
    expect(s.rows.map((r) => r.values.open)).toEqual([2, 5]);
    expect(s.rows.map((r) => r.total)).toEqual([3, 6]);
    expect(accumulate([1, 2, 3])).toEqual([1, 3, 6]);
  });
  it("ordena e pagina", () => {
    const def = defaultDefinition("deals", "stats");
    const s = shapeChart(base({ totals: [1, 9] }), def, ctx, { sort: "value_desc", pageSize: 1, page: 0 });
    expect(s.rows.map((r) => r.key)).toEqual(["2026-10-01"]);
    expect(s.pageCount).toBe(2);
  });
  it("variação e intervalo", () => {
    expect(delta(150, 93)).toEqual({ abs: 57, pct: 57 / 93 });
    expect(delta(3, 0)).toEqual({ abs: 3, pct: null });
    expect(delta(3, null)).toBeNull();
    expect(formatXLabel("2026-10-01", "x", "quarter")).toBe("T4 2026");
    expect(formatXLabel("abc", "Prospecção", "month")).toBe("Prospecção");
  });
  it("sem dados: aviso; o número sempre aparece", () => {
    expect(isEmptyResult(base({ x: [], values: [] }), "column")).toBe(true);
    expect(isEmptyResult(base({ values: [[0, 0], [0, 0]] }), "bar")).toBe(true);
    expect(isEmptyResult(base({ x: [], values: [], total: 0 }), "scorecard")).toBe(false);
  });
});

describe("período", () => {
  // quarta-feira, 28/10/2026, 10h em São Paulo
  const now = new Date("2026-10-28T13:00:00Z");
  it("semana de domingo a sábado, mês e trimestre", async () => {
    const { periodBounds } = await import("./period");
    expect(periodBounds("week", now)).toEqual({ from: "2026-10-25", to: "2026-10-31" });
    expect(periodBounds("lastWeek", now)).toEqual({ from: "2026-10-18", to: "2026-10-24" });
    expect(periodBounds("month", now)).toEqual({ from: "2026-10-01", to: "2026-10-31" });
    expect(periodBounds("lastMonth", now)).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(periodBounds("quarter", now)).toEqual({ from: "2026-10-01", to: "2026-12-31" });
    expect(periodBounds("yesterday", now)).toEqual({ from: "2026-10-27", to: "2026-10-27" });
  });
  it("meia-noite em São Paulo ainda é o dia anterior em UTC-3", async () => {
    const { periodBounds } = await import("./period");
    expect(periodBounds("today", new Date("2026-11-01T02:30:00Z"))).toEqual({ from: "2026-10-31", to: "2026-10-31" });
  });
});
