"use server";

import { z } from "zod";
import { getCurrentProfile } from "@/lib/auth/session";
import { translateDbError, type ActionResult } from "@/lib/db-errors";
import { createServerClient } from "@/lib/supabase/server";

const uuid = z.string().uuid();

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
