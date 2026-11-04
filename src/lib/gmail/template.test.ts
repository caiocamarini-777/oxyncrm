import { describe, expect, it } from "vitest";
import { renderTemplate } from "./template";

describe("renderTemplate", () => {
  it("troca as variáveis, inclusive com espaços", () => {
    expect(
      renderTemplate("Olá {{pessoa.primeiro_nome}}, da {{ organizacao.nome }}!", {
        "pessoa.primeiro_nome": "Maria",
        "organizacao.nome": "Acme",
      }),
    ).toBe("Olá Maria, da Acme!");
  });

  it("variável faltando ou indefinida fica vazia", () => {
    expect(renderTemplate("A{{x}}B{{y}}C", { y: undefined })).toBe("ABC");
  });

  it("repete a mesma variável e mantém o resto intacto", () => {
    expect(renderTemplate("{{a}} e {{a}} {outra}", { a: "1" })).toBe("1 e 1 {outra}");
  });

  it("não vaza propriedades herdadas do objeto", () => {
    expect(renderTemplate("{{constructor}}{{toString}}", {})).toBe("");
  });
});
