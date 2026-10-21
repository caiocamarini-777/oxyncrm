"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentProfile } from "@/lib/auth/session";
import { createServerClient } from "@/lib/supabase/server";
import { translateDbError, type ActionResult } from "@/lib/db-errors";
import { RECORD_ENTITIES, type RecordEntity } from "./types";

const INVALID = { ok: false, error: "Dados inválidos." } as const;

function valid(entity: string, id: string): entity is RecordEntity {
  return (RECORD_ENTITIES as readonly string[]).includes(entity) && z.string().uuid().safeParse(id).success;
}

export async function reassignOwner(
  entity: RecordEntity,
  id: string,
  ownerId: string,
): Promise<ActionResult> {
  if (!valid(entity, id) || !z.string().uuid().safeParse(ownerId).success) return INVALID;
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, error: "Você não tem permissão para esta ação." };
  const supabase = await createServerClient();
  const { error } = await supabase.rpc("reassign_record", { p_entity: entity, p_id: id, p_owner: ownerId });
  if (error) return { ok: false, error: translateDbError(error) };
  revalidatePath("/", "layout");
  return { ok: true, data: undefined };
}

async function setDeletedAt(entity: RecordEntity, id: string, value: string | null): Promise<ActionResult> {
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, error: "Você não tem permissão para esta ação." };
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from(entity)
    .update({ deleted_at: value })
    .eq("id", id)
    .select("id");
  if (error) return { ok: false, error: translateDbError(error) };
  if (!data || data.length === 0) return { ok: false, error: "Registro não encontrado ou sem permissão." };
  revalidatePath("/", "layout");
  return { ok: true, data: undefined };
}

export async function moveToTrash(entity: RecordEntity, id: string): Promise<ActionResult> {
  if (!valid(entity, id)) return INVALID;
  return setDeletedAt(entity, id, new Date().toISOString());
}

export async function restoreFromTrash(entity: RecordEntity, id: string): Promise<ActionResult> {
  if (!valid(entity, id)) return INVALID;
  return setDeletedAt(entity, id, null);
}

/** Exclusão definitiva: só admin geral (RLS). */
export async function purgeRecord(entity: RecordEntity, id: string): Promise<ActionResult> {
  if (!valid(entity, id)) return INVALID;
  const profile = await getCurrentProfile();
  if (!profile?.isSuperAdmin) {
    return { ok: false, error: "Só o administrador geral pode excluir definitivamente." };
  }
  const supabase = await createServerClient();
  const { data, error } = await supabase.from(entity).delete().eq("id", id).select("id");
  if (error) return { ok: false, error: translateDbError(error) };
  if (!data || data.length === 0) {
    return { ok: false, error: "Não foi possível excluir: registro não encontrado ou sem permissão." };
  }
  revalidatePath("/", "layout");
  return { ok: true, data: undefined };
}

export async function addRecordLabel(
  entity: RecordEntity,
  recordId: string,
  labelId: string,
): Promise<ActionResult> {
  if (!valid(entity, recordId) || !z.string().uuid().safeParse(labelId).success) return INVALID;
  const supabase = await createServerClient();
  const { error } = await supabase
    .from("record_labels")
    .insert({ entity, record_id: recordId, label_id: labelId });
  if (error && error.code !== "23505") return { ok: false, error: translateDbError(error) };
  revalidatePath("/", "layout");
  return { ok: true, data: undefined };
}

export async function removeRecordLabel(
  entity: RecordEntity,
  recordId: string,
  labelId: string,
): Promise<ActionResult> {
  if (!valid(entity, recordId) || !z.string().uuid().safeParse(labelId).success) return INVALID;
  const supabase = await createServerClient();
  const { error } = await supabase
    .from("record_labels")
    .delete()
    .eq("entity", entity)
    .eq("record_id", recordId)
    .eq("label_id", labelId);
  if (error) return { ok: false, error: translateDbError(error) };
  revalidatePath("/", "layout");
  return { ok: true, data: undefined };
}
