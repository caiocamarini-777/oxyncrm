import { describe, expect, it } from "vitest";
import {
  decideContract,
  decideRecurring,
  matchCategory,
  matchOrganization,
  SEED_EXPENSE_CATEGORIES,
  SEED_INCOME_CATEGORIES,
} from "./match";

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

describe("decideContract", () => {
  const rows = [
    { id: "a", notes: "Importado da planilha [import:Renda:4]", title: "Omni 11", organizationId: "o1", status: "active" },
    { id: "b", notes: null, title: "Harpix CRO", organizationId: "o2", status: "active" },
    { id: "c", notes: null, title: "Naia", organizationId: "o3", status: "cancelled" },
  ];
  it("marca encontrada: mantém", () => {
    expect(decideContract(rows, { key: "Renda:4", title: "Omni 11", organizationId: "o1" })).toEqual({ action: "keep", id: "a" });
  });
  it("sem marca, mesmo cliente e título: pula com aviso", () => {
    const d = decideContract(rows, { key: "Renda:6", title: "harpix  cro", organizationId: "o2" });
    expect(d).toMatchObject({ action: "skip", id: "b" });
  });
  it("só um contrato cancelado igual: cria", () => {
    expect(decideContract(rows, { key: "Renda:10", title: "Naia", organizationId: "o3" })).toEqual({ action: "create" });
  });
  it("mesmo título de outro cliente: cria", () => {
    expect(decideContract(rows, { key: "Renda:6", title: "Harpix CRO", organizationId: "o9" })).toEqual({ action: "create" });
  });
});

describe("decideRecurring", () => {
  const rows = [{ id: "r1", description: "Aluguel", expenseCategoryId: "c1", startMonth: "2026-11-01" }];
  it("mesma descrição, categoria e início: mantém", () => {
    expect(decideRecurring(rows, { description: "aluguel", expenseCategoryId: "c1", startMonth: "2026-11-01" })).toEqual({
      action: "keep",
      id: "r1",
    });
  });
  it("mesma descrição normalizada com outra categoria ou início: pula com aviso", () => {
    expect(decideRecurring(rows, { description: "Aluguél ", expenseCategoryId: "c2", startMonth: "2026-12-01" })).toMatchObject({
      action: "skip",
      id: "r1",
    });
  });
  it("descrição nova: cria", () => {
    expect(decideRecurring(rows, { description: "Luz", expenseCategoryId: "c1", startMonth: "2026-11-01" })).toEqual({ action: "create" });
  });
});
