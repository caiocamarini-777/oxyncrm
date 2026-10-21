import { describe, expect, it } from "vitest";
import { formatCnpj, isValidCnpj } from "./cnpj";

describe("cnpj", () => {
  it("aceita válidos", () => {
    expect(isValidCnpj("11.222.333/0001-81")).toBe(true);
    expect(isValidCnpj("11222333000181")).toBe(true);
  });
  it("rejeita inválidos", () => {
    expect(isValidCnpj("11.222.333/0001-82")).toBe(false);
    expect(isValidCnpj("00000000000000")).toBe(false);
    expect(isValidCnpj("123")).toBe(false);
  });
  it("formata", () => expect(formatCnpj("11222333000181")).toBe("11.222.333/0001-81"));
});
