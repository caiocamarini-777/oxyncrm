"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { translateDbError, type ActionResult } from "@/lib/db-errors";
import { firstIssue } from "@/lib/records/action-helpers";
import { createServerClient } from "@/lib/supabase/server";
import { recurringItemSchema, type RecurringItemInput } from "./schema";

const uuid = z.string().uuid();
const INVALID = "Dados inválidos.";

function done(): void {
  revalidatePath("/[empresa]/financeiro", "layout");
}

function dbFailure(err: { code?: string; message?: string }): ActionResult<never> {
  if (err.code === "23514" && (err.message ?? "").includes("end_month_required"))
    return { ok: false, error: "Informe o fim.", fieldErrors: { endMonth: "Informe o fim." } };
  return { ok: false, error: translateDbError(err) };
}

function parse(input: RecurringItemInput) {
  const parsed = recurringItemSchema.safeParse(input);
  if (parsed.success) return { ok: true as const, data: parsed.data };
  const { field, message } = firstIssue(parsed.error, "description");
  return { ok: false as const, result: { ok: false, error: message, fieldErrors: { [field]: message } } satisfies ActionResult<never> };
}

function columns(v: ReturnType<typeof recurringItemSchema.parse>) {
  return {
    direction: v.direction,
    description: v.description,
    payee: v.payee,
    organization_id: v.organizationId,
    income_category_id: v.incomeCategoryId,
    service_category_id: v.serviceCategoryId,
    expense_category_id: v.expenseCategoryId,
    nature: v.nature,
    amount: v.amount,
    frequency: v.frequency,
    due_day: v.dueDay,
    start_month: v.startMonth,
    end_month: v.endMonth,
    installments: v.installments,
    adjust_rate: v.adjustRate,
    adjust_month: v.adjustRate > 0 ? v.adjustMonth : null,
    account_id: v.accountId,
  };
}

export async function createRecurringItem(companyId: string, input: RecurringItemInput): Promise<ActionResult<{ id: string }>> {
  if (!uuid.safeParse(companyId).success) return { ok: false, error: INVALID };
  const parsed = parse(input);
  if (!parsed.ok) return parsed.result;
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("fin_recurring_expenses")
    .insert({ company_id: companyId, ...columns(parsed.data) })
    .select("id")
    .single();
  if (error) return dbFailure(error);
  done();
  return { ok: true, data: { id: data.id } };
}

export async function updateRecurringItem(id: string, input: RecurringItemInput): Promise<ActionResult> {
  if (!uuid.safeParse(id).success) return { ok: false, error: INVALID };
  const parsed = parse(input);
  if (!parsed.ok) return parsed.result;
  const supabase = await createServerClient();
  const { data, error } = await supabase.from("fin_recurring_expenses").update(columns(parsed.data)).eq("id", id).select("id");
  if (error) return dbFailure(error);
  if (!data || data.length === 0) return { ok: false, error: "Item não encontrado." };
  done();
  return { ok: true, data: undefined };
}

export async function setRecurringItemActive(id: string, active: boolean): Promise<ActionResult> {
  if (!uuid.safeParse(id).success || typeof active !== "boolean") return { ok: false, error: INVALID };
  const supabase = await createServerClient();
  const { data, error } = await supabase.from("fin_recurring_expenses").update({ active }).eq("id", id).select("id");
  if (error) return dbFailure(error);
  if (!data || data.length === 0) return { ok: false, error: "Item não encontrado." };
  done();
  return { ok: true, data: undefined };
}
