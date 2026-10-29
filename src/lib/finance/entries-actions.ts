"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { translateDbError, type ActionResult } from "@/lib/db-errors";
import { firstIssue } from "@/lib/records/action-helpers";
import { createServerClient } from "@/lib/supabase/server";
import { entryInputSchema, settleSchema, type EntryInput, type SettleInput } from "./schema";

const uuid = z.string().uuid();
const INVALID = "Dados inválidos.";

function done(): void {
  revalidatePath("/[empresa]/financeiro", "layout");
}

function dbFailure(err: { code?: string; message?: string }): ActionResult<never> {
  const msg = err.message ?? "";
  if (msg.includes("OXYN_AMOUNT_SINGLE_ONLY"))
    return { ok: false, error: "O valor só pode ser alterado ao baixar um lançamento." };
  if (msg.includes("OXYN_ENTRY_NOT_SETTLED")) return { ok: false, error: "Este lançamento não está baixado." };
  if (msg.includes("OXYN_INVALID_ARGS")) return { ok: false, error: INVALID };
  return { ok: false, error: translateDbError(err) };
}

function parseEntry(input: EntryInput) {
  const parsed = entryInputSchema.safeParse(input);
  if (parsed.success) return { ok: true as const, data: parsed.data };
  const { field, message } = firstIssue(parsed.error, "description");
  return { ok: false as const, result: { ok: false, error: message, fieldErrors: { [field]: message } } satisfies ActionResult<never> };
}

/** Lançamento avulso: a competência é o mês do vencimento. */
export async function createManualEntry(companyId: string, input: EntryInput): Promise<ActionResult<{ id: string }>> {
  if (!uuid.safeParse(companyId).success) return { ok: false, error: INVALID };
  const parsed = parseEntry(input);
  if (!parsed.ok) return parsed.result;
  const v = parsed.data;
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("fin_entries")
    .insert({
      company_id: companyId,
      direction: v.direction,
      source_kind: "manual",
      due_date: v.dueDate,
      competence: `${v.dueDate.slice(0, 7)}-01`,
      gross: v.gross,
      description: v.description,
      account_id: v.accountId,
      organization_id: v.organizationId,
      income_category_id: v.direction === "in" ? v.incomeCategoryId : null,
      service_category_id: v.direction === "in" ? v.serviceCategoryId : null,
      expense_category_id: v.direction === "out" ? v.expenseCategoryId : null,
      nature: v.direction === "out" ? v.nature : null,
    })
    .select("id")
    .single();
  if (error) return dbFailure(error);
  done();
  return { ok: true, data: { id: data.id } };
}

/** Edita um lançamento em aberto. Editar valor, vencimento ou descrição de um gerado o trava (trigger). */
export async function updateEntry(id: string, input: EntryInput): Promise<ActionResult> {
  if (!uuid.safeParse(id).success) return { ok: false, error: INVALID };
  const parsed = parseEntry(input);
  if (!parsed.ok) return parsed.result;
  const v = parsed.data;
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("fin_entries")
    .update({
      due_date: v.dueDate,
      gross: v.gross,
      description: v.description,
      account_id: v.accountId,
      organization_id: v.organizationId,
      income_category_id: v.direction === "in" ? v.incomeCategoryId : null,
      service_category_id: v.direction === "in" ? v.serviceCategoryId : null,
      expense_category_id: v.direction === "out" ? v.expenseCategoryId : null,
      nature: v.direction === "out" ? v.nature : null,
    })
    .eq("id", id)
    .eq("status", "open")
    .eq("direction", v.direction)
    .select("id");
  if (error) return dbFailure(error);
  if (!data || data.length === 0) return { ok: false, error: "Só é possível editar lançamentos em aberto." };
  done();
  return { ok: true, data: undefined };
}

export async function cancelEntry(id: string): Promise<ActionResult> {
  if (!uuid.safeParse(id).success) return { ok: false, error: INVALID };
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("fin_entries")
    .update({ status: "cancelled" })
    .eq("id", id)
    .eq("status", "open")
    .select("id");
  if (error) return dbFailure(error);
  if (!data || data.length === 0) return { ok: false, error: "Só é possível cancelar lançamentos em aberto." };
  done();
  return { ok: true, data: undefined };
}

export async function settleEntries(input: SettleInput): Promise<ActionResult<{ count: number }>> {
  const parsed = settleSchema.safeParse(input);
  if (!parsed.success) {
    const { field, message } = firstIssue(parsed.error, "ids");
    return { ok: false, error: message, fieldErrors: { [field]: message } };
  }
  const v = parsed.data;
  const supabase = await createServerClient();
  const { data, error } = await supabase.rpc("fin_settle_entries", {
    p_ids: v.ids,
    p_settled_on: v.settledOn,
    p_account: v.accountId,
    p_amount: v.amount,
  });
  if (error) return dbFailure(error);
  done();
  return { ok: true, data: { count: Number(data ?? 0) } };
}

export async function reopenEntry(id: string): Promise<ActionResult> {
  if (!uuid.safeParse(id).success) return { ok: false, error: INVALID };
  const supabase = await createServerClient();
  const { error } = await supabase.rpc("fin_reopen_entry", { p_id: id });
  if (error) return dbFailure(error);
  done();
  return { ok: true, data: undefined };
}
