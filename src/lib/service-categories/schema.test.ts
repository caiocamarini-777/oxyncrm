import { describe, expect, it } from "vitest";
import { serviceCategorySchema } from "./schema";

describe("serviceCategorySchema", () => {
  it("aceita um nome válido", () => {
    expect(serviceCategorySchema.safeParse({ name: "Serviço SEO/GEO" }).success).toBe(true);
  });

  it("aceita cor hexadecimal", () => {
    expect(serviceCategorySchema.safeParse({ name: "SEO", color: "#1A2b3C" }).success).toBe(true);
  });

  it("rejeita nome vazio", () => {
    const r = serviceCategorySchema.safeParse({ name: "   " });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0].message).toBe("Informe o nome da categoria.");
  });

  it("rejeita nome com mais de 80 caracteres", () => {
    expect(serviceCategorySchema.safeParse({ name: "a".repeat(81) }).success).toBe(false);
  });

  it("rejeita cor que não é hexadecimal", () => {
    expect(serviceCategorySchema.safeParse({ name: "SEO", color: "red" }).success).toBe(false);
  });
});
