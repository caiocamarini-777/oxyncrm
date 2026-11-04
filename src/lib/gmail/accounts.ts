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

type AccessToken = { accessToken: string; expiresAt: number };

/**
 * Access token vigente da caixa. Renova se faltar menos de 60 s (ou com `forceRefresh`) e grava o
 * novo token cifrado. `invalid_grant` marca a conta como `reconnect` e relança GmailAuthError.
 */
export async function loadAccountToken(accountId: string, opts: { forceRefresh?: boolean } = {}): Promise<string> {
  return (await loadAccessToken(accountId, opts)).accessToken;
}

/** Como `loadAccountToken`, devolvendo também o vencimento (ms desde 1970). */
async function loadAccessToken(accountId: string, opts: { forceRefresh?: boolean } = {}): Promise<AccessToken> {
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
    return { accessToken: decryptToken(data.access_token_enc, key), expiresAt: new Date(data.access_expires_at!).getTime() };
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
  return { accessToken: fresh.accessToken, expiresAt: fresh.expiresAt.getTime() };
}

/**
 * Cliente do Gmail da caixa. O access token fica em memória (neste cliente) até 60 s antes de vencer, e
 * chamadas simultâneas compartilham uma única leitura/renovação. Depois de um 401, só renova de novo se o
 * token recusado ainda é o guardado (outra chamada pode já ter renovado).
 */
export function clientForAccount(accountId: string, now: () => number = Date.now): GmailClient {
  let cached: AccessToken | null = null;
  let pending: { force: boolean; promise: Promise<AccessToken> } | null = null;

  const load = (force: boolean): Promise<AccessToken> => {
    // Uma renovação forçada não pode reaproveitar uma leitura comum em andamento (traria o token recusado).
    if (pending && (pending.force || !force)) return pending.promise;
    const promise = loadAccessToken(accountId, { forceRefresh: force })
      .then((t) => {
        // Uma leitura comum que termina depois de uma renovação não volta ao token mais velho.
        if (!cached || t.expiresAt >= cached.expiresAt) cached = t;
        return t;
      })
      .finally(() => {
        if (pending?.promise === promise) pending = null;
      });
    pending = { force, promise };
    return promise;
  };

  return new GmailClient(async (opts) => {
    if (opts?.forceRefresh) {
      if (cached && opts.rejected && cached.accessToken !== opts.rejected && !needsRefresh(new Date(cached.expiresAt), now()))
        return cached.accessToken;
      return (await load(true)).accessToken;
    }
    if (cached && !needsRefresh(new Date(cached.expiresAt), now())) return cached.accessToken;
    return (await load(false)).accessToken;
  });
}
