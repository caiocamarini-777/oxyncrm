"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentProfile } from "@/lib/auth/session";
import { translateDbError, type ActionResult } from "@/lib/db-errors";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerClient } from "@/lib/supabase/server";
import { revokeToken } from "./client";
import { decryptToken } from "./crypto";
import { gmailConfig } from "./oauth";

const uuid = z.string().uuid();
const DENIED = { ok: false, error: "Você não tem permissão para esta ação." } as const;
const NOT_FOUND = { ok: false, error: "Caixa não encontrada." } as const;

/** Compartilhada ou privada. A RLS só deixa o dono mudar esta coluna. */
export async function setMailboxVisibility(
  accountId: string,
  visibility: "shared" | "private",
): Promise<ActionResult> {
  if (!uuid.safeParse(accountId).success || (visibility !== "shared" && visibility !== "private"))
    return { ok: false, error: "Dados inválidos." };
  const profile = await getCurrentProfile();
  if (!profile) return DENIED;
  const supabase = await createServerClient();
  // O admin geral também lê as caixas dos outros: o filtro por dono mantém a regra "só o dono".
  const { data, error } = await supabase
    .from("email_accounts")
    .update({ visibility })
    .eq("id", accountId)
    .eq("user_id", profile.id)
    .select("id");
  if (error) return { ok: false, error: translateDbError(error) };
  if (!data || data.length === 0) return NOT_FOUND;
  revalidatePath("/perfil");
  return { ok: true, data: undefined };
}

/** Só o dono. Revoga o acesso no Google em melhor esforço e apaga a caixa (a cascata leva as conversas). */
export async function disconnectMailbox(accountId: string): Promise<ActionResult> {
  if (!uuid.safeParse(accountId).success) return { ok: false, error: "Dados inválidos." };
  const profile = await getCurrentProfile();
  if (!profile) return DENIED;
  const supabase = await createServerClient();
  const found = await supabase
    .from("email_accounts")
    .select("id, user_id")
    .eq("id", accountId)
    .eq("user_id", profile.id)
    .maybeSingle();
  if (found.error) return { ok: false, error: translateDbError(found.error) };
  if (!found.data) return NOT_FOUND;

  await revokeBestEffort(accountId);

  const { data, error } = await supabase
    .from("email_accounts")
    .delete()
    .eq("id", accountId)
    .eq("user_id", profile.id)
    .select("id");
  if (error) return { ok: false, error: translateDbError(error) };
  if (!data || data.length === 0) return NOT_FOUND;
  revalidatePath("/perfil");
  return { ok: true, data: undefined };
}

/** Qualquer falha aqui é ignorada: a caixa sai do CRM mesmo assim. */
async function revokeBestEffort(accountId: string): Promise<void> {
  try {
    const cfg = gmailConfig();
    if (!cfg) return;
    const { data } = await createAdminClient()
      .from("email_account_secrets")
      .select("refresh_token_enc")
      .eq("account_id", accountId)
      .maybeSingle();
    const enc = (data as { refresh_token_enc?: string } | null)?.refresh_token_enc;
    if (!enc) return;
    await revokeToken(decryptToken(enc, cfg.tokenKey));
  } catch (e) {
    console.error("gmail: não foi possível revogar o token:", e instanceof Error ? e.message : e);
  }
}
