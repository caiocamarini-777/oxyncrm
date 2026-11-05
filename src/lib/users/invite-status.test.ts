import { describe, expect, it } from "vitest";
import { INVITE_TTL_HOURS, inviteStatus } from "./invite-status";

const NOW = new Date("2026-11-05T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3600_000).toISOString();

describe("inviteStatus", () => {
  it("o prazo do convite é de 3 horas", () => {
    expect(INVITE_TTL_HOURS).toBe(3);
  });

  it("quem já entrou alguma vez está aceito, mesmo com convite antigo", () => {
    expect(inviteStatus({ lastSignInAt: hoursAgo(1), invitedAt: hoursAgo(500), recoverySentAt: null }, NOW)).toBe(
      "accepted",
    );
  });

  it("convite enviado há menos de 3 horas está pendente", () => {
    expect(inviteStatus({ lastSignInAt: null, invitedAt: hoursAgo(2.9), recoverySentAt: null }, NOW)).toBe("pending");
  });

  it("convite enviado há mais de 3 horas está expirado", () => {
    expect(inviteStatus({ lastSignInAt: null, invitedAt: hoursAgo(3.1), recoverySentAt: null }, NOW)).toBe("expired");
  });

  it("o reenvio conta a partir do envio mais recente", () => {
    expect(inviteStatus({ lastSignInAt: null, invitedAt: hoursAgo(200), recoverySentAt: hoursAgo(1) }, NOW)).toBe(
      "pending",
    );
    expect(inviteStatus({ lastSignInAt: null, invitedAt: hoursAgo(1), recoverySentAt: hoursAgo(200) }, NOW)).toBe(
      "pending",
    );
  });

  it("sem registro de envio conta como expirado, para permitir reenviar", () => {
    expect(inviteStatus({ lastSignInAt: null, invitedAt: null, recoverySentAt: null }, NOW)).toBe("expired");
  });
});
