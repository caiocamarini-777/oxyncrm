import { describe, expect, it } from "vitest";
import { productSchema } from "./schema";

describe("productSchema", () => {
  it("aceita preço em formato BRL", () => {
    expect(productSchema.parse({ name: "Setup", kind: "setup", defaultPrice: "1.500,00" }).defaultPrice).toBe(1500);
    expect(productSchema.parse({ name: "Setup", kind: "setup", defaultPrice: "" }).defaultPrice).toBe(0);
  });
  it("rejeita nome vazio, preço negativo e tipo inválido", () => {
    expect(productSchema.safeParse({ name: "", kind: "setup", defaultPrice: "1" }).success).toBe(false);
    expect(productSchema.safeParse({ name: "a".repeat(121), kind: "setup", defaultPrice: "1" }).success).toBe(false);
    expect(productSchema.safeParse({ name: "A", kind: "setup", defaultPrice: "-1" }).success).toBe(false);
    expect(productSchema.safeParse({ name: "A", kind: "x", defaultPrice: "1" }).success).toBe(false);
  });
});
