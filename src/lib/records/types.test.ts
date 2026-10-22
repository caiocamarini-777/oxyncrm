import { describe, expect, it } from "vitest";
import { recordHref } from "./types";

describe("recordHref", () => {
  it("leads", () => expect(recordHref("leads", "oxyn", "1")).toBe("/oxyn/leads/1"));
  it("pessoas", () => expect(recordHref("persons", "oxyn", "1")).toBe("/oxyn/contatos/pessoas/1"));
  it("organizações", () =>
    expect(recordHref("organizations", "acme", "2")).toBe("/acme/contatos/organizacoes/2"));
});
