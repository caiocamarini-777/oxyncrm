import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { GmailAuthError, GmailClient, refreshAccessToken } from "./client";
import { decryptToken, encryptToken } from "./crypto";
import { gmailConfig } from "./oauth";

/** Renova quando falta menos de 60 s para expirar (ou quando não há token guardado). */
export const REFRESH_MARGIN_MS = 60_000;

export function needsRefresh(expiresAt: string | Date | null | undefined, now: number = Date.now()): boolean {
  if (!expiresAt) return true;
  const t = new Date(expiresAt).getTime();
  if (Number.isNaN(t)) return true;
  return t - now < REFRESH_MARGIN_MS;
}

type SecretRow = { refresh_token_enc: string; access_token_enc: string | null; access_expires_at: string | null };

function requireKey(): string {
  const cfg = gmailConfig();
  if (!cfg) throw new Error("Integração com o Gmail não configurada");
  return cfg.tokenKey;
}

/** Marca a caixa como `reconnect` e guarda o motivo. */
export async function markReconnect(accountId: string, msg: string): Promise<void> {
  const db = createAdminClient();
  const { error } = await db
    .from("email_accounts")
    .update({ status: "reconnect", last_error: msg.slice(0, 500) })
    .eq("id", accountId);
  if (error) console.error("gmail: falha ao marcar reconexão:", error.message);
}

/**
 * Access token vigente da caixa. Renova se faltar menos de 60 s (ou com `forceRefresh`) e grava o
 * novo token cifrado. `invalid_grant` marca a conta como `reconnect` e relança GmailAuthError.
 */
export async function loadAccountToken(accountId: string, opts: { forceRefresh?: boolean } = {}): Promise<string> {
  const key = requireKey();
  const db = createAdminClient();
  const { data, error } = await db
    .from("email_account_secrets")
    .select("refresh_token_enc, access_token_enc, access_expires_at")
    .eq("account_id", accountId)
    .maybeSingle()
    .overrideTypes<SecretRow, { merge: false }>();
  if (error) throw new Error(`Falha ao ler os tokens da caixa: ${error.message}`);
  if (!data) throw new Error("Caixa sem tokens guardados");

  if (!opts.forceRefresh && data.access_token_enc && !needsRefresh(data.access_expires_at)) {
    return decryptToken(data.access_token_enc, key);
  }

  let fresh: { accessToken: string; expiresAt: Date };
  try {
    fresh = await refreshAccessToken(decryptToken(data.refresh_token_enc, key));
  } catch (e) {
    if (e instanceof GmailAuthError) await markReconnect(accountId, e.message);
    throw e;
  }
  const { error: upErr } = await db
    .from("email_account_secrets")
    .update({ access_token_enc: encryptToken(fresh.accessToken, key), access_expires_at: fresh.expiresAt.toISOString() })
    .eq("account_id", accountId);
  if (upErr) console.error("gmail: falha ao gravar o novo access token:", upErr.message);
  return fresh.accessToken;
}

export function clientForAccount(accountId: string): GmailClient {
  return new GmailClient((opts) => loadAccountToken(accountId, opts));
}
