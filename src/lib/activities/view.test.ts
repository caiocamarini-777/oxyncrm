import { describe, expect, it } from "vitest";
import { agendaRange, groupByDay, parseActivityListQuery, parseAnchor, parseView, shiftAnchor } from "./view";

const U1 = "11111111-1111-4111-8111-111111111111";

describe("parseView / parseAnchor", () => {
  it("visão padrão é lista", () => {
    expect(parseView(null)).toBe("lista");
    expect(parseView("xyz")).toBe("lista");
    expect(parseView("semana")).toBe("semana");
    expect(parseView("mes")).toBe("mes");
  });
  it("âncora inválida cai no dia de hoje", () => {
    expect(parseAnchor("2026-10-22", "2026-01-01")).toBe("2026-10-22");
    expect(parseAnchor("2026-02-31", "2026-01-01")).toBe("2026-01-01");
    expect(parseAnchor("lixo", "2026-01-01")).toBe("2026-01-01");
    expect(parseAnchor(null, "2026-01-01")).toBe("2026-01-01");
  });
  it("ano fora de hoje mais ou menos 100 anos cai em hoje", () => {
    expect(parseAnchor("9999-12-31", "2026-10-22")).toBe("2026-10-22");
    expect(parseAnchor("0001-01-01", "2026-10-22")).toBe("2026-10-22");
    expect(parseAnchor("2126-10-22", "2026-10-22")).toBe("2126-10-22");
    expect(parseAnchor("2127-01-01", "2026-10-22")).toBe("2026-10-22");
  });
});

describe("parseActivityListQuery", () => {
  it("aba padrão é hoje; descarta ids inválidos", () => {
    const q = parseActivityListQuery(new URLSearchParams(`aba=atrasadas&type=${U1}&type=x&channel=y&team=${U1}`));
    expect(q.tab).toBe("overdue");
    expect(q.type).toEqual([U1]);
    expect(q.channel).toEqual([]);
    expect(q.team).toEqual([U1]);
    expect(parseActivityListQuery(new URLSearchParams("aba=foo")).tab).toBe("today");
    expect(parseActivityListQuery(new URLSearchParams("aba=concluidas")).tab).toBe("done");
    expect(parseActivityListQuery(new URLSearchParams("aba=proximas")).tab).toBe("upcoming");
  });
});

describe("shiftAnchor / agendaRange", () => {
  it("semana anda 7 dias", () => {
    expect(shiftAnchor("2026-10-22", "semana", 1)).toBe("2026-10-29");
    expect(shiftAnchor("2026-10-22", "semana", -1)).toBe("2026-10-15");
  });
  it("mês anda para o dia 1 do mês vizinho", () => {
    expect(shiftAnchor("2026-10-22", "mes", 1)).toBe("2026-11-01");
    expect(shiftAnchor("2026-01-15", "mes", -1)).toBe("2025-12-01");
    expect(shiftAnchor("2026-12-15", "mes", 1)).toBe("2027-01-01");
  });
  it("intervalos cobrem a grade inteira", () => {
    expect(agendaRange("2026-10-22", "semana")).toEqual({ from: "2026-10-19", to: "2026-10-25" });
    expect(agendaRange("2026-10-22", "mes")).toEqual({ from: "2026-09-28", to: "2026-11-01" });
  });
});

describe("groupByDay", () => {
  it("agrupa pelo dia de São Paulo", () => {
    const rows = [
      { dueAt: "2026-10-24T02:30:00Z" }, // 23/10 23h30 em SP
      { dueAt: "2026-10-24T13:00:00Z" },
    ];
    const g = groupByDay(rows);
    expect(g.get("2026-10-23")).toHaveLength(1);
    expect(g.get("2026-10-24")).toHaveLength(1);
  });
});
