"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentProfile } from "@/lib/auth/session";
import { translateDbError, type ActionResult } from "@/lib/db-errors";
import { firstIssue } from "@/lib/records/action-helpers";
import { createServerClient } from "@/lib/supabase/server";
import { UUID_RE } from "@/lib/uuid";
import { goalSchema, type GoalInput } from "./goals";

const uuid = z.string().regex(UUID_RE);
const NO_PERMISSION = "Você não tem permissão para esta ação.";
const INVALID = { ok: false, error: "Dados inválidos." } as const;
const touched = () => revalidatePath("/", "layout");

async function actor() {
  const profile = await getCurrentProfile();
  return profile && profile.active ? profile : null;
}

// Metas (RLS: só o admin geral escreve) -----------------------------------------------------------------------
export async function createGoal(input: GoalInput): Promise<ActionResult<{ id: string }>> {
  const profile = await actor();
  if (!profile) return { ok: false, error: NO_PERMISSION };
  const parsed = goalSchema.safeParse(input);
  if (!parsed.success) {
    const { field, message } = firstIssue(parsed.error, "targetValue");
    return { ok: false, error: message, fieldErrors: { [field]: message } };
  }
  const g = parsed.data;
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("goals")
    .insert({
      company_id: g.companyId,
      target_kind: g.targetKind,
      target_user_id: g.targetKind === "user" ? g.targetUserId : null,
      target_team_id: g.targetKind === "team" ? g.targetTeamId : null,
      metric: g.metric,
      period: g.period,
      starts_on: g.startsOn,
      target_value: g.targetValue,
      created_by: profile.id,
    })
    .select("id")
    .single();
  if (error) return { ok: false, error: translateDbError(error) };
  touched();
  return { ok: true, data: { id: data.id } };
}

export async function deleteGoal(id: string): Promise<ActionResult> {
  if (!uuid.safeParse(id).success) return INVALID;
  const profile = await actor();
  if (!profile) return { ok: false, error: NO_PERMISSION };
  const supabase = await createServerClient();
  const { data, error } = await supabase.from("goals").delete().eq("id", id).select("id");
  if (error) return { ok: false, error: translateDbError(error) };
  if (!data || data.length === 0) return { ok: false, error: "Registro não encontrado ou sem permissão." };
  touched();
  return { ok: true, data: undefined };
}
