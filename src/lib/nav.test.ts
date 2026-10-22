import { describe, expect, it } from "vitest";
import { CURRENT_PHASE, NAV_ITEMS, PALETTE_EXTRA_ITEMS, isNavItemEnabled, navHref } from "./nav";

const get = (key: string) => NAV_ITEMS.find((i) => i.key === key)!;

describe("nav", () => {
  it("fase atual é 3", () => expect(CURRENT_PHASE).toBe(3));
  it("itens de fases futuras ficam desabilitados", () => {
    expect(isNavItemEnabled(get("atividades"), true)).toBe(false);
    expect(isNavItemEnabled(get("email"), true)).toBe(false);
  });
  it("itens até a fase 3 ficam habilitados", () => {
    expect(isNavItemEnabled(get("negocios"), false)).toBe(true);
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
  it("lixeira só na busca, com escopo de empresa", () => {
    const item = PALETTE_EXTRA_ITEMS.find((i) => i.key === "lixeira")!;
    expect(item.scoped).toBe(true);
    expect(NAV_ITEMS.some((i) => i.key === "lixeira")).toBe(false);
    expect(navHref(item, "volt")).toBe("/volt/lixeira");
    expect(isNavItemEnabled(item, false)).toBe(true);
  });
});
