import { describe, expect, it } from "vitest";
import { isUninvitedGoogleSignup } from "./google-guard";

const now = new Date("2026-10-21T12:00:00Z");
const fresh = "2026-10-21T11:58:00Z";

describe("isUninvitedGoogleSignup", () => {
  it("Google novo sem convite", () => {
    expect(isUninvitedGoogleSignup({ created_at: fresh, identities: [{ provider: "google" }] }, now)).toBe(true);
  });
  it("convidado", () => {
    expect(
      isUninvitedGoogleSignup(
        { created_at: fresh, invited_at: "2026-10-21T11:00:00Z", identities: [{ provider: "google" }] },
        now,
      ),
    ).toBe(false);
  });
  it("com identidade de e-mail", () => {
    expect(
      isUninvitedGoogleSignup(
        { created_at: fresh, identities: [{ provider: "email" }, { provider: "google" }] },
        now,
      ),
    ).toBe(false);
  });
  it("conta antiga", () => {
    expect(
      isUninvitedGoogleSignup({ created_at: "2026-10-01T00:00:00Z", identities: [{ provider: "google" }] }, now),
    ).toBe(false);
  });
});
