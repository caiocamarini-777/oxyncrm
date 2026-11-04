import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerClient } from "@/lib/supabase/server";
import type { TokenSet } from "./client";
import { decideMailbox, type GmailErrorReason } from "./connect";
import { encryptToken } from "./crypto";

/** O RLS de `companies` já limita ao que o usuário enxerga; aqui só tiramos as arquivadas. */
export async function userCanUseCompany(companyId: string): Promise<boolean> {
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("companies")
    .select("id")
    .eq("id", companyId)
    .is("archived_at", null)
    .maybeSingle();
  return !error && !!data;
}

export type SaveMailboxResult = { ok: true } | { ok: false; reason: GmailErrorReason };

/** Cria ou atualiza a caixa e os segredos com o cliente admin (a RLS não deixa o usuário inserir). */
export async function saveMailbox(opts: {
  userId: string;
  companyId: string;
  email: string;
  tokens: TokenSet;
  tokenKey: string;
}): Promise<SaveMailboxResult> {
  const db = createAdminClient();
  const email = opts.email.trim().toLowerCase();
  const { tokens, tokenKey } = opts;

  const found = await db.from("email_accounts").select("id, user_id").eq("email", email).maybeSingle();
  if (found.error) {
    console.error("gmail: falha ao buscar a caixa:", found.error.message);
    return { ok: false, reason: "falha" };
  }
  const existing = found.data as { id: string; user_id: string } | null;
  const decision = decideMailbox(existing, opts.userId, !!tokens.refreshToken);
  if (decision.kind === "reject") return { ok: false, reason: decision.reason };

  const access = {
    access_token_enc: encryptToken(tokens.accessToken, tokenKey),
    access_expires_at: tokens.expiresAt.toISOString(),
  };

  if (decision.kind === "create") {
    const ins = await db
      .from("email_accounts")
      .insert({ user_id: opts.userId, company_id: opts.companyId, email })
      .select("id")
      .single();
    if (ins.error || !ins.data) {
      // 23505: outra requisição criou a mesma caixa um instante antes.
      if (ins.error?.code === "23505") return { ok: false, reason: "caixa_de_outro_usuario" };
      console.error("gmail: falha ao criar a caixa:", ins.error?.message);
      return { ok: false, reason: "falha" };
    }
    const accountId = (ins.data as { id: string }).id;
    const sec = await db.from("email_account_secrets").insert({
      account_id: accountId,
      refresh_token_enc: encryptToken(tokens.refreshToken!, tokenKey),
      ...access,
    });
    if (sec.error) {
      console.error("gmail: falha ao guardar os tokens:", sec.error.message);
      await db.from("email_accounts").delete().eq("id", accountId); // sem segredo a conta não serve
      return { ok: false, reason: "falha" };
    }
    return { ok: true };
  }

  // Mesma pessoa reconectando: troca os tokens, a empresa e limpa o estado de erro.
  const secrets = tokens.refreshToken
    ? await db
        .from("email_account_secrets")
        .upsert({
          account_id: decision.accountId,
          refresh_token_enc: encryptToken(tokens.refreshToken, tokenKey),
          ...access,
        })
        .select("account_id")
    : await db.from("email_account_secrets").update(access).eq("account_id", decision.accountId).select("account_id");
  if (secrets.error) {
    console.error("gmail: falha ao atualizar os tokens:", secrets.error.message);
    return { ok: false, reason: "falha" };
  }
  // Sem refresh token novo e sem segredo antigo, não há como sincronizar.
  if (!secrets.data || secrets.data.length === 0) return { ok: false, reason: "sem_refresh_token" };

  const up = await db
    .from("email_accounts")
    .update({ company_id: opts.companyId, status: "active", last_error: null })
    .eq("id", decision.accountId);
  if (up.error) {
    console.error("gmail: falha ao atualizar a caixa:", up.error.message);
    return { ok: false, reason: "falha" };
  }
  return { ok: true };
}
