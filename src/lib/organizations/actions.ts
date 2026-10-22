"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentProfile } from "@/lib/auth/session";
import { validateCustomFieldValues } from "@/lib/custom-fields/schema";
import { translateDbError, type ActionResult } from "@/lib/db-errors";
import type { DuplicateMatch } from "@/lib/records/duplicates";
import { listActiveCustomFieldDefs } from "@/lib/records/lookups";
import { listAssignableOwners } from "@/lib/records/owners";
import { createServerClient } from "@/lib/supabase/server";
import { organizationSchema, normalizeDomain, type OrganizationInput } from "./schema";

const uuid = z.string().uuid();

function firstIssue(err: z.ZodError): { field: string; message: string } {
  const issue = err.issues[0];
  const field = issue.path[0] === "address" ? String(issue.path[1] ?? "address") : String(issue.path[0] ?? "name");
  return { field, message: issue.message };
}

async function checkCustomFields(
  companyId: string,
  values: Record<string, unknown>,
): Promise<{ ok: true } | { ok: false; error: string; key: string }> {
  const [defs, owners] = await Promise.all([
    listActiveCustomFieldDefs(companyId, "organizations"),
    listAssignableOwners(companyId),
  ]);
  const res = validateCustomFieldValues(defs, values, owners.map((o) => o.id));
  return res.ok ? res : { ok: false, error: res.message, key: res.key };
}

export async function createOrganization(
  companyId: string,
  input: OrganizationInput,
): Promise<ActionResult<{ id: string }>> {
  if (!uuid.safeParse(companyId).success) return { ok: false, error: "Dados inválidos." };
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, error: "Você não tem permissão para esta ação." };
  const parsed = organizationSchema.safeParse(input);
  if (!parsed.success) {
    const { field, message } = firstIssue(parsed.error);
    return { ok: false, error: message, fieldErrors: { [field]: message } };
  }
  const d = parsed.data;
  for (const k of Object.keys(d.customFields)) if (d.customFields[k] === null) delete d.customFields[k];
  const cf = await checkCustomFields(companyId, d.customFields);
  if (!cf.ok) return { ok: false, error: cf.error, fieldErrors: { [`cf-${cf.key}`]: cf.error } };

  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("organizations")
    .insert({
      company_id: companyId,
      owner_id: d.ownerId ?? profile.id,
      name: d.name,
      legal_name: d.legalName,
      cnpj: d.cnpj,
      domain: d.domain,
      segment: d.segment,
      address: d.address,
      custom_fields: d.customFields,
    })
    .select("id")
    .single();
  if (error) return { ok: false, error: translateDbError(error) };
  revalidatePath("/", "layout");
  return { ok: true, data: { id: data.id } };
}

/** Edita os dados; o responsável muda só por `reassignOwner`. Campos arquivados são preservados. */
export async function updateOrganization(id: string, input: OrganizationInput): Promise<ActionResult> {
  if (!uuid.safeParse(id).success) return { ok: false, error: "Dados inválidos." };
  const parsed = organizationSchema.safeParse(input);
  if (!parsed.success) {
    const { field, message } = firstIssue(parsed.error);
    return { ok: false, error: message, fieldErrors: { [field]: message } };
  }
  const d = parsed.data;
  const supabase = await createServerClient();
  const { data: current } = await supabase
    .from("organizations")
    .select("company_id, custom_fields")
    .eq("id", id)
    .maybeSingle();
  if (!current) return { ok: false, error: "Registro não encontrado ou sem permissão." };
  const cf = await checkCustomFields(current.company_id, d.customFields);
  if (!cf.ok) return { ok: false, error: cf.error, fieldErrors: { [`cf-${cf.key}`]: cf.error } };

  const merged = { ...((current.custom_fields ?? {}) as Record<string, unknown>), ...d.customFields };
  for (const k of Object.keys(merged)) if (merged[k] === null) delete merged[k];
  const { data, error } = await supabase
    .from("organizations")
    .update({
      name: d.name,
      legal_name: d.legalName,
      cnpj: d.cnpj,
      domain: d.domain,
      segment: d.segment,
      address: d.address,
      custom_fields: merged,
    })
    .eq("id", id)
    .select("id");
  if (error) return { ok: false, error: translateDbError(error) };
  if (!data || data.length === 0) return { ok: false, error: "Registro não encontrado ou sem permissão." };
  revalidatePath("/", "layout");
  return { ok: true, data: undefined };
}

/** Só `matchedOn` e `ownerName` saem daqui; `recordId` vem preenchido apenas quando o usuário pode ler. */
export async function findOrganizationDuplicates(
  companyId: string,
  fields: { cnpj?: string | null; domain?: string | null },
  excludeId?: string,
): Promise<ActionResult<DuplicateMatch[]>> {
  if (!uuid.safeParse(companyId).success || (excludeId && !uuid.safeParse(excludeId).success)) {
    return { ok: false, error: "Dados inválidos." };
  }
  const cnpj = (fields.cnpj ?? "").replace(/\D/g, "");
  const domain = fields.domain ? normalizeDomain(fields.domain) : "";
  if (cnpj.length !== 14 && !domain) return { ok: true, data: [] };
  const supabase = await createServerClient();
  const { data, error } = await supabase.rpc("check_duplicates", {
    p_company: companyId,
    p_entity: "organizations",
    p_cnpj: cnpj.length === 14 ? cnpj : null,
    p_domain: domain || null,
    p_exclude: excludeId ?? null,
  });
  if (error) return { ok: false, error: translateDbError(error) };
  const rows = (data ?? []) as { matched_on: string; owner_name: string; record_id: string | null }[];
  return {
    ok: true,
    data: rows.map((r) => ({ matchedOn: r.matched_on, ownerName: r.owner_name, recordId: r.record_id })),
  };
}
