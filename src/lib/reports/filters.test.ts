import { describe, expect, it } from "vitest";
import { buildWidgetFilters, shareUrl } from "./filters";

const U = "00000000-0000-4000-8000-000000000001";

describe("buildWidgetFilters", () => {
  it("omite chaves sem seleção", () => {
    expect(buildWidgetFilters(undefined)).toEqual({});
    expect(buildWidgetFilters({ company: [], owner: [], team: [], period: null })).toEqual({});
  });
  it("mantém só o que foi escolhido, sem repetir nem aceitar lixo", () => {
    expect(
      buildWidgetFilters({ owner: [U, U, "x"], period: { from: "2026-01-01", to: "2026-01-31" } }),
    ).toEqual({ owner: [U], period: { from: "2026-01-01", to: "2026-01-31" } });
    expect(buildWidgetFilters({ team: ["x"] })).toEqual({});
  });
});

describe("shareUrl", () => {
  it("monta /d/<token> sem barra duplicada", () => {
    expect(shareUrl("https://crm.oxyn.com.br/", "abc")).toBe("https://crm.oxyn.com.br/d/abc");
  });
});
