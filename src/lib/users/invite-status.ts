/**
 * Prazo do link de convite. Precisa bater com "Email OTP Expiration" do Supabase (10800 s),
 * que é quem de fato invalida o link.
 */
export const INVITE_TTL_HOURS = 3;

export type InviteStatus = "accepted" | "pending" | "expired";

/**
 * Situação do convite de um usuário. Quem já entrou alguma vez aceitou; senão, o prazo conta
 * do envio mais recente (convite original ou reenvio, que gera um link de recuperação).
 */
export function inviteStatus(
  u: { lastSignInAt: string | null; invitedAt: string | null; recoverySentAt: string | null },
  now: Date = new Date(),
): InviteStatus {
  if (u.lastSignInAt) return "accepted";
  const sent = Math.max(
    u.invitedAt ? Date.parse(u.invitedAt) : 0,
    u.recoverySentAt ? Date.parse(u.recoverySentAt) : 0,
  );
  if (!sent) return "expired";
  return now.getTime() - sent > INVITE_TTL_HOURS * 3600_000 ? "expired" : "pending";
}
