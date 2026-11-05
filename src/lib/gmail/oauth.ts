import { randomBytes } from "node:crypto";
import { MEET_SCOPES } from "./connect";

export const GMAIL_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
  ...MEET_SCOPES,
];

export function buildAuthUrl(opts: { clientId: string; redirectUri: string; state: string }): string {
  const p = new URLSearchParams({
    client_id: opts.clientId,
    redirect_uri: opts.redirectUri,
    response_type: "code",
    scope: GMAIL_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    state: opts.state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p.toString()}`;
}

/** Valor aleatório contra CSRF no retorno do OAuth. */
export function newState(): string {
  return randomBytes(32).toString("base64url");
}

export type GmailConfig = { clientId: string; clientSecret: string; tokenKey: string };

/** Lê o env na hora da chamada. null se faltar algo ou se a chave não tiver 32 bytes. */
export function gmailConfig(): GmailConfig | null {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  const tokenKey = process.env.GMAIL_TOKEN_KEY?.trim();
  if (!clientId || !clientSecret || !tokenKey) return null;
  if (Buffer.from(tokenKey, "base64").length !== 32) return null;
  return { clientId, clientSecret, tokenKey };
}
