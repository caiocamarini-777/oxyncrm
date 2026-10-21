import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const generateLink = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ auth: { admin: { generateLink } } }),
}));

afterEach(() => {
  vi.unstubAllEnvs();
  generateLink.mockReset();
});

describe("createAuthLink", () => {
  it("falha sem NEXT_PUBLIC_SITE_URL, antes de gerar o link", async () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "");
    const { createAuthLink } = await import("./links");
    await expect(createAuthLink("invite", "a@b.c")).rejects.toThrow(
      "NEXT_PUBLIC_SITE_URL não configurado",
    );
    expect(generateLink).not.toHaveBeenCalled();
  });
  it("monta o link com o site configurado", async () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://crm.example");
    generateLink.mockResolvedValue({
      data: { properties: { hashed_token: "tok" }, user: { id: "u1" } },
      error: null,
    });
    const { createAuthLink } = await import("./links");
    const r = await createAuthLink("recovery", "a@b.c");
    expect(r.link).toBe("https://crm.example/auth/confirm?token_hash=tok&type=recovery&next=/definir-senha");
  });
});
