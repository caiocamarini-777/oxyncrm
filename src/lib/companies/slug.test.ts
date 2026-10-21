import { describe, expect, it } from "vitest";
import { slugify } from "./slug";

describe("slugify", () => {
  it("remove acentos", () => expect(slugify("Harpix Indústria")).toBe("harpix-industria"));
  it("limpa pontas e símbolos", () => expect(slugify("  Volt  S/A ")).toBe("volt-s-a"));
  it("evita o slug reservado", () => expect(slugify("Todas")).toBe("todas-1"));
});
