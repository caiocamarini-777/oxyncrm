import { describe, expect, it } from "vitest";
import { deriveScopeSlug, hideTestCompanies, pickDefaultCompany, resolveCompanyScope, switchCompanyPath, type CompanySummary } from "./scope";

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
  it("numa empresa específica, sai do registro e volta para a seção", () => {
    const id = "d4c35601-7d55-4334-bef2-f568210b31c5";
    expect(switchCompanyPath(`/oxyn/relatorios/paineis/${id}`, "harpix")).toBe("/harpix/relatorios");
    expect(switchCompanyPath(`/oxyn/relatorios/r/${id}`, "harpix")).toBe("/harpix/relatorios");
    expect(switchCompanyPath("/oxyn/relatorios/r/novo", "harpix")).toBe("/harpix/relatorios/r/novo");
    expect(switchCompanyPath("/oxyn/relatorios/metas", "harpix")).toBe("/harpix/relatorios/metas");
    expect(switchCompanyPath(`/oxyn/negocios/${id}`, "naia")).toBe("/naia/negocios");
    expect(switchCompanyPath(`/oxyn/negocios/${id}`, "todas")).toBe(`/todas/negocios/${id}`);
  });
  it("fora do escopo vai para o início", () => {
    expect(switchCompanyPath("/perfil", "naia")).toBe("/naia/inicio");
    expect(switchCompanyPath("/configuracoes/empresas", "naia")).toBe("/naia/inicio");
  });
});

describe("hideTestCompanies", () => {
  const tst: CompanySummary = { id: "3", name: "Conversao E2E 1", slug: "tst-e2e-cv-1", logoUrl: null };
  it("esconde empresas de teste de contas reais e mostra para contas de teste", () => {
    expect(hideTestCompanies([volt, tst], "caio@gmail.com")).toEqual([volt]);
    expect(hideTestCompanies([volt, tst], "admin@oxyn.test")).toEqual([volt, tst]);
  });
});

describe("pickDefaultCompany", () => {
  it("usa o último slug se existir", () => {
    expect(pickDefaultCompany(companies, "naia")).toBe(naia);
    expect(pickDefaultCompany(companies, "sumiu")).toBe(volt);
    expect(pickDefaultCompany([], undefined)).toBeNull();
  });
});

describe("deriveScopeSlug", () => {
  it("usa o slug da URL quando válido", () => {
    expect(deriveScopeSlug("/naia/inicio", companies, false, "volt")).toBe("naia");
    expect(deriveScopeSlug("/todas/inicio", companies, false, "volt")).toBe("todas");
  });
  it("fora do escopo usa a empresa padrão", () => {
    expect(deriveScopeSlug("/perfil", companies, false, "naia")).toBe("naia");
    expect(deriveScopeSlug("/perfil", companies, false, undefined)).toBe("volt");
    expect(deriveScopeSlug("/todas/x", [volt], false, undefined)).toBe("volt");
  });
  it("sem empresas devolve null", () => {
    expect(deriveScopeSlug("/configuracoes/empresas", [], true, undefined)).toBeNull();
  });
});
