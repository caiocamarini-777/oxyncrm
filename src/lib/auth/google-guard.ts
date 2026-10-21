/** Conta criada apenas por login Google, sem convite (não existe cadastro aberto). */
export function isUninvitedGoogleSignup(user: {
  invited_at?: string | null;
  identities?: { provider: string }[];
}): boolean {
  if (user.invited_at) return false;
  const identities = user.identities ?? [];
  return identities.length > 0 && identities.every((i) => i.provider === "google");
}
