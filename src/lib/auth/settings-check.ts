export const SIGNUP_ENABLED_MESSAGE =
  "O cadastro aberto está ligado no Supabase. Desligue 'Allow new users to sign up' antes de continuar.";

/** Falha se o Supabase Auth ainda aceita cadastro aberto (disable_signup !== true). */
export async function assertSignupDisabled(
  supabaseUrl: string,
  anonKey: string,
): Promise<void> {
  const res = await fetch(`${supabaseUrl}/auth/v1/settings`, {
    headers: { apikey: anonKey },
  });
  if (!res.ok) {
    throw new Error(
      `Não foi possível ler as configurações de autenticação (HTTP ${res.status}).`,
    );
  }
  const settings = (await res.json()) as { disable_signup?: boolean };
  if (settings.disable_signup !== true) throw new Error(SIGNUP_ENABLED_MESSAGE);
}
