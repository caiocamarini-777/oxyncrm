"use server";

import { z } from "zod";
import { getCurrentProfile } from "@/lib/auth/session";
import { translateDbError, type ActionResult } from "@/lib/db-errors";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerClient } from "@/lib/supabase/server";

const uuid = z.string().uuid();

/** Bucket privado dos arquivos importados (criado na migration). */
const BUCKET = "record-files";
/** Validade da URL assinada do download, em segundos. */
const SIGNED_URL_SECONDS = 60;

/**
 * Corpo de um e-mail importado do Pipedrive, carregado quando o usuário abre a mensagem. O Pipedrive guarda
 * só o HTML (`text` sempre nulo). Usa o cliente do usuário: a RLS de `pipedrive_emails` limita ao que ele pode ler.
 */
export async function getPipedriveEmailBody(emailId: string): Promise<ActionResult<{ html: string | null; text: null }>> {
  if (!uuid.safeParse(emailId).success) return { ok: false, error: "Dados inválidos." };
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, error: "Você não tem permissão para esta ação." };
  const supabase = await createServerClient();
  const { data, error } = await supabase.from("pipedrive_emails").select("body_html").eq("id", emailId).maybeSingle();
  if (error) return { ok: false, error: translateDbError(error) };
  if (!data) return { ok: false, error: "Mensagem não encontrada." };
  return { ok: true, data: { html: (data as { body_html: string | null }).body_html ?? null, text: null } };
}

/** Só links http(s): um `javascript:` vindo do Pipedrive não pode virar URL aberta pela tela. */
function isWebUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

/**
 * URL para baixar ou abrir um arquivo importado (do card ou anexo de e-mail). A linha é lida pelo cliente do
 * usuário, então a RLS (`can_read_record_file`) confere o acesso; só depois o cliente administrativo gera a
 * URL assinada de 60 segundos (o bucket não tem policy para usuários). Link externo devolve o próprio link.
 */
export async function getRecordFileUrl(fileId: string): Promise<ActionResult<{ url: string }>> {
  if (!uuid.safeParse(fileId).success) return { ok: false, error: "Dados inválidos." };
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, error: "Você não tem permissão para esta ação." };
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("record_files")
    .select("storage_path, remote_url")
    .eq("id", fileId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) return { ok: false, error: translateDbError(error) };
  if (!data) return { ok: false, error: "Arquivo não encontrado." };
  const file = data as { storage_path: string | null; remote_url: string | null };

  if (file.storage_path) {
    const signed = await createAdminClient().storage.from(BUCKET).createSignedUrl(file.storage_path, SIGNED_URL_SECONDS);
    if (signed.error || !signed.data?.signedUrl) {
      console.error("[pipedrive-email] url assinada:", signed.error?.message);
      return { ok: false, error: "Não foi possível abrir o arquivo. Tente novamente." };
    }
    return { ok: true, data: { url: signed.data.signedUrl } };
  }
  if (file.remote_url) {
    if (!isWebUrl(file.remote_url)) return { ok: false, error: "O link deste arquivo é inválido." };
    return { ok: true, data: { url: file.remote_url } };
  }
  return { ok: false, error: "Este arquivo não foi trazido do Pipedrive (maior que 25 MB)." };
}
