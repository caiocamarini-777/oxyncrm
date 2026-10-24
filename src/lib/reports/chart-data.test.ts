import { describe, expect, it } from "vitest";
import { EMPTY_TEXT, shape, summarize } from "./chart-data";
import type { ReportResult } from "./spec";

const result = (over: Partial<ReportResult>): ReportResult => ({
  columns: [],
  rows: [],
  total: null,
  truncated: false,
  chart: null,
  ...over,
});

const grouped = result({
  columns: [
    { key: "stage", label: "Etapa", type: "text" },
    { key: "value", label: "Soma", type: "currency" },
    { key: "n", label: "Quantidade", type: "number" },
  ],
  rows: [
    ["A", "1000", 2],
    ["B", 500, 1],
  ],
});

describe("shape", () => {
  it("separa categoria e séries numéricas", () => {
    const s = shape(grouped);
    expect(s.cat?.key).toBe("stage");
    expect(s.series.map((x) => x.col.key)).toEqual(["value", "n"]);
    expect(s.data).toEqual([
      { __cat: "A", value: 1000, n: 2 },
      { __cat: "B", value: 500, n: 1 },
    ]);
  });
  it("sem categoria usa o índice e números inválidos viram 0", () => {
    const s = shape(result({ columns: [{ key: "value", label: "Total", type: "number" }], rows: [[null]] }));
    expect(s.cat).toBeNull();
    expect(s.data).toEqual([{ __cat: "1", value: 0 }]);
  });
  it("formata a categoria pelo tipo (mês)", () => {
    const s = shape(
      result({
        columns: [
          { key: "month", label: "Mês", type: "month" },
          { key: "value", label: "Qtd", type: "number" },
        ],
        rows: [["2026-03-01", 4]],
      }),
    );
    expect(s.data[0]!.__cat).toBe("mar/2026");
  });
});

describe("summarize", () => {
  it("vazio", () => expect(summarize(result({}), "bar")).toBe(EMPTY_TEXT));
  it("número", () => {
    const r = result({ columns: [{ key: "value", label: "Quantidade", type: "number" }], rows: [[7]] });
    expect(summarize(r, "number")).toBe("Quantidade: 7");
  });
  it("aponta o maior item da primeira série", () => {
    const text = summarize(grouped, "bar");
    expect(text).toContain("2 itens");
    expect(text).toContain("Maior: A");
    expect(text).toContain("Soma");
  });
  it("sem série numérica conta as linhas", () => {
    const r = result({ columns: [{ key: "a", label: "A", type: "text" }], rows: [["x"], ["y"]] });
    expect(summarize(r, "table")).toBe("2 linhas");
  });
});
