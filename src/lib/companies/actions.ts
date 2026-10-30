"use server";

import { revalidatePath } from "next/cache";
import { requireSuperAdmin } from "@/lib/auth/session";
import { createServerClient } from "@/lib/supabase/server";
import { translateDbError, type ActionResult } from "@/lib/db-errors";
import { companySchema, type CompanyInput } from "./schema";

function parse(input: CompanyInput) {
  const parsed = companySchema.safeParse(input);
  if (parsed.success) return { ok: true as const, value: parsed.data };
  const fieldErrors: Record<string, string> = {};
  for (const issue of parsed.error.issues) {
    const key = String(issue.path[0] ?? "");
    if (key && !fieldErrors[key]) fieldErrors[key] = issue.message;
  }
  return {
    ok: false as const,
    result: { ok: false as const, error: "Corrija os campos destacados.", fieldErrors },
  };
}

function dbFailure(err: { code?: string; message?: string }): ActionResult<never> {
  if (err.code === "23505" && (err.message ?? "").includes("slug")) {
    return {
      ok: false,
      error: "Este endereço já está em uso.",
      fieldErrors: { slug: "Este endereço já está em uso." },
    };
  }
  return { ok: false, error: translateDbError(err) };
}

export async function createCompany(
  input: CompanyInput,
): Promise<ActionResult<{ slug: string }>> {
  await requireSuperAdmin();
  const p = parse(input);
  if (!p.ok) return p.result;
  const supabase = await createServerClient();
  const { error } = await supabase.from("companies").insert({
    name: p.value.name,
    slug: p.value.slug,
    legal_name: p.value.legalName ?? null,
    cnpj: p.value.cnpj ?? null,
  });
  if (error) return dbFailure(error);
  revalidatePath("/", "layout");
  return { ok: true, data: { slug: p.value.slug } };
}

export async function updateCompany(id: string, input: CompanyInput): Promise<ActionResult> {
  await requireSuperAdmin();
  const p = parse(input);
  if (!p.ok) return p.result;
  const supabase = await createServerClient();
  const { error } = await supabase
    .from("companies")
    .update({
      name: p.value.name,
      slug: p.value.slug,
      legal_name: p.value.legalName ?? null,
      cnpj: p.value.cnpj ?? null,
    })
    .eq("id", id);
  if (error) return dbFailure(error);
  revalidatePath("/", "layout");
  return { ok: true, data: undefined };
}

export async function setCompanyArchived(id: string, archived: boolean): Promise<ActionResult> {
  await requireSuperAdmin();
  const supabase = await createServerClient();
  const { error } = await supabase
    .from("companies")
    .update({ archived_at: archived ? new Date().toISOString() : null })
    .eq("id", id);
  if (error) return dbFailure(error);
  revalidatePath("/", "layout");
  return { ok: true, data: undefined };
}
