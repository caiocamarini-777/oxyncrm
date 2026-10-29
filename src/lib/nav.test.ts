import { describe, expect, it } from "vitest";
import {
  DELIVERED_PHASES,
  NAV_ITEMS,
  PALETTE_EXTRA_ITEMS,
  isNavItemEnabled,
  navHref,
  reportsSharedOnly,
  scopeCanViewFinance,
  scopeCanViewReports,
} from "./nav";

const get = (key: string) => NAV_ITEMS.find((i) => i.key === key)!;

describe("nav", () => {
  it("fases entregues pulam a 5", () => expect(DELIVERED_PHASES).toEqual([1, 2, 3, 4, 6, 8]));
  it("itens de fases futuras ficam desabilitados", () => {
    expect(isNavItemEnabled(get("email"), true)).toBe(false);
  });
  it("itens até a fase 4 ficam habilitados", () => {
    expect(isNavItemEnabled(get("negocios"), false)).toBe(true);
    expect(isNavItemEnabled(get("atividades"), false)).toBe(true);
    expect(isNavItemEnabled(get("leads"), false)).toBe(true);
    expect(isNavItemEnabled(get("contatos"), false)).toBe(true);
  });
  it("relatórios exigem view_reports, dashboards compartilhados ou admin geral", () => {
    const none = { canViewReports: false, hasSharedDashboards: false };
    expect(isNavItemEnabled(get("relatorios"), false)).toBe(false);
    expect(isNavItemEnabled(get("relatorios"), false, none)).toBe(false);
    expect(isNavItemEnabled(get("relatorios"), false, { canViewReports: true, hasSharedDashboards: false })).toBe(true);
    expect(isNavItemEnabled(get("relatorios"), false, { canViewReports: false, hasSharedDashboards: true })).toBe(true);
    expect(isNavItemEnabled(get("relatorios"), true, none)).toBe(true);
  });
  it("sem view_reports e com compartilhados, relatórios leva aos dashboards", () => {
    const shared = { canViewReports: false, hasSharedDashboards: true };
    expect(reportsSharedOnly(false, shared)).toBe(true);
    expect(reportsSharedOnly(true, shared)).toBe(false);
    expect(reportsSharedOnly(false, { canViewReports: true, hasSharedDashboards: true })).toBe(false);
    expect(reportsSharedOnly(false, { canViewReports: false, hasSharedDashboards: false })).toBe(false);
    expect(navHref(get("relatorios"), "volt", true)).toBe("/volt/relatorios/dashboards");
    expect(navHref(get("relatorios"), "volt", false)).toBe("/volt/relatorios");
    expect(navHref(get("leads"), "volt", true)).toBe("/volt/leads");
  });
  it("view_reports no escopo todas vale se alguma empresa libera", () => {
    expect(scopeCanViewReports("todas", "todas", ["volt"])).toBe(true);
    expect(scopeCanViewReports("todas", "todas", [])).toBe(false);
    expect(scopeCanViewReports("naia", "todas", ["volt"])).toBe(false);
    expect(scopeCanViewReports("volt", "todas", ["volt"])).toBe(true);
    expect(scopeCanViewReports(null, "todas", ["volt"])).toBe(false);
  });
  it("financeiro só aparece com canViewFinance, até para o admin geral", () => {
    const base = { canViewReports: true, hasSharedDashboards: false };
    expect(DELIVERED_PHASES).toContain(8);
    expect(isNavItemEnabled(get("financeiro"), false, { ...base, canViewFinance: true })).toBe(true);
    expect(isNavItemEnabled(get("financeiro"), false, base)).toBe(false);
    expect(isNavItemEnabled(get("financeiro"), true, { ...base, canViewFinance: false })).toBe(false);
    expect(isNavItemEnabled(get("financeiro"), true)).toBe(false);
    expect(navHref(get("financeiro"), "volt")).toBe("/volt/financeiro");
  });
  it("view_finance vale só numa empresa específica, nunca em todas", () => {
    expect(scopeCanViewFinance("volt", "todas", ["volt"])).toBe(true);
    expect(scopeCanViewFinance("naia", "todas", ["volt"])).toBe(false);
    expect(scopeCanViewFinance("todas", "todas", ["volt"])).toBe(false);
    expect(scopeCanViewFinance(null, "todas", ["volt"])).toBe(false);
  });
  it("configurações só para admin geral", () => {
    expect(isNavItemEnabled(get("configuracoes"), false)).toBe(false);
    expect(isNavItemEnabled(get("configuracoes"), true)).toBe(true);
  });
  it("monta hrefs", () => {
    expect(navHref(get("leads"), "volt")).toBe("/volt/leads");
    expect(navHref(get("configuracoes"), "volt")).toBe("/configuracoes/empresas");
  });
  it("lixeira só na busca, com escopo de empresa", () => {
    const item = PALETTE_EXTRA_ITEMS.find((i) => i.key === "lixeira")!;
    expect(item.scoped).toBe(true);
    expect(NAV_ITEMS.some((i) => i.key === "lixeira")).toBe(false);
    expect(navHref(item, "volt")).toBe("/volt/lixeira");
    expect(isNavItemEnabled(item, false)).toBe(true);
  });
});
