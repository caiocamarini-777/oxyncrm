import { describe, expect, it } from "vitest";
import { parseDealListQuery, parseDealView } from "./query";

const A = "11111111-1111-4111-8111-111111111111";

describe("parseDealListQuery", () => {
  it("descarta ids inválidos e lê rotting", () => {
    const p = new URLSearchParams(
      `pipeline=${A}&stage=${A}&stage=x&team=bad&owner=${A}&owner=zz&label=nope&rotting=1&status=won`,
    );
    const q = parseDealListQuery(p, ["title"]);
    expect(q.pipeline).toBe(A);
    expect(q.stage).toEqual([A]);
    expect(q.team).toEqual([]);
    expect(q.owner).toEqual([A]);
    expect(q.label).toEqual([]);
    expect(q.rotting).toBe(true);
    expect(q.status).toEqual(["won"]);
  });
  it("padrões", () => {
    const q = parseDealListQuery(new URLSearchParams("pipeline=abc&rotting=0"), []);
    expect(q.pipeline).toBeNull();
    expect(q.rotting).toBe(false);
  });
});

describe("parseDealView", () => {
  it("kanban é o padrão; aceita lista e forecast", () => {
    expect(parseDealView(null)).toBe("kanban");
    expect(parseDealView("xyz")).toBe("kanban");
    expect(parseDealView("lista")).toBe("lista");
    expect(parseDealView("forecast")).toBe("forecast");
  });
});
