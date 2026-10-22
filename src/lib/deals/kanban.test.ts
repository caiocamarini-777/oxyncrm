import { describe, expect, it } from "vitest";
import { cardValue, groupByStage, isRotting, positionBetween } from "./kanban";

describe("positionBetween", () => {
  it("meio e extremos", () => {
    expect(positionBetween(1, 2)).toBe(1.5);
    expect(positionBetween(null, 1)).toBe(-1023);
    expect(positionBetween(5, null)).toBe(1029);
    expect(positionBetween(null, null)).toBe(0);
  });
});

describe("cardValue", () => {
  const d = { contractValue: 7000, estimatedValue: 900, mrr: 500, setupTotal: 1000 };
  it("total usa o contrato quando há", () => {
    expect(cardValue(d, "total")).toBe(7000);
    expect(cardValue({ ...d, contractValue: 0 }, "total")).toBe(900);
    expect(cardValue({ ...d, contractValue: 0, estimatedValue: null }, "total")).toBe(0);
  });
  it("mrr e setup", () => {
    expect(cardValue(d, "mrr")).toBe(500);
    expect(cardValue(d, "setup")).toBe(1000);
  });
});

describe("isRotting", () => {
  const now = new Date("2026-10-22T12:00:00Z");
  const entered = "2026-10-12T12:00:00Z";
  it("passou do limite e aberto", () => {
    expect(isRotting({ status: "open", stageEnteredAt: entered }, { rottingDays: 7 }, now)).toBe(true);
  });
  it("ganho, sem limite ou dentro do prazo não esfria", () => {
    expect(isRotting({ status: "won", stageEnteredAt: entered }, { rottingDays: 7 }, now)).toBe(false);
    expect(isRotting({ status: "open", stageEnteredAt: entered }, { rottingDays: null }, now)).toBe(false);
    expect(isRotting({ status: "open", stageEnteredAt: entered }, { rottingDays: 11 }, now)).toBe(false);
  });
});

describe("groupByStage", () => {
  it("agrupa na ordem das etapas, mantendo a ordem dos negócios", () => {
    const g = groupByStage(
      [{ id: "a", stageId: "s2" }, { id: "b", stageId: "s1" }, { id: "c", stageId: "s2" }],
      [{ id: "s1" }, { id: "s2" }, { id: "s3" }],
    );
    expect(g.map((x) => [x.stage.id, x.deals.map((d) => d.id)])).toEqual([["s1", ["b"]], ["s2", ["a", "c"]], ["s3", []]]);
  });
});
