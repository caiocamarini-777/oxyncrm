"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentProfile } from "@/lib/auth/session";
import { translateDbError, type ActionResult } from "@/lib/db-errors";
import { RECORD_ENTITIES, type RecordEntity } from "@/lib/records/types";
import { createServerClient } from "@/lib/supabase/server";

const bodySchema = z.string().trim().min(1, "Escreva a anotação.").max(10000, "A anotação passa de 10.000 caracteres.");
const uuid = z.string().uuid();
const DENIED = { ok: false, error: "Você não tem permissão para esta ação." } as const;

export async function addNote(
  entity: RecordEntity,
  recordId: string,
  body: string,
): Promise<ActionResult<{ id: string }>> {
  if (!(RECORD_ENTITIES as readonly string[]).includes(entity) || !uuid.safeParse(recordId).success)
    return { ok: false, error: "Dados inválidos." };
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const profile = await getCurrentProfile();
  if (!profile) return DENIED;
  const supabase = await createServerClient();
  const rec = await supabase.from(entity).select("company_id").eq("id", recordId).is("deleted_at", null).maybeSingle();
  if (rec.error) return { ok: false, error: "Não foi possível salvar agora." };
  if (!rec.data) return { ok: false, error: "Registro não encontrado ou sem permissão." };
  const { data, error } = await supabase
    .from("notes")
    .insert({ company_id: rec.data.company_id, entity, record_id: recordId, body: parsed.data })
    .select("id")
    .single();
  if (error) return { ok: false, error: translateDbError(error) };
  revalidatePath("/", "layout");
  return { ok: true, data: { id: data.id } };
}

export async function updateNote(id: string, body: string): Promise<ActionResult> {
  if (!uuid.safeParse(id).success) return { ok: false, error: "Dados inválidos." };
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const profile = await getCurrentProfile();
  if (!profile) return DENIED;
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("notes")
    .update({ body: parsed.data })
    .eq("id", id)
    .is("deleted_at", null)
    .select("id");
  if (error) return { ok: false, error: translateDbError(error) };
  if (!data || data.length === 0) return { ok: false, error: "Anotação não encontrada ou sem permissão." };
  revalidatePath("/", "layout");
  return { ok: true, data: undefined };
}

/** Exclusão lógica: autor ou admin geral (RLS). */
export async function deleteNote(id: string): Promise<ActionResult> {
  if (!uuid.safeParse(id).success) return { ok: false, error: "Dados inválidos." };
  const profile = await getCurrentProfile();
  if (!profile) return DENIED;
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("notes")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id)
    .is("deleted_at", null)
    .select("id");
  if (error) return { ok: false, error: translateDbError(error) };
  if (!data || data.length === 0) return { ok: false, error: "Anotação não encontrada ou sem permissão." };
  revalidatePath("/", "layout");
  return { ok: true, data: undefined };
}
