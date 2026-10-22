import { describe, expect, it } from "vitest";
import { CURRENT_PHASE, NAV_ITEMS, isNavItemEnabled, navHref } from "./nav";

const get = (key: string) => NAV_ITEMS.find((i) => i.key === key)!;

describe("nav", () => {
  it("fase atual é 2", () => expect(CURRENT_PHASE).toBe(2));
  it("itens de fases futuras ficam desabilitados", () => {
    expect(isNavItemEnabled(get("negocios"), true)).toBe(false);
    expect(isNavItemEnabled(get("atividades"), true)).toBe(false);
  });
  it("itens da fase 2 ficam habilitados", () => {
    expect(isNavItemEnabled(get("leads"), false)).toBe(true);
    expect(isNavItemEnabled(get("contatos"), false)).toBe(true);
  });
  it("configurações só para admin geral", () => {
    expect(isNavItemEnabled(get("configuracoes"), false)).toBe(false);
    expect(isNavItemEnabled(get("configuracoes"), true)).toBe(true);
  });
  it("monta hrefs", () => {
    expect(navHref(get("leads"), "volt")).toBe("/volt/leads");
    expect(navHref(get("configuracoes"), "volt")).toBe("/configuracoes/empresas");
  });
});
