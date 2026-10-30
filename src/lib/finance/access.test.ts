import { describe, expect, it } from "vitest";
import { accessMapFromRows, slugsWithAccess } from "./access";

const rows = [
  { company_id: "a", can_view: true, can_manage: false, can_sell: false },
  { company_id: "b", can_view: false, can_manage: false, can_sell: true },
];
const companies = [
  { id: "a", slug: "alpha" },
  { id: "b", slug: "beta" },
  { id: "c", slug: "gama" },
];

describe("acesso ao Financeiro", () => {
  it("monta o mapa a partir de fin_my_companies", () => {
    const m = accessMapFromRows(rows);
    expect(m.get("a")).toEqual({ view: true, manage: false, sell: false });
    expect(m.get("c")).toBeUndefined();
  });
  it("filtra slugs pela ação, na ordem das empresas", () => {
    const m = accessMapFromRows(rows);
    expect(slugsWithAccess(companies, m, "view")).toEqual(["alpha"]);
    expect(slugsWithAccess(companies, m, "sell")).toEqual(["beta"]);
    expect(slugsWithAccess(companies, m, "manage")).toEqual([]);
  });
});
