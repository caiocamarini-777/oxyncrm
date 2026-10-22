"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentProfile } from "@/lib/auth/session";
import { translateDbError, type ActionResult } from "@/lib/db-errors";
import { firstIssue } from "@/lib/records/action-helpers";
import { createServerClient } from "@/lib/supabase/server";
import { completeFailure, type CompleteCode } from "./complete-map";
import { buildActivityPatch } from "./patch";
import {
  activitySchema,
  activityEditSchema,
  completeSchema,
  type ActivityData,
  type ActivityInput,
  type CompleteInput,
} from "./schema";

const uuid = z.string().uuid();
const NO_PERMISSION = "Você não tem permissão para esta ação.";
const INVALID = { ok: false, error: "Dados inválidos." } as const;
const touched = () => revalidatePath("/", "layout");

function fields(d: ActivityData) {
  return {
    type_id: d.typeId,
    channel_id: d.channelId,
    subject: d.subject,
    description: d.description,
    due_at: d.dueAt,
    duration_minutes: d.durationMinutes,
    reminder_minutes: d.reminderMinutes,
    lead_id: d.leadId,
    deal_id: d.dealId,
    person_id: d.personId,
    organization_id: d.organizationId,
  };
}

/** Cria a atividade; sem `ownerId`, o responsável é o usuário atual. */
export async function createActivity(companyId: string, input: ActivityInput): Promise<ActionResult<{ id: string }>> {
  if (!uuid.safeParse(companyId).success) return INVALID;
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, error: NO_PERMISSION };
  const parsed = activitySchema.safeParse(input);
  if (!parsed.success) {
    const { field, message } = firstIssue(parsed.error, "subject");
    return { ok: false, error: message, fieldErrors: { [field]: message } };
  }
  const d = parsed.data;
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("activities")
    .insert({ company_id: companyId, owner_id: d.ownerId ?? profile.id, ...fields(d) })
    .select("id")
    .single();
  if (error) return { ok: false, error: translateDbError(error) };
  touched();
  return { ok: true, data: { id: data.id } };
}

/** Edita os dados; trocar o responsável passa por `reassign_record`. Conclusão tem ação própria. */
export async function updateActivity(id: string, input: ActivityInput): Promise<ActionResult> {
  if (!uuid.safeParse(id).success) return INVALID;
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, error: NO_PERMISSION };
  const parsed = activityEditSchema.safeParse(input);
  if (!parsed.success) {
    const { field, message } = firstIssue(parsed.error, "subject");
    return { ok: false, error: message, fieldErrors: { [field]: message } };
  }
  const d = parsed.data;
  const supabase = await createServerClient();
  const { data: current, error: readError } = await supabase
    .from("activities")
    .select("owner_id, done, lead_id, deal_id, person_id, organization_id")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (readError) {
    console.error("[atividades] leitura antes de salvar:", readError.code, readError.message);
    return { ok: false, error: "Não foi possível salvar agora. Tente novamente." };
  }
  if (!current) return { ok: false, error: "Registro não encontrado ou sem permissão." };
  const built = buildActivityPatch(d, input, current);
  if (!built.ok) return { ok: false, error: built.error, fieldErrors: { links: built.error } };
  // Troca de responsável primeiro: se falhar, nada foi salvo pela metade.
  if (d.ownerId && d.ownerId !== current.owner_id) {
    const res = await supabase.rpc("reassign_record", { p_entity: "activities", p_id: id, p_owner: d.ownerId });
    if (res.error) return { ok: false, error: translateDbError(res.error) };
  }
  const { data, error } = await supabase
    .from("activities")
    .update(built.patch)
    .eq("id", id)
    .is("deleted_at", null)
    .select("id");
  if (error) return { ok: false, error: translateDbError(error) };
  if (!data || data.length === 0) return { ok: false, error: "Registro não encontrado ou sem permissão." };
  touched();
  return { ok: true, data: undefined };
}

export type { CompleteCode };
export type CompleteOk = { meetingId: string | null; nextId: string | null; rule: "off" | "suggest" | "require" | null };
export type CompleteResult =
  | { ok: true; data: CompleteOk }
  | { ok: false; error: string; fieldErrors?: Record<string, string>; code?: CompleteCode; rule?: "require" };

/**
 * Conclui via RPC `complete_activity`. `next.ownerId` só segue quando o usuário escolheu outro
 * responsável (passar o do registro de origem exige a permissão de reatribuir). Sucesso devolve
 * `rule` (off | suggest | require) para a tela decidir se sugere a próxima atividade.
 */
export async function completeActivity(id: string, input: CompleteInput): Promise<CompleteResult> {
  if (!uuid.safeParse(id).success) return INVALID;
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, error: NO_PERMISSION };
  const parsed = completeSchema.safeParse(input);
  if (!parsed.success) {
    const { field, message } = firstIssue(parsed.error, "outcomeId");
    return {
      ok: false,
      error: message,
      fieldErrors: { [field]: message },
      code: field === "outcomeId" || field === "meetingOutcome" ? "outcome_required" : undefined,
    };
  }
  const d = parsed.data;
  const supabase = await createServerClient();
  let nextOwner = d.next?.ownerId;
  if (nextOwner) {
    // dono igual ao da atividade de origem: omitir (informar exige a permissão de reatribuir)
    const { data: src } = await supabase.from("activities").select("owner_id").eq("id", id).maybeSingle();
    if (src?.owner_id === nextOwner) nextOwner = undefined;
  }
  const next = d.next
    ? {
        type_id: d.next.typeId,
        channel_id: d.next.channelId,
        subject: d.next.subject,
        due_at: d.next.dueAt,
        duration_minutes: d.next.durationMinutes,
        reminder_minutes: d.next.reminderMinutes,
        ...(nextOwner ? { owner_id: nextOwner } : {}),
      }
    : null;
  const meeting = d.meeting
    ? { subject: d.meeting.subject, due_at: d.meeting.dueAt, ...(d.meeting.typeId ? { type_id: d.meeting.typeId } : {}) }
    : null;

  const { data, error } = await supabase.rpc("complete_activity", {
    p_id: id,
    p_outcome_id: d.isMeeting ? null : (d.outcomeId ?? null),
    p_meeting_outcome: d.isMeeting ? (d.meetingOutcome ?? null) : null,
    p_note: d.note,
    p_meeting: meeting,
    p_next: next,
  });
  if (error) {
    return completeFailure(error);
  }
  const r = (data ?? {}) as { meeting_id?: string | null; next_id?: string | null; rule?: CompleteOk["rule"] };
  touched();
  return { ok: true, data: { meetingId: r.meeting_id ?? null, nextId: r.next_id ?? null, rule: r.rule ?? null } };
}

export async function reopenActivity(id: string): Promise<ActionResult> {
  if (!uuid.safeParse(id).success) return INVALID;
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, error: NO_PERMISSION };
  const supabase = await createServerClient();
  const { error } = await supabase.rpc("reopen_activity", { p_id: id });
  if (error) return { ok: false, error: translateDbError(error) };
  touched();
  return { ok: true, data: undefined };
}

async function setDeletedAt(id: string, value: string | null): Promise<ActionResult> {
  if (!uuid.safeParse(id).success) return INVALID;
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, error: NO_PERMISSION };
  const supabase = await createServerClient();
  const { data, error } = await supabase.from("activities").update({ deleted_at: value }).eq("id", id).select("id");
  if (error) return { ok: false, error: translateDbError(error) };
  if (!data || data.length === 0) return { ok: false, error: "Registro não encontrado ou sem permissão." };
  touched();
  return { ok: true, data: undefined };
}

export const trashActivity = async (id: string) => setDeletedAt(id, new Date().toISOString());
export const restoreActivity = async (id: string) => setDeletedAt(id, null);
