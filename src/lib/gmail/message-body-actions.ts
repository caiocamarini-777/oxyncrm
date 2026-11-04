"use server";

import { z } from "zod";
import { getCurrentProfile } from "@/lib/auth/session";
import { translateDbError, type ActionResult } from "@/lib/db-errors";
import { createServerClient } from "@/lib/supabase/server";

const uuid = z.string().uuid();

export type EmailMessageBody = { html: string | null; text: string | null };

/**
 * Corpo de uma mensagem (HTML e texto), carregado quando o usuário abre a conversa.
 * Usa o cliente do usuário: a RLS de `email_messages` já limita ao que ele pode ler.
 */
export async function getEmailMessageBody(messageId: string): Promise<ActionResult<EmailMessageBody>> {
  if (!uuid.safeParse(messageId).success) return { ok: false, error: "Dados inválidos." };
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, error: "Você não tem permissão para esta ação." };
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("email_messages")
    .select("body_html, body_text")
    .eq("id", messageId)
    .maybeSingle();
  if (error) return { ok: false, error: translateDbError(error) };
  if (!data) return { ok: false, error: "Mensagem não encontrada." };
  return { ok: true, data: { html: data.body_html ?? null, text: data.body_text ?? null } };
}
