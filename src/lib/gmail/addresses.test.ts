import { describe, expect, it } from "vitest";
import { decodeHeaderWords, domainOf, GENERIC_DOMAINS, parseAddressList } from "./addresses";

describe("parseAddressList", () => {
  it("respeita vírgula entre aspas no nome", () => {
    expect(parseAddressList('"Silva, Maria" <Maria@Empresa.com>, joao@x.com')).toEqual([
      { email: "maria@empresa.com", name: "Silva, Maria" },
      { email: "joao@x.com", name: null },
    ]);
  });

  it("deixa o e-mail em minúsculo e aceita nome sem aspas", () => {
    expect(parseAddressList("Maria Souza <MARIA@X.COM>")).toEqual([{ email: "maria@x.com", name: "Maria Souza" }]);
    expect(parseAddressList("A@B.COM")).toEqual([{ email: "a@b.com", name: null }]);
  });

  it("aceita só <e-mail> e ignora lixo e vazio", () => {
    expect(parseAddressList("<a@b.com>")).toEqual([{ email: "a@b.com", name: null }]);
    expect(parseAddressList("")).toEqual([]);
    expect(parseAddressList("undisclosed-recipients:;")).toEqual([]);
    expect(parseAddressList("sem arroba")).toEqual([]);
  });

  it("decodifica nome em RFC 2047", () => {
    expect(parseAddressList("=?UTF-8?B?Sm/Do28gU2lsdmE=?= <joao@x.com>")).toEqual([
      { email: "joao@x.com", name: "João Silva" },
    ]);
    expect(parseAddressList("=?UTF-8?Q?Jos=C3=A9_Lima?= <j@x.com>")[0].name).toBe("José Lima");
  });

  it("ignora comentário entre parênteses em endereço simples", () => {
    expect(parseAddressList("a@b.com (Fulano)")).toEqual([{ email: "a@b.com", name: null }]);
  });

  it("vários endereços, com nomes e <> misturados", () => {
    const r = parseAddressList('A <a@x.com>,B <b@x.com> , "C, D" <c@x.com>');
    expect(r.map((a) => a.email)).toEqual(["a@x.com", "b@x.com", "c@x.com"]);
  });
});

describe("parseAddressList: sintaxe de grupo", () => {
  it("tira o prefixo do grupo", () => {
    expect(parseAddressList("Equipe: a@b.com, c@d.com;").map((a) => a.email)).toEqual(["a@b.com", "c@d.com"]);
  });
  it("prefixo com nome e membro com nome", () => {
    expect(parseAddressList("Equipe: Ana <A@B.com>, c@d.com;")).toEqual([
      { email: "a@b.com", name: "Ana" },
      { email: "c@d.com", name: null },
    ]);
    expect(parseAddressList('"Time de Vendas": a@b.com;')).toEqual([{ email: "a@b.com", name: null }]);
  });
  it("grupo vazio e destinatário normal depois do grupo", () => {
    expect(parseAddressList("Lista:; x@y.com")).toEqual([{ email: "x@y.com", name: null }]);
  });
});

describe("domainOf e domínios genéricos", () => {
  it("devolve o domínio em minúsculo", () => {
    expect(domainOf("Ana@Oxyn.COM")).toBe("oxyn.com");
    expect(domainOf("semarroba")).toBe("");
  });

  it("lista os 15 domínios genéricos", () => {
    expect(GENERIC_DOMAINS.size).toBe(15);
    expect(GENERIC_DOMAINS.has("gmail.com")).toBe(true);
    expect(GENERIC_DOMAINS.has("protonmail.com")).toBe(true);
  });
});

describe("decodeHeaderWords", () => {
  it("junta palavras codificadas consecutivas", () => {
    expect(decodeHeaderWords("=?UTF-8?B?w6E=?= =?UTF-8?B?w6k=?=")).toBe("áé");
  });
  it("mantém texto simples", () => {
    expect(decodeHeaderWords("Olá mundo")).toBe("Olá mundo");
  });
});
