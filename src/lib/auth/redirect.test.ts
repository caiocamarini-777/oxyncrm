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
  it("rejeita caracteres de controle que o parser de URL remove", () => {
    expect(safeNext("/\t/evil.com")).toBe("/");
    expect(safeNext("/\n/evil.com")).toBe("/");
    expect(safeNext("/\r//evil.com")).toBe("/");
    expect(safeNext(decodeURIComponent("/%09/evil.com"))).toBe("/");
  });
  it("preserva query e hash", () => {
    expect(safeNext("/a?b=1#c")).toBe("/a?b=1#c");
  });
  it("rejeita segmentos de ponto que colapsam em //", () => {
    for (const n of ["/.//evil.com", "/..//evil.com", "/a/..//evil.com", "/%2e//evil.com"]) {
      expect(safeNext(n)).toBe("/");
    }
  });
});
