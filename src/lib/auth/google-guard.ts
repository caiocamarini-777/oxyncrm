/** Conta nova criada agora por login Google, sem convite. */
export function isUninvitedGoogleSignup(
  user: { invited_at?: string | null; created_at: string; identities?: { provider: string }[] },
  now: Date,
): boolean {
  if (user.invited_at) return false;
  const identities = user.identities ?? [];
  if (identities.length === 0 || !identities.every((i) => i.provider === "google")) return false;
  const age = now.getTime() - new Date(user.created_at).getTime();
  return age >= -60_000 && age < 5 * 60_000;
}
