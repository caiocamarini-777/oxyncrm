"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSuperAdmin } from "@/lib/auth/session";
import { firstIssue } from "@/lib/records/action-helpers";
import { createServerClient } from "@/lib/supabase/server";
import { translateDbError, type ActionResult } from "@/lib/db-errors";
import { productSchema, type ProductInput } from "./schema";

const PATH = "/configuracoes/produtos";
const uuid = z.string().uuid();

function dbFailure(err: { code?: string; message?: string }): ActionResult<never> {
  if (err.code === "23505") {
    const message = "Já existe um produto com esse nome.";
    return { ok: false, error: message, fieldErrors: { name: message } };
  }
  return { ok: false, error: translateDbError(err) };
}

export async function createProduct(companyId: string, input: ProductInput): Promise<ActionResult<{ id: string }>> {
  await requireSuperAdmin();
  if (!uuid.safeParse(companyId).success) return { ok: false, error: "Dados inválidos." };
  const parsed = productSchema.safeParse(input);
  if (!parsed.success) {
    const { field, message } = firstIssue(parsed.error, "name");
    return { ok: false, error: message, fieldErrors: { [field]: message } };
  }
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("products")
    .insert({
      company_id: companyId,
      name: parsed.data.name,
      kind: parsed.data.kind,
      default_price: parsed.data.defaultPrice,
      service_category_id: parsed.data.serviceCategoryId,
    })
    .select("id")
    .single();
  if (error) return dbFailure(error);
  revalidatePath(PATH);
  return { ok: true, data: { id: data.id } };
}

/** O tipo só muda enquanto nenhum negócio usa o produto. */
export async function updateProduct(id: string, input: ProductInput): Promise<ActionResult> {
  await requireSuperAdmin();
  if (!uuid.safeParse(id).success) return { ok: false, error: "Dados inválidos." };
  const parsed = productSchema.safeParse(input);
  if (!parsed.success) {
    const { field, message } = firstIssue(parsed.error, "name");
    return { ok: false, error: message, fieldErrors: { [field]: message } };
  }
  const supabase = await createServerClient();
  const { data: current, error: readError } = await supabase.from("products").select("kind").eq("id", id).single();
  if (readError) return { ok: false, error: translateDbError(readError) };
  if (current.kind !== parsed.data.kind) {
    const { count, error: countError } = await supabase
      .from("deal_items")
      .select("id", { count: "exact", head: true })
      .eq("product_id", id);
    if (countError) return { ok: false, error: translateDbError(countError) };
    if ((count ?? 0) > 0) {
      const message = "O tipo não pode mudar depois de usado em negócios.";
      return { ok: false, error: message, fieldErrors: { kind: message } };
    }
  }
  const { error } = await supabase
    .from("products")
    .update({
      name: parsed.data.name,
      kind: parsed.data.kind,
      default_price: parsed.data.defaultPrice,
      service_category_id: parsed.data.serviceCategoryId,
    })
    .eq("id", id);
  if (error) return dbFailure(error);
  revalidatePath(PATH);
  return { ok: true, data: undefined };
}

export async function setProductActive(id: string, active: boolean): Promise<ActionResult> {
  await requireSuperAdmin();
  if (!uuid.safeParse(id).success) return { ok: false, error: "Dados inválidos." };
  const supabase = await createServerClient();
  const { error } = await supabase.from("products").update({ active }).eq("id", id);
  if (error) return { ok: false, error: translateDbError(error) };
  revalidatePath(PATH);
  return { ok: true, data: undefined };
}
