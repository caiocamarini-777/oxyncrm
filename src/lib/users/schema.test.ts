import { describe, expect, it } from "vitest";
import { inviteSchema } from "./schema";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const R = "33333333-3333-4333-8333-333333333333";

const base = {
  email: "ana@oxyn.test",
  fullName: "Ana Souza",
  isSuperAdmin: false,
  access: [{ companyId: A, roleId: R }],
  teamIds: [],
};

describe("inviteSchema", () => {
  it("aceita convite válido com uma empresa", () => {
    expect(inviteSchema.safeParse(base).success).toBe(true);
  });
  it("recusa empresa repetida", () => {
    const r = inviteSchema.safeParse({
      ...base,
      access: [
        { companyId: A, roleId: R },
        { companyId: A, roleId: R },
      ],
    });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0].message).toBe("Esta empresa já foi adicionada.");
  });
  it("aceita empresas diferentes", () => {
    const r = inviteSchema.safeParse({
      ...base,
      access: [
        { companyId: A, roleId: R },
        { companyId: B, roleId: R },
      ],
    });
    expect(r.success).toBe(true);
  });
  it("acesso vazio só com admin geral", () => {
    expect(inviteSchema.safeParse({ ...base, access: [] }).success).toBe(false);
    expect(inviteSchema.safeParse({ ...base, access: [], isSuperAdmin: true }).success).toBe(true);
  });
  it("recusa e-mail inválido", () => {
    expect(inviteSchema.safeParse({ ...base, email: "ana@" }).success).toBe(false);
  });
});
