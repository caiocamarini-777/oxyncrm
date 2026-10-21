import { describe, expect, it } from "vitest";
import { RESERVED_SLUGS } from "./constants";
import { companySchema } from "./schema";

describe("companySchema slug reservado", () => {
  it.each(RESERVED_SLUGS)("recusa %s", (slug) => {
    const r = companySchema.safeParse({ name: "Empresa", slug });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0].message).toBe("Este endereço é reservado.");
  });
  it("aceita um slug comum", () => {
    expect(companySchema.safeParse({ name: "Empresa", slug: "volt" }).success).toBe(true);
  });
});
