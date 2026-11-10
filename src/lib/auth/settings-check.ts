export const SIGNUP_ENABLED_MESSAGE =
  "O cadastro aberto está ligado no Supabase. Desligue 'Allow new users to sign up' antes de continuar.";

export const EMAIL_LOGIN_DISABLED_MESSAGE =
  "O login por e-mail está desligado no Supabase: ninguém entra com e-mail e senha. Ligue o provedor Email.";

type AuthSettings = { disable_signup?: boolean; external?: { email?: boolean } };

async function readAuthSettings(supabaseUrl: string, anonKey: string): Promise<AuthSettings> {
  const res = await fetch(`${supabaseUrl}/auth/v1/settings`, {
    headers: { apikey: anonKey },
  });
  if (!res.ok) {
    throw new Error(
      `Não foi possível ler as configurações de autenticação (HTTP ${res.status}).`,
    );
  }
  return (await res.json()) as AuthSettings;
}

/** Falha se o Supabase Auth ainda aceita cadastro aberto (disable_signup !== true). */
export async function assertSignupDisabled(
  supabaseUrl: string,
  anonKey: string,
): Promise<void> {
  const settings = await readAuthSettings(supabaseUrl, anonKey);
  if (settings.disable_signup !== true) throw new Error(SIGNUP_ENABLED_MESSAGE);
}

/** Falha se o provedor Email está desligado (external.email !== true): o login com senha deixa de funcionar. */
export async function assertEmailLoginEnabled(
  supabaseUrl: string,
  anonKey: string,
): Promise<void> {
  const settings = await readAuthSettings(supabaseUrl, anonKey);
  if (settings.external?.email !== true) throw new Error(EMAIL_LOGIN_DISABLED_MESSAGE);
}
