"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSuperAdmin } from "@/lib/auth/session";
import { firstIssue } from "@/lib/records/action-helpers";
import { createServerClient } from "@/lib/supabase/server";
import { translateDbError, type ActionResult } from "@/lib/db-errors";
import {
  CUSTOM_FIELD_ENTITIES_PHASE2,
  customFieldDefSchema,
  customFieldUpdateSchema,
  type CustomFieldDefInput,
  type CustomFieldEntity,
} from "./schema";

const PATH = "/configuracoes/campos";

export async function createCustomField(
  companyId: string,
  entity: CustomFieldEntity,
  input: CustomFieldDefInput,
): Promise<ActionResult<{ id: string }>> {
  await requireSuperAdmin();
  if (!z.string().uuid().safeParse(companyId).success || !CUSTOM_FIELD_ENTITIES_PHASE2.includes(entity)) {
    return { ok: false, error: "Dados inválidos." };
  }
  const parsed = customFieldDefSchema.safeParse(input);
  if (!parsed.success) {
    const { field, message } = firstIssue(parsed.error, "label");
    return { ok: false, error: message, fieldErrors: { [field]: message } };
  }
  const supabase = await createServerClient();
  const { data: last } = await supabase
    .from("custom_field_defs")
    .select("position")
    .eq("company_id", companyId)
    .eq("entity", entity)
    .order("position", { ascending: false })
    .limit(1);
  const position = (last?.[0]?.position ?? -1) + 1;
  const { data, error } = await supabase
    .from("custom_field_defs")
    .insert({ company_id: companyId, entity, ...parsed.data, position })
    .select("id")
    .single();
  if (error) {
    if (error.code === "23505") {
      const message = "Já existe um campo com esse nome.";
      return { ok: false, error: message, fieldErrors: { label: message } };
    }
    return { ok: false, error: translateDbError(error) };
  }
  revalidatePath(PATH);
  return { ok: true, data: { id: data.id } };
}

/** Tipo e chave são imutáveis: só rótulo, opções e posição mudam. */
export async function updateCustomField(
  id: string,
  input: { label: string; options?: string[]; position?: number },
): Promise<ActionResult> {
  await requireSuperAdmin();
  const parsed = customFieldUpdateSchema.safeParse(input);
  if (!parsed.success) {
    const { field, message } = firstIssue(parsed.error, "label");
    return { ok: false, error: message, fieldErrors: { [field]: message } };
  }
  const supabase = await createServerClient();
  const { data: current, error: readError } = await supabase
    .from("custom_field_defs")
    .select("type, options")
    .eq("id", id)
    .single();
  if (readError) return { ok: false, error: translateDbError(readError) };
  const patch: { label: string; options?: string[]; position?: number } = { label: parsed.data.label };
  if (current.type === "select" || current.type === "multiselect") {
    if (parsed.data.options.length < 1) {
      const message = "Informe pelo menos uma opção.";
      return { ok: false, error: message, fieldErrors: { options: message } };
    }
    patch.options = parsed.data.options;
  }
  if (parsed.data.position !== undefined) patch.position = parsed.data.position;
  const { error } = await supabase.from("custom_field_defs").update(patch).eq("id", id);
  if (error) return { ok: false, error: translateDbError(error) };
  revalidatePath(PATH);
  return { ok: true, data: undefined };
}

export async function setCustomFieldArchived(id: string, archived: boolean): Promise<ActionResult> {
  await requireSuperAdmin();
  const supabase = await createServerClient();
  const { error } = await supabase
    .from("custom_field_defs")
    .update({ archived_at: archived ? new Date().toISOString() : null })
    .eq("id", id);
  if (error) return { ok: false, error: translateDbError(error) };
  revalidatePath(PATH);
  return { ok: true, data: undefined };
}

/** Renumera os campos da entidade (posições podem empatar) e troca com o vizinho. */
export async function moveCustomField(id: string, direction: "up" | "down"): Promise<ActionResult> {
  await requireSuperAdmin();
  const supabase = await createServerClient();
  const { data: item, error: itemError } = await supabase
    .from("custom_field_defs")
    .select("company_id, entity")
    .eq("id", id)
    .single();
  if (itemError) return { ok: false, error: translateDbError(itemError) };
  const { data: rows, error: listError } = await supabase
    .from("custom_field_defs")
    .select("id, position")
    .eq("company_id", item.company_id)
    .eq("entity", item.entity)
    .order("position")
    .order("label");
  if (listError) return { ok: false, error: translateDbError(listError) };
  const ordered = (rows ?? []).map((r) => r.id);
  const from = ordered.indexOf(id);
  const to = direction === "up" ? from - 1 : from + 1;
  if (from < 0 || to < 0 || to >= ordered.length) return { ok: true, data: undefined };
  [ordered[from], ordered[to]] = [ordered[to], ordered[from]];
  const current = new Map((rows ?? []).map((r) => [r.id, r.position]));
  for (const [index, rowId] of ordered.entries()) {
    if (current.get(rowId) === index) continue;
    const { error } = await supabase.from("custom_field_defs").update({ position: index }).eq("id", rowId);
    if (error) return { ok: false, error: translateDbError(error) };
  }
  revalidatePath(PATH);
  return { ok: true, data: undefined };
}
