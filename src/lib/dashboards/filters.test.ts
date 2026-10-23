import { describe, expect, it } from "vitest";
import { matchPeriodPreset, periodRange, resolveDashboardFilters } from "./filters";

const C1 = "11111111-1111-4111-8111-111111111111";
const C2 = "22222222-2222-4222-8222-222222222222";
const bySlug = new Map([["alfa", C1]]);

describe("periodRange", () => {
  it("calcula os períodos a partir do dia de hoje", () => {
    expect(periodRange("month", "2026-02-10")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(periodRange("quarter", "2026-11-05")).toEqual({ from: "2026-10-01", to: "2026-12-31" });
    expect(periodRange("30d", "2026-03-31")).toEqual({ from: "2026-03-02", to: "2026-03-31" });
    expect(periodRange("90d", "2026-03-31")).toEqual({ from: "2026-01-01", to: "2026-03-31" });
    expect(periodRange("365d", "2026-03-31")).toEqual({ from: "2025-04-01", to: "2026-03-31" });
  });
  it("reconhece o preset de um intervalo", () => {
    expect(matchPeriodPreset({ from: "2026-03-02", to: "2026-03-31" }, "2026-03-31")).toBe("30d");
    expect(matchPeriodPreset({ from: "2026-03-03", to: "2026-03-31" }, "2026-03-31")).toBeNull();
  });
});

describe("resolveDashboardFilters", () => {
  it("usa o padrão do dashboard quando a URL não traz nada", () => {
    const def = { period: { from: "2026-01-01", to: "2026-01-31" }, company: [C2] };
    expect(resolveDashboardFilters({}, def, bySlug)).toEqual(def);
  });
  it("a URL valida sobrepõe o padrão", () => {
    const r = resolveDashboardFilters({ de: "2026-02-01", ate: "2026-02-10", empresa: "alfa" }, {}, bySlug);
    expect(r).toEqual({ period: { from: "2026-02-01", to: "2026-02-10" }, company: [C1] });
  });
  it("valor inválido cai no padrão ou em nenhum filtro", () => {
    expect(resolveDashboardFilters({ de: "lixo", ate: "2026-02-10" }, {}, bySlug)).toEqual({});
    expect(resolveDashboardFilters({ de: "2026-02-31", ate: "2026-03-10" }, {}, bySlug)).toEqual({});
    expect(resolveDashboardFilters({ de: "2026-03-10", ate: "2026-03-01" }, {}, bySlug)).toEqual({});
    expect(resolveDashboardFilters({ empresa: "nao-existe" }, {}, bySlug)).toEqual({});
    const def = { period: { from: "2026-01-01", to: "2026-01-31" } };
    expect(resolveDashboardFilters({ de: "lixo", ate: "x" }, def, bySlug)).toEqual(def);
  });
  it("sem mapa de empresas (escopo de uma empresa) ignora o parâmetro empresa", () => {
    expect(resolveDashboardFilters({ empresa: "alfa" }, {}, null)).toEqual({});
  });
  it("escopo de uma empresa força o filtro de empresa, mesmo com padrão de outra", () => {
    expect(resolveDashboardFilters({}, {}, null, C1)).toEqual({ company: [C1] });
    expect(resolveDashboardFilters({ empresa: "alfa" }, { company: [C2] }, null, C1)).toEqual({ company: [C1] });
    expect(resolveDashboardFilters({}, { company: [C1, C2] }, null, C1)).toEqual({ company: [C1] });
  });
});
