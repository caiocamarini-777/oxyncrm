import { describe, expect, it } from "vitest";
import { pickDefaultCompany, resolveCompanyScope, switchCompanyPath, type CompanySummary } from "./scope";

const volt: CompanySummary = { id: "1", name: "Volt", slug: "volt", logoUrl: null };
const naia: CompanySummary = { id: "2", name: "Naia", slug: "naia", logoUrl: null };
const companies = [volt, naia];

describe("resolveCompanyScope", () => {
  it("resolve slug acessível", () => {
    expect(resolveCompanyScope("volt", companies, false)).toEqual({ kind: "company", company: volt });
  });
  it("slug desconhecido é null", () => {
    expect(resolveCompanyScope("harpix", companies, false)).toBeNull();
  });
  it("todas depende de admin ou duas empresas", () => {
    expect(resolveCompanyScope("todas", [volt], false)).toBeNull();
    expect(resolveCompanyScope("todas", [volt], true)).toEqual({ kind: "all" });
    expect(resolveCompanyScope("todas", companies, false)).toEqual({ kind: "all" });
  });
});

describe("switchCompanyPath", () => {
  it("troca só o primeiro segmento", () => {
    expect(switchCompanyPath("/volt/inicio", "naia")).toBe("/naia/inicio");
    expect(switchCompanyPath("/volt/negocios/123", "todas")).toBe("/todas/negocios/123");
  });
  it("fora do escopo vai para o início", () => {
    expect(switchCompanyPath("/perfil", "naia")).toBe("/naia/inicio");
    expect(switchCompanyPath("/configuracoes/empresas", "naia")).toBe("/naia/inicio");
  });
});

describe("pickDefaultCompany", () => {
  it("usa o último slug se existir", () => {
    expect(pickDefaultCompany(companies, "naia")).toBe(naia);
    expect(pickDefaultCompany(companies, "sumiu")).toBe(volt);
    expect(pickDefaultCompany([], undefined)).toBeNull();
  });
});
