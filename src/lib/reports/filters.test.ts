import { describe, expect, it } from "vitest";
import { buildWidgetFilters, shareUrl } from "./filters";

const U = "00000000-0000-4000-8000-000000000001";

describe("buildWidgetFilters", () => {
  it("omite chaves ausentes ou nulas (sem filtro)", () => {
    expect(buildWidgetFilters(undefined)).toEqual({});
    expect(buildWidgetFilters({ period: null })).toEqual({});
    expect(buildWidgetFilters({ owner: undefined, team: null as never })).toEqual({});
  });
  it("lista vazia é filtro que não casa nada: vai como []", () => {
    expect(buildWidgetFilters({ company: [], owner: [], team: [], period: null })).toEqual({
      company: [],
      owner: [],
      team: [],
    });
  });
  it("mantém só ids válidos, sem repetir; se nenhum sobrar, vai []", () => {
    expect(
      buildWidgetFilters({ owner: [U, U, "x"], period: { from: "2026-01-01", to: "2026-01-31" } }),
    ).toEqual({ owner: [U], period: { from: "2026-01-01", to: "2026-01-31" } });
    expect(buildWidgetFilters({ team: ["x"] })).toEqual({ team: [] });
  });
});

describe("shareUrl", () => {
  it("monta /d/<token> sem barra duplicada", () => {
    expect(shareUrl("https://crm.oxyn.com.br/", "abc")).toBe("https://crm.oxyn.com.br/d/abc");
  });
});
