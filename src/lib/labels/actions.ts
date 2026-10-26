"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSuperAdmin } from "@/lib/auth/session";
import { createServerClient } from "@/lib/supabase/server";
import { translateDbError, type ActionResult } from "@/lib/db-errors";
import { LABEL_COLORS } from "@/lib/custom-fields/schema";

const PATH = "/configuracoes/etiquetas";

const labelSchema = z.object({
  name: z.string().trim().min(1, "Informe o nome.").max(40, "Use no máximo 40 caracteres."),
  color: z.enum(LABEL_COLORS, { error: "Escolha uma cor." }),
});

function failure(err: { code?: string; message?: string }): ActionResult<never> {
  if (err.code === "23505") {
    const message = "Já existe uma etiqueta com esse nome.";
    return { ok: false, error: message, fieldErrors: { name: message } };
  }
  return { ok: false, error: translateDbError(err) };
}

function invalid(error: z.ZodError): ActionResult<never> {
  const issue = error.issues[0];
  return { ok: false, error: issue.message, fieldErrors: { [String(issue.path[0] ?? "name")]: issue.message } };
}

export async function createLabel(
  companyId: string,
  input: { name: string; color: string },
): Promise<ActionResult<{ id: string }>> {
  await requireSuperAdmin();
  if (!z.string().uuid().safeParse(companyId).success) return { ok: false, error: "Dados inválidos." };
  const parsed = labelSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("labels")
    .insert({ company_id: companyId, ...parsed.data })
    .select("id")
    .single();
  if (error) return failure(error);
  revalidatePath(PATH);
  return { ok: true, data: { id: data.id } };
}

export async function updateLabel(
  id: string,
  input: { name: string; color: string },
): Promise<ActionResult> {
  await requireSuperAdmin();
  const parsed = labelSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const supabase = await createServerClient();
  const { error } = await supabase.from("labels").update(parsed.data).eq("id", id);
  if (error) return failure(error);
  revalidatePath(PATH);
  return { ok: true, data: undefined };
}

/** Remove a etiqueta e, em cascata, o vínculo com os registros. */
export async function deleteLabel(id: string): Promise<ActionResult> {
  await requireSuperAdmin();
  const supabase = await createServerClient();
  const { error } = await supabase.from("labels").delete().eq("id", id);
  if (error) return { ok: false, error: translateDbError(error) };
  revalidatePath(PATH);
  return { ok: true, data: undefined };
}
