"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentProfile, requireSuperAdmin } from "@/lib/auth/session";
import { translateDbError, type ActionResult } from "@/lib/db-errors";
import { createServerClient } from "@/lib/supabase/server";

const PATH = "/configuracoes/modelos-email";
const uuid = z.string().uuid();
const DENIED = { ok: false, error: "Você não tem permissão para esta ação." } as const;
const INVALID = { ok: false, error: "Dados inválidos." } as const;

const templateSchema = z.object({
  name: z.string().trim().min(1, "Informe o nome.").max(120, "Use no máximo 120 caracteres."),
  subject: z.string().trim().max(300, "Use no máximo 300 caracteres."),
  body: z.string().max(20000, "Use no máximo 20.000 caracteres."),
});
export type EmailTemplateInput = z.input<typeof templateSchema>;

function invalid(error: z.ZodError): ActionResult<never> {
  const issue = error.issues[0];
  const field = String(issue.path[0] ?? "name");
  return { ok: false, error: issue.message, fieldErrors: { [field]: issue.message } };
}

/**
 * Quem pode criar, editar e excluir modelos é decidido pela RLS (`can_manage_company_lists`):
 * aqui só se exige um usuário logado, e uma recusa da RLS volta como falta de permissão.
 */
export async function createEmailTemplate(companyId: string, input: EmailTemplateInput): Promise<ActionResult<{ id: string }>> {
  if (!uuid.safeParse(companyId).success) return INVALID;
  const parsed = templateSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const profile = await getCurrentProfile();
  if (!profile) return DENIED;
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("email_templates")
    .insert({ company_id: companyId, ...parsed.data })
    .select("id")
    .single();
  if (error) return { ok: false, error: error.code === "42501" ? DENIED.error : translateDbError(error) };
  revalidatePath(PATH);
  return { ok: true, data: { id: data.id } };
}

export async function updateEmailTemplate(id: string, input: EmailTemplateInput): Promise<ActionResult> {
  if (!uuid.safeParse(id).success) return INVALID;
  const parsed = templateSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const profile = await getCurrentProfile();
  if (!profile) return DENIED;
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("email_templates")
    .update(parsed.data)
    .eq("id", id)
    .is("deleted_at", null)
    .select("id");
  if (error) return { ok: false, error: translateDbError(error) };
  if (!data || data.length === 0) return { ok: false, error: "Modelo não encontrado ou sem permissão." };
  revalidatePath(PATH);
  return { ok: true, data: undefined };
}

/** Exclusão lógica: o modelo some das listas, mas a linha fica (`deleted_at`). */
export async function deleteEmailTemplate(id: string): Promise<ActionResult> {
  if (!uuid.safeParse(id).success) return INVALID;
  const profile = await getCurrentProfile();
  if (!profile) return DENIED;
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("email_templates")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id)
    .is("deleted_at", null)
    .select("id");
  if (error) return { ok: false, error: translateDbError(error) };
  if (!data || data.length === 0) return { ok: false, error: "Modelo não encontrado ou sem permissão." };
  revalidatePath(PATH);
  return { ok: true, data: undefined };
}

/**
 * Liga ou desliga `companies.settings.email_sent_as_activity`. A RLS de `companies` só deixa o admin geral
 * editar, e a página fica na área de configurações dele. O merge preserva as outras chaves do jsonb; a
 * escrita só vale se a empresa não mudou desde a leitura (`updated_at`), com algumas tentativas.
 */
export async function setEmailSentAsActivity(companyId: string, enabled: boolean): Promise<ActionResult> {
  await requireSuperAdmin();
  if (!uuid.safeParse(companyId).success || typeof enabled !== "boolean") return INVALID;
  const supabase = await createServerClient();
  for (let attempt = 0; attempt < 3; attempt++) {
    const cur = await supabase.from("companies").select("settings, updated_at").eq("id", companyId).maybeSingle();
    if (cur.error) return { ok: false, error: translateDbError(cur.error) };
    if (!cur.data) return { ok: false, error: "Empresa não encontrada." };
    const settings = (cur.data.settings as Record<string, unknown> | null) ?? {};
    const { data, error } = await supabase
      .from("companies")
      .update({ settings: { ...settings, email_sent_as_activity: enabled } })
      .eq("id", companyId)
      .eq("updated_at", cur.data.updated_at)
      .select("id");
    if (error) return { ok: false, error: translateDbError(error) };
    if (data && data.length > 0) {
      revalidatePath(PATH);
      return { ok: true, data: undefined };
    }
  }
  return { ok: false, error: "Não foi possível salvar agora. Tente novamente." };
}
