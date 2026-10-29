"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSuperAdmin } from "@/lib/auth/session";
import { firstIssue } from "@/lib/records/action-helpers";
import { createServerClient } from "@/lib/supabase/server";
import { translateDbError, type ActionResult } from "@/lib/db-errors";
import { serviceCategorySchema, type ServiceCategoryInput } from "./schema";

const PATH = "/configuracoes/categorias-servico";
const uuid = z.string().uuid();

function dbFailure(err: { code?: string; message?: string }): ActionResult<never> {
  if (err.code === "23505") {
    const message = "Já existe uma categoria com esse nome.";
    return { ok: false, error: message, fieldErrors: { name: message } };
  }
  return { ok: false, error: translateDbError(err) };
}

export async function createServiceCategory(
  companyId: string,
  input: ServiceCategoryInput,
): Promise<ActionResult<{ id: string }>> {
  await requireSuperAdmin();
  if (!uuid.safeParse(companyId).success) return { ok: false, error: "Dados inválidos." };
  const parsed = serviceCategorySchema.safeParse(input);
  if (!parsed.success) {
    const { field, message } = firstIssue(parsed.error, "name");
    return { ok: false, error: message, fieldErrors: { [field]: message } };
  }
  const supabase = await createServerClient();
  const last = await supabase
    .from("service_categories")
    .select("position")
    .eq("company_id", companyId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (last.error) return { ok: false, error: translateDbError(last.error) };
  const { data, error } = await supabase
    .from("service_categories")
    .insert({
      company_id: companyId,
      name: parsed.data.name,
      ...(parsed.data.color ? { color: parsed.data.color } : {}),
      position: (last.data?.position ?? -1) + 1,
    })
    .select("id")
    .single();
  if (error) return dbFailure(error);
  revalidatePath(PATH);
  return { ok: true, data: { id: data.id } };
}

export async function updateServiceCategory(id: string, input: ServiceCategoryInput): Promise<ActionResult> {
  await requireSuperAdmin();
  if (!uuid.safeParse(id).success) return { ok: false, error: "Dados inválidos." };
  const parsed = serviceCategorySchema.safeParse(input);
  if (!parsed.success) {
    const { field, message } = firstIssue(parsed.error, "name");
    return { ok: false, error: message, fieldErrors: { [field]: message } };
  }
  const supabase = await createServerClient();
  const { error } = await supabase
    .from("service_categories")
    .update({ name: parsed.data.name, ...(parsed.data.color ? { color: parsed.data.color } : {}) })
    .eq("id", id);
  if (error) return dbFailure(error);
  revalidatePath(PATH);
  return { ok: true, data: undefined };
}

export async function setServiceCategoryActive(id: string, active: boolean): Promise<ActionResult> {
  await requireSuperAdmin();
  if (!uuid.safeParse(id).success) return { ok: false, error: "Dados inválidos." };
  const supabase = await createServerClient();
  const { error } = await supabase.from("service_categories").update({ active }).eq("id", id);
  if (error) return { ok: false, error: translateDbError(error) };
  revalidatePath(PATH);
  return { ok: true, data: undefined };
}

/** `ids` é a nova ordem completa das categorias da empresa. */
export async function reorderServiceCategories(companyId: string, ids: string[]): Promise<ActionResult> {
  await requireSuperAdmin();
  if (!uuid.safeParse(companyId).success || !ids.every((s) => uuid.safeParse(s).success)) {
    return { ok: false, error: "Dados inválidos." };
  }
  const supabase = await createServerClient();
  const results = await Promise.all(
    ids.map((id, position) =>
      supabase.from("service_categories").update({ position }).eq("id", id).eq("company_id", companyId),
    ),
  );
  const failed = results.find((r) => r.error);
  if (failed?.error) return { ok: false, error: translateDbError(failed.error) };
  revalidatePath(PATH);
  return { ok: true, data: undefined };
}
