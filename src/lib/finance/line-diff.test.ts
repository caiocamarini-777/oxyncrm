import { describe, expect, it } from "vitest";
import { diffLineIds } from "./line-diff";

describe("diffLineIds", () => {
  it("mantém ids existentes, insere novas e remove as que sumiram", () => {
    const r = diffLineIds(["a", "b", "c"], [{ id: "b" }, {}, { id: "a" }, { id: "zzz" }]);
    expect(r.update).toEqual([0, 2]);
    expect(r.insert).toEqual([1, 3]);
    expect(r.remove).toEqual(["c"]);
  });
  it("id repetido vira linha nova", () => {
    const r = diffLineIds(["a"], [{ id: "a" }, { id: "a" }]);
    expect(r.update).toEqual([0]);
    expect(r.insert).toEqual([1]);
  });
});
