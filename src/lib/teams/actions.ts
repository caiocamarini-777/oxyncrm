"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSuperAdmin } from "@/lib/auth/session";
import { createServerClient } from "@/lib/supabase/server";
import { translateDbError, type ActionResult } from "@/lib/db-errors";

const nameSchema = z
  .string()
  .trim()
  .min(2, "Informe o nome (mínimo 2 caracteres).")
  .max(60, "Use no máximo 60 caracteres.");

const DUPLICATE = "Já existe um registro com esse valor.";

function nameFailure(message: string): ActionResult<never> {
  return { ok: false, error: message, fieldErrors: { name: message } };
}

function dbFailure(err: { code?: string; message?: string }): ActionResult<never> {
  if (err.code === "23505") return nameFailure(DUPLICATE);
  return { ok: false, error: translateDbError(err) };
}

export async function createTeam(input: { name: string }): Promise<ActionResult<{ id: string }>> {
  await requireSuperAdmin();
  const parsed = nameSchema.safeParse(input.name);
  if (!parsed.success) return nameFailure(parsed.error.issues[0].message);
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("teams")
    .insert({ name: parsed.data })
    .select("id")
    .single();
  if (error) return dbFailure(error);
  revalidatePath("/configuracoes/equipes");
  return { ok: true, data: { id: data.id } };
}

export async function renameTeam(id: string, name: string): Promise<ActionResult> {
  await requireSuperAdmin();
  const parsed = nameSchema.safeParse(name);
  if (!parsed.success) return nameFailure(parsed.error.issues[0].message);
  const supabase = await createServerClient();
  const { error } = await supabase.from("teams").update({ name: parsed.data }).eq("id", id);
  if (error) return dbFailure(error);
  revalidatePath("/configuracoes/equipes");
  return { ok: true, data: undefined };
}

export async function deleteTeam(id: string): Promise<ActionResult> {
  await requireSuperAdmin();
  const supabase = await createServerClient();
  const { error } = await supabase.from("teams").delete().eq("id", id);
  if (error) return { ok: false, error: translateDbError(error) };
  revalidatePath("/configuracoes/equipes");
  return { ok: true, data: undefined };
}

/** Substitui a lista de membros: apaga ausentes, insere novos. */
export async function setTeamMembers(teamId: string, userIds: string[]): Promise<ActionResult> {
  await requireSuperAdmin();
  const wanted = new Set(z.array(z.string().uuid()).parse(userIds));
  const supabase = await createServerClient();
  const { data: current, error: readError } = await supabase
    .from("team_members")
    .select("user_id")
    .eq("team_id", teamId);
  if (readError) return { ok: false, error: translateDbError(readError) };
  const existing = new Set((current ?? []).map((r) => r.user_id));
  const toRemove = [...existing].filter((id) => !wanted.has(id));
  const toAdd = [...wanted].filter((id) => !existing.has(id));

  if (toRemove.length > 0) {
    const { error } = await supabase
      .from("team_members")
      .delete()
      .eq("team_id", teamId)
      .in("user_id", toRemove);
    if (error) return { ok: false, error: translateDbError(error) };
  }
  if (toAdd.length > 0) {
    const { error } = await supabase
      .from("team_members")
      .insert(toAdd.map((user_id) => ({ team_id: teamId, user_id })));
    if (error) {
      revalidatePath("/configuracoes/equipes");
      return { ok: false, error: translateDbError(error) };
    }
  }
  revalidatePath("/configuracoes/equipes");
  return { ok: true, data: undefined };
}
