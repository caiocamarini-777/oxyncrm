import { describe, expect, it } from "vitest";
import { matchCategory, matchOrganization, SEED_EXPENSE_CATEGORIES, SEED_INCOME_CATEGORIES } from "./match";

const expense = Object.keys(SEED_EXPENSE_CATEGORIES);

describe("matchCategory", () => {
  it.each([
    ["Pro Labore", "Pró-labore"],
    ["Comissãso", "Comissão"],
    ["Impostos / Taxas bancárias", "Impostos/taxas bancárias"],
    ["Escritório/administração geral", "Escritório/administração geral"],
    ["Custo de mercadorias/custo de serviços", "Custo de mercadorias/custo de serviços"],
  ])("%s → %s", (name, expected) => {
    expect(matchCategory(name, expense)).toBe(expected);
  });

  it("Investimentos → Investimentos/rendimentos", () => {
    expect(matchCategory("Investimentos", SEED_INCOME_CATEGORIES)).toBe("Investimentos/rendimentos");
  });

  it("nome desconhecido devolve null", () => {
    expect(matchCategory("Marketing", expense)).toBeNull();
  });
});

describe("matchOrganization", () => {
  const orgs = [{ name: "Omni11" }, { name: "Omni.Pro" }, { name: "Harpix" }, { name: "Naia" }];
  it("ignora espaços e pontuação", () => {
    expect(matchOrganization("Omni 11", orgs)?.name).toBe("Omni11");
  });
  it("aceita a organização como prefixo do nome da linha", () => {
    expect(matchOrganization("Harpix Operaçao", orgs)?.name).toBe("Harpix");
  });
  it("sem correspondência devolve null", () => {
    expect(matchOrganization("Cliente Novo", orgs)).toBeNull();
  });
});
