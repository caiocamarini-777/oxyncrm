"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSuperAdmin } from "@/lib/auth/session";
import { translateDbError, type ActionResult } from "@/lib/db-errors";
import { firstIssue } from "@/lib/records/action-helpers";
import { createServerClient } from "@/lib/supabase/server";
import {
  activityChannelSchema,
  activityOutcomeSchema,
  activityTypeSchema,
  leadRuleSchema,
} from "./settings-schema";

const PATH = "/configuracoes/atividades";
const uuid = z.string().uuid();
const TABLES = {
  activity_type: "activity_types",
  activity_channel: "activity_channels",
  activity_outcome: "activity_outcomes",
} as const;

function dbFailure(err: { code?: string; message?: string }): ActionResult<never> {
  if (err.code === "23505") {
    const message = "Já existe um item com esse nome.";
    return { ok: false, error: message, fieldErrors: { name: message } };
  }
  return { ok: false, error: translateDbError(err) };
}

type CreateInput =
  | { kind: "activity_type"; name: string; isMeeting: boolean }
  | { kind: "activity_channel"; name: string }
  | { kind: "activity_outcome"; name: string; classification: string; booksMeeting: boolean };

export async function createActivityConfig(companyId: string, input: CreateInput): Promise<ActionResult<{ id: string }>> {
  await requireSuperAdmin();
  if (!uuid.safeParse(companyId).success || !Object.hasOwn(TABLES, input.kind)) return { ok: false, error: "Dados inválidos." };
  let fields: Record<string, unknown>;
  if (input.kind === "activity_type") {
    const parsed = activityTypeSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    fields = { name: parsed.data.name, is_meeting: parsed.data.isMeeting };
  } else if (input.kind === "activity_channel") {
    const parsed = activityChannelSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    fields = { name: parsed.data.name };
  } else {
    const parsed = activityOutcomeSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    fields = {
      name: parsed.data.name,
      classification: parsed.data.classification,
      books_meeting: parsed.data.booksMeeting,
    };
  }
  const supabase = await createServerClient();
  const table = TABLES[input.kind];
  const { data: last, error: lastError } = await supabase
    .from(table)
    .select("position")
    .eq("company_id", companyId)
    .order("position", { ascending: false })
    .limit(1);
  if (lastError) return dbFailure(lastError);
  const position = (last?.[0]?.position ?? -1) + 1;
  const { data, error } = await supabase
    .from(table)
    .insert({ company_id: companyId, position, ...fields })
    .select("id")
    .single();
  if (error) return dbFailure(error);
  revalidatePath(PATH);
  return { ok: true, data: { id: data.id } };
}

function invalid(err: z.ZodError): ActionResult<never> {
  const { field, message } = firstIssue(err, "name");
  return { ok: false, error: message, fieldErrors: { [field]: message } };
}

/** Marca "É reunião" de um tipo. */
export async function setTypeMeeting(id: string, isMeeting: boolean): Promise<ActionResult> {
  await requireSuperAdmin();
  if (!uuid.safeParse(id).success) return { ok: false, error: "Dados inválidos." };
  const supabase = await createServerClient();
  const { error } = await supabase.from("activity_types").update({ is_meeting: isMeeting }).eq("id", id);
  if (error) return dbFailure(error);
  revalidatePath(PATH);
  return { ok: true, data: undefined };
}

export async function updateOutcome(
  id: string,
  patch: { classification?: string; booksMeeting?: boolean },
): Promise<ActionResult> {
  await requireSuperAdmin();
  if (!uuid.safeParse(id).success) return { ok: false, error: "Dados inválidos." };
  const parsed = activityOutcomeSchema.pick({ classification: true, booksMeeting: true }).partial().safeParse(patch);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const update: Record<string, unknown> = {};
  if (parsed.data.classification !== undefined) update.classification = parsed.data.classification;
  if (parsed.data.booksMeeting !== undefined) update.books_meeting = parsed.data.booksMeeting;
  if (Object.keys(update).length === 0) return { ok: true, data: undefined };
  const supabase = await createServerClient();
  const { error } = await supabase.from("activity_outcomes").update(update).eq("id", id);
  if (error) return dbFailure(error);
  revalidatePath(PATH);
  return { ok: true, data: undefined };
}

/** Grava `lead_next_activity_rule` em companies.settings (RPC atômica, sem apagar as outras chaves). */
export async function setLeadNextActivityRule(companyId: string, rule: string): Promise<ActionResult> {
  await requireSuperAdmin();
  if (!uuid.safeParse(companyId).success) return { ok: false, error: "Dados inválidos." };
  const parsed = leadRuleSchema.safeParse(rule);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const supabase = await createServerClient();
  const { error } = await supabase.rpc("set_lead_next_activity_rule", { p_company: companyId, p_rule: parsed.data });
  if (error) return { ok: false, error: translateDbError(error) };
  revalidatePath(PATH);
  return { ok: true, data: undefined };
}
