"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSuperAdmin } from "@/lib/auth/session";
import { createServerClient } from "@/lib/supabase/server";
import { translateDbError, type ActionResult } from "@/lib/db-errors";
import { DEFAULT_PERMISSIONS, permissionsSchema, type Permissions } from "@/lib/permissions/schema";

const identitySchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Informe o nome (mínimo 2 caracteres).")
    .max(60, "Use no máximo 60 caracteres."),
  description: z.string().trim().max(240, "Use no máximo 240 caracteres."),
});

function fieldErrorsOf(error: z.ZodError) {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "");
    if (key && !fieldErrors[key]) fieldErrors[key] = issue.message;
  }
  return fieldErrors;
}

function dbFailure(err: { code?: string; message?: string }): ActionResult<never> {
  if (err.code === "23505") {
    return {
      ok: false,
      error: "Já existe um papel com este nome.",
      fieldErrors: { name: "Já existe um papel com este nome." },
    };
  }
  return { ok: false, error: translateDbError(err) };
}

export async function createRole(input: {
  name: string;
  description: string;
}): Promise<ActionResult<{ id: string }>> {
  await requireSuperAdmin();
  const parsed = identitySchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Corrija os campos destacados.",
      fieldErrors: fieldErrorsOf(parsed.error),
    };
  }
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("roles")
    .insert({
      name: parsed.data.name,
      description: parsed.data.description || null,
      permissions: DEFAULT_PERMISSIONS,
    })
    .select("id")
    .single();
  if (error) return dbFailure(error);
  revalidatePath("/configuracoes/papeis");
  return { ok: true, data: { id: data.id } };
}

export async function updateRole(
  id: string,
  input: { name: string; description: string; permissions: Permissions },
): Promise<ActionResult> {
  await requireSuperAdmin();
  const identity = identitySchema.safeParse({ name: input.name, description: input.description });
  if (!identity.success) {
    return {
      ok: false,
      error: "Corrija os campos destacados.",
      fieldErrors: fieldErrorsOf(identity.error),
    };
  }
  const perms = permissionsSchema.safeParse(input.permissions);
  if (!perms.success) return { ok: false, error: "Permissões inválidas." };
  const supabase = await createServerClient();
  const { error } = await supabase
    .from("roles")
    .update({
      name: identity.data.name,
      description: identity.data.description || null,
      permissions: perms.data,
    })
    .eq("id", id);
  if (error) return dbFailure(error);
  revalidatePath("/configuracoes/papeis");
  revalidatePath(`/configuracoes/papeis/${id}`);
  return { ok: true, data: undefined };
}

export async function deleteRole(id: string): Promise<ActionResult> {
  await requireSuperAdmin();
  const supabase = await createServerClient();
  const { count, error: countError } = await supabase
    .from("memberships")
    .select("id", { count: "exact", head: true })
    .eq("role_id", id);
  if (countError) return { ok: false, error: translateDbError(countError) };
  if (count && count > 0) {
    return {
      ok: false,
      error: `Este papel está em uso por ${count} ${count === 1 ? "acesso" : "acessos"}. Troque o papel dessas pessoas antes de excluir.`,
    };
  }
  const { error } = await supabase.from("roles").delete().eq("id", id);
  if (error) return { ok: false, error: translateDbError(error) };
  revalidatePath("/configuracoes/papeis");
  return { ok: true, data: undefined };
}
