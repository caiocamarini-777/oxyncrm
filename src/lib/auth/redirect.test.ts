import { describe, expect, it } from "vitest";
import { safeNext } from "./redirect";

describe("safeNext", () => {
  it("aceita caminhos internos", () => {
    expect(safeNext("/volt/inicio")).toBe("/volt/inicio");
  });
  it("cai para / quando nulo", () => {
    expect(safeNext(null)).toBe("/");
  });
  it("rejeita URLs externas", () => {
    expect(safeNext("https://evil.com")).toBe("/");
    expect(safeNext("//evil.com")).toBe("/");
    expect(safeNext("/\\evil.com")).toBe("/");
  });
});
