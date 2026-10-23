import { describe, expect, it } from "vitest";
import { getPreset } from "./presets";
import { presetSpecFromQuery } from "./preset-query";
import { reportSpecSchema } from "./spec";

const U1 = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";
const q = (s: string) => new URLSearchParams(s);

describe("presetSpecFromQuery", () => {
  it("sem filtros devolve só o tipo e o gráfico", () => {
    const spec = presetSpecFromQuery(getPreset("channel_funnel")!, q(""), null);
    expect(spec).toEqual({ kind: "channel_funnel", chart: "table" });
  });
  it("monta filtros e período válidos pelo schema", () => {
    const spec = presetSpecFromQuery(
      getPreset("lost_reasons")!,
      q(`owner=${U1}&owner=${U2}&funil=${U1}&de=2026-01-01&ate=2026-01-31&lixo=x`),
      null,
    )!;
    expect(spec.filters).toEqual([
      { field: "owner", op: "in", value: [U1, U2] },
      { field: "pipeline", op: "in", value: [U1] },
    ]);
    expect(spec.period).toEqual({ from: "2026-01-01", to: "2026-01-31" });
    expect(reportSpecSchema.safeParse(spec).success).toBe(true);
  });
  it("ignora ids inválidos e período invertido", () => {
    const spec = presetSpecFromQuery(getPreset("channel_funnel")!, q("owner=abc&de=2026-02-01&ate=2026-01-01"), null)!;
    expect(spec.filters).toBeUndefined();
    expect(spec.period).toBeUndefined();
  });
  it("não aplica período em retratos do momento nem filtro de funil em atividades", () => {
    const aging = presetSpecFromQuery(getPreset("aging")!, q("de=2026-01-01&ate=2026-01-31"), null)!;
    expect(aging.period).toBeUndefined();
    const act = presetSpecFromQuery(getPreset("activities_by_user")!, q(`funil=${U1}`), null)!;
    expect(act.filters).toBeUndefined();
  });
  it("conversão por etapa usa o funil como parâmetro, com padrão", () => {
    const p = getPreset("stage_conversion")!;
    expect(presetSpecFromQuery(p, q(""), null)).toBeNull();
    const spec = presetSpecFromQuery(p, q("agrupar=month"), U1)!;
    expect(spec.params).toEqual({ pipeline: U1, group_by: "month" });
    expect(spec.filters).toBeUndefined();
    expect(reportSpecSchema.safeParse(spec).success).toBe(true);
  });
});
