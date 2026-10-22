import { describe, expect, it } from "vitest";
import { changedCustomFieldValues } from "./custom-fields-diff";

describe("changedCustomFieldValues", () => {
  it("ignora valores iguais aos armazenados", () => {
    expect(changedCustomFieldValues({ resp: "u1", obs: "novo" }, { resp: "u1", obs: "velho" })).toEqual({ obs: "novo" });
  });
  it("compara listas por conteúdo", () => {
    expect(changedCustomFieldValues({ tags: ["a", "b"] }, { tags: ["a", "b"] })).toEqual({});
    expect(changedCustomFieldValues({ tags: ["a"] }, { tags: ["a", "b"] })).toEqual({ tags: ["a"] });
  });
  it("sem registro atual, tudo conta como alterado", () => {
    expect(changedCustomFieldValues({ a: 1 }, null)).toEqual({ a: 1 });
    expect(changedCustomFieldValues({ a: null }, {})).toEqual({ a: null });
  });
});
