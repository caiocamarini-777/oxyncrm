import { describe, expect, it } from "vitest";
import { isUninvitedGoogleSignup } from "./google-guard";

describe("isUninvitedGoogleSignup", () => {
  it("Google novo sem convite", () => {
    expect(isUninvitedGoogleSignup({ identities: [{ provider: "google" }] })).toBe(true);
  });
  it("convidado", () => {
    expect(
      isUninvitedGoogleSignup(
        { invited_at: "2026-10-21T11:00:00Z", identities: [{ provider: "google" }] }
      ),
    ).toBe(false);
  });
  it("com identidade de e-mail", () => {
    expect(
      isUninvitedGoogleSignup(
        { identities: [{ provider: "email" }, { provider: "google" }] }
      ),
    ).toBe(false);
  });
  it("conta Google antiga sem convite também é recusada", () => {
    expect(isUninvitedGoogleSignup({ identities: [{ provider: "google" }] })).toBe(true);
  });
  it("sem identidades", () => {
    expect(isUninvitedGoogleSignup({ identities: [] })).toBe(false);
  });
});
