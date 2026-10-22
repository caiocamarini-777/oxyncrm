"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentProfile } from "@/lib/auth/session";
import { translateDbError, type ActionResult } from "@/lib/db-errors";
import type { DuplicateMatch } from "@/lib/records/duplicates";
import { normalizePhone } from "@/lib/records/format";
import { checkCustomFields, firstIssue } from "@/lib/records/action-helpers";
import { createServerClient } from "@/lib/supabase/server";
import { personSchema, type PersonInput } from "./schema";

const uuid = z.string().uuid();

/** Campo do formulário a que o primeiro erro se refere (`emails.1.value` vira `emails-1`). */
/** `emails.1.value` vira `emails-1`, o id do campo da linha no formulário. */
const issueField = (path: PropertyKey[]) =>
  (path[0] === "emails" || path[0] === "phones") && typeof path[1] === "number" ? `${String(path[0])}-${path[1]}` : undefined;

export async function createPerson(companyId: string, input: PersonInput): Promise<ActionResult<{ id: string }>> {
  if (!uuid.safeParse(companyId).success) return { ok: false, error: "Dados inválidos." };
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, error: "Você não tem permissão para esta ação." };
  const parsed = personSchema.safeParse(input);
  if (!parsed.success) {
    const { field, message } = firstIssue(parsed.error, "fullName", issueField);
    return { ok: false, error: message, fieldErrors: { [field]: message } };
  }
  const d = parsed.data;
  for (const k of Object.keys(d.customFields)) if (d.customFields[k] === null) delete d.customFields[k];
  const cf = await checkCustomFields(companyId, "persons", d.customFields);
  if (!cf.ok) return { ok: false, error: cf.error, fieldErrors: { [`cf-${cf.key}`]: cf.error } };

  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("persons")
    .insert({
      company_id: companyId,
      owner_id: d.ownerId ?? profile.id,
      full_name: d.fullName,
      job_title: d.jobTitle,
      organization_id: d.organizationId,
      emails: d.emails,
      phones: d.phones,
      linkedin_url: d.linkedinUrl,
      custom_fields: d.customFields,
    })
    .select("id")
    .single();
  if (error) return { ok: false, error: translateDbError(error) };
  revalidatePath("/", "layout");
  return { ok: true, data: { id: data.id } };
}

/** Edita os dados; o responsável muda só por `reassignOwner`. Campos arquivados são preservados. */
export async function updatePerson(id: string, input: PersonInput): Promise<ActionResult> {
  if (!uuid.safeParse(id).success) return { ok: false, error: "Dados inválidos." };
  const parsed = personSchema.safeParse(input);
  if (!parsed.success) {
    const { field, message } = firstIssue(parsed.error, "fullName", issueField);
    return { ok: false, error: message, fieldErrors: { [field]: message } };
  }
  const d = parsed.data;
  const supabase = await createServerClient();
  const { data: current, error: readError } = await supabase
    .from("persons")
    .select("company_id, custom_fields")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (readError) {
    console.error(`[persons] leitura antes de salvar:`, readError.code, readError.message);
    return { ok: false, error: "Não foi possível salvar agora. Tente novamente." };
  }
  if (!current) return { ok: false, error: "Registro não encontrado ou sem permissão." };
  const cf = await checkCustomFields(current.company_id, "persons", d.customFields);
  if (!cf.ok) return { ok: false, error: cf.error, fieldErrors: { [`cf-${cf.key}`]: cf.error } };

  const merged = { ...((current.custom_fields ?? {}) as Record<string, unknown>), ...d.customFields };
  for (const k of Object.keys(merged)) if (merged[k] === null) delete merged[k];
  const { data, error } = await supabase
    .from("persons")
    .update({
      full_name: d.fullName,
      job_title: d.jobTitle,
      organization_id: d.organizationId,
      emails: d.emails,
      phones: d.phones,
      linkedin_url: d.linkedinUrl,
      custom_fields: merged,
    })
    .eq("id", id)
    .is("deleted_at", null)
    .select("id");
  if (error) return { ok: false, error: translateDbError(error) };
  if (!data || data.length === 0) {
    return { ok: false, error: "Não foi possível salvar: a pessoa não existe, está na lixeira ou você não tem permissão." };
  }
  revalidatePath("/", "layout");
  return { ok: true, data: undefined };
}

/** Só `matchedOn` e `ownerName` saem daqui; `recordId` vem preenchido apenas quando o usuário pode ler. */
export async function findPersonDuplicates(
  companyId: string,
  fields: { emails?: string[]; phones?: string[] },
  excludeId?: string,
): Promise<ActionResult<DuplicateMatch[]>> {
  if (!uuid.safeParse(companyId).success || (excludeId && !uuid.safeParse(excludeId).success)) {
    return { ok: false, error: "Dados inválidos." };
  }
  const emails = (fields.emails ?? []).map((e) => e.trim().toLowerCase()).filter(Boolean).slice(0, 10);
  const phones = (fields.phones ?? []).map((p) => normalizePhone(p)).filter((p) => p.length >= 10).slice(0, 10);
  if (emails.length === 0 && phones.length === 0) return { ok: true, data: [] };
  const supabase = await createServerClient();
  const { data, error } = await supabase.rpc("check_duplicates", {
    p_company: companyId,
    p_entity: "persons",
    p_emails: emails,
    p_phones: phones,
    p_exclude: excludeId ?? null,
  });
  if (error) return { ok: false, error: translateDbError(error) };
  const rows = (data ?? []) as { matched_on: string; owner_name: string; record_id: string | null }[];
  return {
    ok: true,
    data: rows.map((r) => ({ matchedOn: r.matched_on, ownerName: r.owner_name, recordId: r.record_id })),
  };
}

/** Busca organizações da empresa (o RLS limita ao que o usuário lê). Máximo de 20. */
export async function searchOrganizations(
  companyId: string,
  term: string,
): Promise<ActionResult<{ id: string; name: string }[]>> {
  if (!uuid.safeParse(companyId).success) return { ok: false, error: "Dados inválidos." };
  const t = term.replace(/[,()*%\\"]/g, " ").replace(/\s+/g, " ").trim();
  const supabase = await createServerClient();
  let q = supabase
    .from("organizations")
    .select("id, name")
    .eq("company_id", companyId)
    .is("deleted_at", null)
    .order("name")
    .limit(20);
  if (t) q = q.ilike("name", `%${t}%`);
  const { data, error } = await q;
  if (error) return { ok: false, error: translateDbError(error) };
  return { ok: true, data: (data ?? []).map((o) => ({ id: o.id, name: o.name })) };
}
