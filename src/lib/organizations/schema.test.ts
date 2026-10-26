import { describe, expect, it } from "vitest";
import { normalizeDomain, organizationSchema } from "./schema";

const base = { name: "Volt" };

describe("organizationSchema", () => {
  it("normaliza o domínio", () => {
    const r = organizationSchema.parse({ ...base, domain: "https://www.Volt.com.br/" });
    expect(r.domain).toBe("volt.com.br");
    expect(normalizeDomain("HTTP://Volt.com.br/contato?x=1")).toBe("volt.com.br");
  });
  it("aceita sem CNPJ", () => {
    const r = organizationSchema.parse(base);
    expect(r.cnpj).toBeNull();
    expect(r.domain).toBeNull();
    expect(r.address).toEqual({});
  });
  it("normaliza CNPJ válido e rejeita inválido", () => {
    expect(organizationSchema.parse({ ...base, cnpj: "11.222.333/0001-81" }).cnpj).toBe("11222333000181");
    expect(organizationSchema.safeParse({ ...base, cnpj: "11.222.333/0001-82" }).success).toBe(false);
  });
  it("rejeita UF inexistente e CEP com 7 dígitos", () => {
    expect(organizationSchema.safeParse({ ...base, address: { state: "XX" } }).success).toBe(false);
    expect(organizationSchema.safeParse({ ...base, address: { zip: "1234567" } }).success).toBe(false);
  });
  it("aceita endereço válido e normaliza", () => {
    const r = organizationSchema.parse({ ...base, address: { state: "sp", zip: "01310-100", city: " São Paulo " } });
    expect(r.address).toEqual({ state: "SP", zip: "01310100", city: "São Paulo" });
  });
  it("valida o nome", () => {
    expect(organizationSchema.safeParse({ name: "  " }).success).toBe(false);
    expect(organizationSchema.safeParse({ name: "a".repeat(201) }).success).toBe(false);
  });
  it("rejeita domínio sem ponto", () => {
    expect(organizationSchema.safeParse({ ...base, domain: "localhost" }).success).toBe(false);
  });
});
