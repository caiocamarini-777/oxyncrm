import { afterEach, describe, expect, it, vi } from "vitest";
import { assertSignupDisabled, SIGNUP_ENABLED_MESSAGE } from "./settings-check";

function mockFetch(body: unknown, ok = true, status = 200) {
  const fn = vi.fn().mockResolvedValue({ ok, status, json: async () => body });
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => vi.unstubAllGlobals());

describe("assertSignupDisabled", () => {
  it("passa quando disable_signup é true", async () => {
    const fn = mockFetch({ disable_signup: true });
    await expect(assertSignupDisabled("https://x.supabase.co", "anon")).resolves.toBeUndefined();
    expect(fn).toHaveBeenCalledWith("https://x.supabase.co/auth/v1/settings", {
      headers: { apikey: "anon" },
    });
  });
  it("falha quando disable_signup é false", async () => {
    mockFetch({ disable_signup: false });
    await expect(assertSignupDisabled("https://x.supabase.co", "anon")).rejects.toThrow(
      SIGNUP_ENABLED_MESSAGE,
    );
  });
  it("falha quando o campo está ausente", async () => {
    mockFetch({});
    await expect(assertSignupDisabled("https://x.supabase.co", "anon")).rejects.toThrow(
      "O cadastro aberto está ligado no Supabase.",
    );
  });
  it("falha quando a leitura falha", async () => {
    mockFetch({}, false, 500);
    await expect(assertSignupDisabled("https://x.supabase.co", "anon")).rejects.toThrow("HTTP 500");
  });
});
