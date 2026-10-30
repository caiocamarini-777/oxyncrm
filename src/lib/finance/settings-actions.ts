"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { translateDbError, type ActionResult } from "@/lib/db-errors";
import { firstIssue } from "@/lib/records/action-helpers";
import { createServerClient } from "@/lib/supabase/server";
import {
  accountSchema,
  balanceSnapshotSchema,
  expenseCategorySchema,
  incomeCategorySchema,
  type AccountInput,
  type ExpenseCategoryInput,
  type IncomeCategoryInput,
} from "./schema";

const uuid = z.string().uuid();
const INVALID = "Dados inválidos.";

function done(): void {
  revalidatePath("/[empresa]/financeiro", "layout");
}

function dbFailure(err: { code?: string; message?: string }, dup: string): ActionResult<never> {
  if (err.code === "23505") return { ok: false, error: dup, fieldErrors: { name: dup } };
  return { ok: false, error: translateDbError(err) };
}

function issue<T>(error: z.ZodError, field: string): ActionResult<T> {
  const i = firstIssue(error, field);
  return { ok: false, error: i.message, fieldErrors: { [i.field]: i.message } };
}

// --- Contas -----------------------------------------------------------------

export async function createAccount(companyId: string, input: AccountInput): Promise<ActionResult<{ id: string }>> {
  if (!uuid.safeParse(companyId).success) return { ok: false, error: INVALID };
  const p = accountSchema.safeParse(input);
  if (!p.success) return issue(p.error, "name");
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("fin_accounts")
    .insert({ company_id: companyId, name: p.data.name, bank: p.data.bank })
    .select("id")
    .single();
  if (error) return dbFailure(error, "Já existe uma conta com esse nome.");
  done();
  return { ok: true, data: { id: data.id } };
}

export async function updateAccount(id: string, input: AccountInput): Promise<ActionResult> {
  if (!uuid.safeParse(id).success) return { ok: false, error: INVALID };
  const p = accountSchema.safeParse(input);
  if (!p.success) return issue(p.error, "name");
  const supabase = await createServerClient();
  const { data, error } = await supabase.from("fin_accounts").update({ name: p.data.name, bank: p.data.bank }).eq("id", id).select("id");
  if (error) return dbFailure(error, "Já existe uma conta com esse nome.");
  if (!data || data.length === 0) return { ok: false, error: "Conta não encontrada." };
  done();
  return { ok: true, data: undefined };
}

export async function setAccountActive(id: string, active: boolean): Promise<ActionResult> {
  if (!uuid.safeParse(id).success || typeof active !== "boolean") return { ok: false, error: INVALID };
  const supabase = await createServerClient();
  const { data, error } = await supabase.from("fin_accounts").update({ active }).eq("id", id).select("id");
  if (error) return { ok: false, error: translateDbError(error) };
  if (!data || data.length === 0) return { ok: false, error: "Conta não encontrada." };
  done();
  return { ok: true, data: undefined };
}

/** Saldo informado de uma conta numa data; informar de novo na mesma data substitui o anterior. */
export async function saveBalanceSnapshot(
  accountId: string,
  asOf: string,
  balance: string | number,
  note?: string | null,
): Promise<ActionResult> {
  if (!uuid.safeParse(accountId).success) return { ok: false, error: INVALID };
  const p = balanceSnapshotSchema.safeParse({ asOf, balance, note });
  if (!p.success) return issue(p.error, "balance");
  const supabase = await createServerClient();
  const account = await supabase.from("fin_accounts").select("company_id").eq("id", accountId).maybeSingle();
  if (account.error) return { ok: false, error: translateDbError(account.error) };
  if (!account.data) return { ok: false, error: "Conta não encontrada." };
  const { error } = await supabase.from("fin_balance_snapshots").upsert(
    {
      company_id: account.data.company_id,
      account_id: accountId,
      as_of: p.data.asOf,
      balance: p.data.balance,
      note: p.data.note,
    },
    { onConflict: "account_id,as_of" },
  );
  if (error) return { ok: false, error: translateDbError(error) };
  done();
  return { ok: true, data: undefined };
}

// --- Categorias de despesa ---------------------------------------------------

async function nextPosition(table: "fin_expense_categories" | "fin_income_categories", companyId: string) {
  const supabase = await createServerClient();
  const last = await supabase.from(table).select("position").eq("company_id", companyId).order("position", { ascending: false }).limit(1).maybeSingle();
  return (last.data?.position ?? -1) + 1;
}

export async function createExpenseCategory(companyId: string, input: ExpenseCategoryInput): Promise<ActionResult<{ id: string }>> {
  if (!uuid.safeParse(companyId).success) return { ok: false, error: INVALID };
  const p = expenseCategorySchema.safeParse(input);
  if (!p.success) return issue(p.error, "name");
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("fin_expense_categories")
    .insert({ company_id: companyId, name: p.data.name, default_nature: p.data.defaultNature, position: await nextPosition("fin_expense_categories", companyId) })
    .select("id")
    .single();
  if (error) return dbFailure(error, "Já existe uma categoria com esse nome.");
  done();
  return { ok: true, data: { id: data.id } };
}

export async function updateExpenseCategory(id: string, input: ExpenseCategoryInput): Promise<ActionResult> {
  if (!uuid.safeParse(id).success) return { ok: false, error: INVALID };
  const p = expenseCategorySchema.safeParse(input);
  if (!p.success) return issue(p.error, "name");
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("fin_expense_categories")
    .update({ name: p.data.name, default_nature: p.data.defaultNature })
    .eq("id", id)
    .select("id");
  if (error) return dbFailure(error, "Já existe uma categoria com esse nome.");
  if (!data || data.length === 0) return { ok: false, error: "Categoria não encontrada." };
  done();
  return { ok: true, data: undefined };
}

export async function setExpenseCategoryActive(id: string, active: boolean): Promise<ActionResult> {
  if (!uuid.safeParse(id).success || typeof active !== "boolean") return { ok: false, error: INVALID };
  const supabase = await createServerClient();
  const { data, error } = await supabase.from("fin_expense_categories").update({ active }).eq("id", id).select("id");
  if (error) return { ok: false, error: translateDbError(error) };
  if (!data || data.length === 0) return { ok: false, error: "Categoria não encontrada." };
  done();
  return { ok: true, data: undefined };
}

// --- Categorias de receita ---------------------------------------------------

export async function createIncomeCategory(companyId: string, input: IncomeCategoryInput): Promise<ActionResult<{ id: string }>> {
  if (!uuid.safeParse(companyId).success) return { ok: false, error: INVALID };
  const p = incomeCategorySchema.safeParse(input);
  if (!p.success) return issue(p.error, "name");
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("fin_income_categories")
    .insert({ company_id: companyId, name: p.data.name, position: await nextPosition("fin_income_categories", companyId) })
    .select("id")
    .single();
  if (error) return dbFailure(error, "Já existe uma categoria com esse nome.");
  done();
  return { ok: true, data: { id: data.id } };
}

export async function updateIncomeCategory(id: string, input: IncomeCategoryInput): Promise<ActionResult> {
  if (!uuid.safeParse(id).success) return { ok: false, error: INVALID };
  const p = incomeCategorySchema.safeParse(input);
  if (!p.success) return issue(p.error, "name");
  const supabase = await createServerClient();
  const { data, error } = await supabase.from("fin_income_categories").update({ name: p.data.name }).eq("id", id).select("id");
  if (error) return dbFailure(error, "Já existe uma categoria com esse nome.");
  if (!data || data.length === 0) return { ok: false, error: "Categoria não encontrada." };
  done();
  return { ok: true, data: undefined };
}

export async function setIncomeCategoryActive(id: string, active: boolean): Promise<ActionResult> {
  if (!uuid.safeParse(id).success || typeof active !== "boolean") return { ok: false, error: INVALID };
  const supabase = await createServerClient();
  const { data, error } = await supabase.from("fin_income_categories").update({ active }).eq("id", id).select("id");
  if (error) return { ok: false, error: translateDbError(error) };
  if (!data || data.length === 0) return { ok: false, error: "Categoria não encontrada." };
  done();
  return { ok: true, data: undefined };
}
