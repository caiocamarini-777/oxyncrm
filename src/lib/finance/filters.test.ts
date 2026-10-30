import { describe, expect, it } from "vitest";
import { parseFinanceFilters, toFinanceSearchParams } from "./filters";

describe("parseFinanceFilters", () => {
  it("padrões: mês corrente, horizonte 12, sem filtros", () => {
    const f = parseFinanceFilters({}, "2026-10-29");
    expect(f.from).toBe("2026-10-01");
    expect(f.to).toBe("2026-10-31");
    expect(f.horizon).toBe(12);
    expect(f.includePendingRenewals).toBe(false);
    expect(f.includeEstimatedCommissions).toBe(false);
    expect(f.clients).toEqual([]);
    expect(f.statuses).toEqual([]);
  });
  it("fevereiro bissexto e não bissexto", () => {
    expect(parseFinanceFilters({}, "2028-02-10").to).toBe("2028-02-29");
    expect(parseFinanceFilters({}, "2027-02-10").to).toBe("2027-02-28");
  });
  it("horizonte inválido volta a 12", () => {
    expect(parseFinanceFilters({ horizon: "7" }, "2026-10-29").horizon).toBe(12);
    expect(parseFinanceFilters({ horizon: "24" }, "2026-10-29").horizon).toBe(24);
  });
  it("datas inválidas voltam ao padrão e from > to é corrigido", () => {
    expect(parseFinanceFilters({ from: "lixo" }, "2026-10-29").from).toBe("2026-10-01");
    const f = parseFinanceFilters({ from: "2026-12-01", to: "2026-11-01" }, "2026-10-29");
    expect(f.from <= f.to).toBe(true);
  });
  it("descarta natureza e status desconhecidos", () => {
    const f = parseFinanceFilters({ natures: "fixed,xyz", statuses: "open,foo" }, "2026-10-29");
    expect(f.natures).toEqual(["fixed"]);
    expect(f.statuses).toEqual(["open"]);
  });
  it("ida e volta preserva as listas", () => {
    const f = parseFinanceFilters({ clients: "a,b", horizon: "24", pending: "1", from: "2026-01-01", to: "2026-03-31" }, "2026-10-29");
    expect(f.clients).toEqual(["a", "b"]);
    const g = parseFinanceFilters(Object.fromEntries(toFinanceSearchParams(f, "2026-10-29")), "2026-10-29");
    expect(g).toEqual(f);
  });
  it("omite os padrões", () => {
    const f = parseFinanceFilters({}, "2026-10-29");
    expect(toFinanceSearchParams(f, "2026-10-29").toString()).toBe("");
  });
  it("só alterados: padrão falso, vai e volta pela URL", () => {
    expect(parseFinanceFilters({}, "2026-10-29").onlyChanged).toBe(false);
    const f = parseFinanceFilters({ changed: "1" }, "2026-10-29");
    expect(f.onlyChanged).toBe(true);
    expect(toFinanceSearchParams(f, "2026-10-29").get("changed")).toBe("1");
    expect(parseFinanceFilters(Object.fromEntries(toFinanceSearchParams(f, "2026-10-29")), "2026-10-29")).toEqual(f);
  });
  it("aceita lista repetida (array)", () => {
    expect(parseFinanceFilters({ clients: ["a", "b"] }, "2026-10-29").clients).toEqual(["a", "b"]);
  });
});
