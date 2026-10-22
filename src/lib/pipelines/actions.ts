"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSuperAdmin } from "@/lib/auth/session";
import { firstIssue } from "@/lib/records/action-helpers";
import { listActiveCustomFieldDefs } from "@/lib/records/lookups";
import { createServerClient } from "@/lib/supabase/server";
import { translateDbError, type ActionResult } from "@/lib/db-errors";
import { pipelineSchema, stageSchemaFor, type PipelineInput, type StageInput } from "./schema";

const PATH = "/configuracoes/funis";
const uuid = z.string().uuid();

function duplicate(what: string): ActionResult<never> {
  const message = `Já existe ${what} com esse nome.`;
  return { ok: false, error: message, fieldErrors: { name: message } };
}

export async function createPipeline(companyId: string, input: PipelineInput): Promise<ActionResult<{ id: string }>> {
  await requireSuperAdmin();
  if (!uuid.safeParse(companyId).success) return { ok: false, error: "Dados inválidos." };
  const parsed = pipelineSchema.safeParse(input);
  if (!parsed.success) {
    const { field, message } = firstIssue(parsed.error, "name");
    return { ok: false, error: message, fieldErrors: { [field]: message } };
  }
  const supabase = await createServerClient();
  const { data: last } = await supabase
    .from("pipelines")
    .select("position")
    .eq("company_id", companyId)
    .order("position", { ascending: false })
    .limit(1);
  const { data, error } = await supabase
    .from("pipelines")
    .insert({
      company_id: companyId,
      name: parsed.data.name,
      next_activity_rule: parsed.data.nextActivityRule,
      card_value_field: parsed.data.cardValueField,
      position: (last?.[0]?.position ?? -1) + 1,
    })
    .select("id")
    .single();
  if (error) return error.code === "23505" ? duplicate("um funil") : { ok: false, error: translateDbError(error) };
  revalidatePath(PATH);
  return { ok: true, data: { id: data.id } };
}

export async function updatePipeline(id: string, input: PipelineInput): Promise<ActionResult> {
  await requireSuperAdmin();
  if (!uuid.safeParse(id).success) return { ok: false, error: "Dados inválidos." };
  const parsed = pipelineSchema.safeParse(input);
  if (!parsed.success) {
    const { field, message } = firstIssue(parsed.error, "name");
    return { ok: false, error: message, fieldErrors: { [field]: message } };
  }
  const supabase = await createServerClient();
  const { error } = await supabase
    .from("pipelines")
    .update({
      name: parsed.data.name,
      next_activity_rule: parsed.data.nextActivityRule,
      card_value_field: parsed.data.cardValueField,
    })
    .eq("id", id);
  if (error) return error.code === "23505" ? duplicate("um funil") : { ok: false, error: translateDbError(error) };
  revalidatePath(PATH);
  return { ok: true, data: undefined };
}

/** Funil arquivado sai dos seletores, mas os negócios dele continuam existindo. */
export async function setPipelineArchived(id: string, archived: boolean): Promise<ActionResult> {
  await requireSuperAdmin();
  if (!uuid.safeParse(id).success) return { ok: false, error: "Dados inválidos." };
  const supabase = await createServerClient();
  const { error } = await supabase
    .from("pipelines")
    .update({ archived_at: archived ? new Date().toISOString() : null })
    .eq("id", id);
  if (error) return { ok: false, error: translateDbError(error) };
  revalidatePath(PATH);
  return { ok: true, data: undefined };
}

async function parseStage(companyId: string, input: StageInput) {
  const defs = await listActiveCustomFieldDefs(companyId, "deals");
  return stageSchemaFor(defs.map((d) => d.key)).safeParse(input);
}

function stageIssue(error: z.ZodError): ActionResult<never> {
  const { field, message } = firstIssue(error, "name");
  return { ok: false, error: message, fieldErrors: { [field]: message } };
}

export async function createStage(pipelineId: string, input: StageInput): Promise<ActionResult<{ id: string }>> {
  await requireSuperAdmin();
  if (!uuid.safeParse(pipelineId).success) return { ok: false, error: "Dados inválidos." };
  const supabase = await createServerClient();
  const { data: pipeline, error: pipelineError } = await supabase
    .from("pipelines")
    .select("company_id")
    .eq("id", pipelineId)
    .single();
  if (pipelineError) return { ok: false, error: translateDbError(pipelineError) };
  const parsed = await parseStage(pipeline.company_id, input);
  if (!parsed.success) return stageIssue(parsed.error);
  const { data: last } = await supabase
    .from("stages")
    .select("position")
    .eq("pipeline_id", pipelineId)
    .order("position", { ascending: false })
    .limit(1);
  const { data, error } = await supabase
    .from("stages")
    .insert({
      pipeline_id: pipelineId,
      company_id: pipeline.company_id,
      name: parsed.data.name,
      probability: parsed.data.probability,
      rotting_days: parsed.data.rottingDays,
      required_fields: parsed.data.requiredFields,
      position: (last?.[0]?.position ?? -1) + 1,
    })
    .select("id")
    .single();
  if (error) return error.code === "23505" ? duplicate("uma etapa") : { ok: false, error: translateDbError(error) };
  revalidatePath(PATH);
  return { ok: true, data: { id: data.id } };
}

export async function updateStage(id: string, input: StageInput): Promise<ActionResult> {
  await requireSuperAdmin();
  if (!uuid.safeParse(id).success) return { ok: false, error: "Dados inválidos." };
  const supabase = await createServerClient();
  const { data: stage, error: stageError } = await supabase.from("stages").select("company_id").eq("id", id).single();
  if (stageError) return { ok: false, error: translateDbError(stageError) };
  const parsed = await parseStage(stage.company_id, input);
  if (!parsed.success) return stageIssue(parsed.error);
  const { error } = await supabase
    .from("stages")
    .update({
      name: parsed.data.name,
      probability: parsed.data.probability,
      rotting_days: parsed.data.rottingDays,
      required_fields: parsed.data.requiredFields,
    })
    .eq("id", id);
  if (error) return error.code === "23505" ? duplicate("uma etapa") : { ok: false, error: translateDbError(error) };
  revalidatePath(PATH);
  return { ok: true, data: undefined };
}

/** `stageIds` é a nova ordem completa das etapas do funil. */
export async function reorderStages(pipelineId: string, stageIds: string[]): Promise<ActionResult> {
  await requireSuperAdmin();
  if (!uuid.safeParse(pipelineId).success || !stageIds.every((s) => uuid.safeParse(s).success)) {
    return { ok: false, error: "Dados inválidos." };
  }
  const supabase = await createServerClient();
  const { error } = await supabase.rpc("reorder_stages", { p_pipeline: pipelineId, p_stage_ids: stageIds });
  if (error) {
    if (error.message.includes("OXYN_STAGES_MISMATCH")) {
      return { ok: false, error: "A lista de etapas mudou. Recarregue a página." };
    }
    return { ok: false, error: translateDbError(error) };
  }
  revalidatePath(PATH);
  return { ok: true, data: undefined };
}

export async function deleteStage(id: string): Promise<ActionResult> {
  await requireSuperAdmin();
  if (!uuid.safeParse(id).success) return { ok: false, error: "Dados inválidos." };
  const supabase = await createServerClient();
  const { error } = await supabase.from("stages").delete().eq("id", id);
  if (error) {
    if (error.code === "23503") {
      // Só negócios na lixeira prendem a etapa: a mensagem diz onde eles estão.
      const active = await supabase
        .from("deals")
        .select("id", { count: "exact", head: true })
        .eq("stage_id", id)
        .is("deleted_at", null);
      if (!active.error && (active.count ?? 0) === 0) {
        return {
          ok: false,
          error: "Há negócios na lixeira nesta etapa. Esvazie a lixeira ou restaure-os antes de excluir.",
        };
      }
      return { ok: false, error: "Mova os negócios desta etapa antes de excluí-la." };
    }
    return { ok: false, error: translateDbError(error) };
  }
  revalidatePath(PATH);
  return { ok: true, data: undefined };
}
