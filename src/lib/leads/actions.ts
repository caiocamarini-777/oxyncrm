"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentProfile } from "@/lib/auth/session";
import { translateDbError, type ActionResult } from "@/lib/db-errors";
import { createOrganization } from "@/lib/organizations/actions";
import { createPerson } from "@/lib/persons/actions";
import { checkCustomFields, firstIssue } from "@/lib/records/action-helpers";
import { safeTerm } from "@/lib/records/list-helpers";
import { createServerClient } from "@/lib/supabase/server";
import { disqualifySchema, leadSchema, type DisqualifyInput, type LeadInput } from "./schema";

const uuid = z.string().uuid();
const NO_PERMISSION = "Você não tem permissão para esta ação.";

/** Pessoa/organização digitadas que ainda não existem; criadas junto com o lead. */
export type NewParty = { name: string };

/**
 * Criação rápida: cria a organização e/ou a pessoa (mesma empresa, usuário atual como responsável)
 * e depois o lead. Se o lead falhar, tenta apagar o que acabou de criar; sem permissão de exclusão
 * os registros ficam e a mensagem de erro avisa ("A pessoa foi criada, mas o lead não").
 */
export async function createLead(
  companyId: string,
  input: LeadInput,
  created?: { person?: NewParty; organization?: NewParty },
): Promise<ActionResult<{ id: string }>> {
  if (!uuid.safeParse(companyId).success) return { ok: false, error: "Dados inválidos." };
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, error: NO_PERMISSION };
  const parsed = leadSchema.safeParse(input);
  if (!parsed.success) {
    const { field, message } = firstIssue(parsed.error, "title");
    return { ok: false, error: message, fieldErrors: { [field]: message } };
  }
  const d = parsed.data;
  for (const k of Object.keys(d.customFields)) if (d.customFields[k] === null) delete d.customFields[k];
  const cf = await checkCustomFields(companyId, "leads", d.customFields);
  if (!cf.ok) return { ok: false, error: cf.error, fieldErrors: { [`cf-${cf.key}`]: cf.error } };

  const supabase = await createServerClient();
  const made: { table: "organizations" | "persons"; id: string; noun: string }[] = [];
  let organizationId = d.organizationId;
  let personId = d.personId;

  // Reverte o que foi criado; devolve o texto do que ficou para trás.
  async function rollback(reason: string): Promise<string> {
    const left: string[] = [];
    for (const m of [...made].reverse()) {
      const { data, error } = await supabase.from(m.table).delete().eq("id", m.id).select("id");
      if (error || !data || data.length === 0) left.push(m.noun);
    }
    if (left.length === 0) return reason;
    const subject = left.length === 2 ? "A organização e a pessoa foram criadas" : `A ${left[0]} foi criada`;
    return `${subject}, mas o lead não: ${reason}`;
  }

  const newOrg = created?.organization?.name.trim();
  if (newOrg) {
    const res = await createOrganization(companyId, { name: newOrg });
    if (!res.ok) return { ok: false, error: res.error, fieldErrors: { organizationId: res.error } };
    organizationId = res.data.id;
    made.push({ table: "organizations", id: res.data.id, noun: "organização" });
  }
  const newPerson = created?.person?.name.trim();
  if (newPerson) {
    const res = await createPerson(companyId, { fullName: newPerson, organizationId });
    if (!res.ok) {
      return { ok: false, error: await rollback(res.error), fieldErrors: { personId: res.error } };
    }
    personId = res.data.id;
    made.push({ table: "persons", id: res.data.id, noun: "pessoa" });
  }

  const { data, error } = await supabase
    .from("leads")
    .insert({
      company_id: companyId,
      owner_id: d.ownerId ?? profile.id,
      title: d.title,
      source_id: d.sourceId,
      person_id: personId,
      organization_id: organizationId,
      estimated_value: d.estimatedValue,
      custom_fields: d.customFields,
    })
    .select("id")
    .single();
  if (error) return { ok: false, error: await rollback(translateDbError(error)) };
  revalidatePath("/", "layout");
  return { ok: true, data: { id: data.id } };
}

/** Edita os dados; status e responsável têm ações próprias. Campos arquivados são preservados. */
export async function updateLead(id: string, input: LeadInput): Promise<ActionResult> {
  if (!uuid.safeParse(id).success) return { ok: false, error: "Dados inválidos." };
  const parsed = leadSchema.safeParse(input);
  if (!parsed.success) {
    const { field, message } = firstIssue(parsed.error, "title");
    return { ok: false, error: message, fieldErrors: { [field]: message } };
  }
  const d = parsed.data;
  const supabase = await createServerClient();
  const { data: current, error: readError } = await supabase
    .from("leads")
    .select("company_id, custom_fields")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (readError) {
    console.error(`[leads] leitura antes de salvar:`, readError.code, readError.message);
    return { ok: false, error: "Não foi possível salvar agora. Tente novamente." };
  }
  if (!current) return { ok: false, error: "Registro não encontrado ou sem permissão." };
  const cf = await checkCustomFields(
    current.company_id,
    "leads",
    d.customFields,
    (current.custom_fields ?? {}) as Record<string, unknown>,
  );
  if (!cf.ok) return { ok: false, error: cf.error, fieldErrors: { [`cf-${cf.key}`]: cf.error } };

  const merged = { ...((current.custom_fields ?? {}) as Record<string, unknown>), ...d.customFields };
  for (const k of Object.keys(merged)) if (merged[k] === null) delete merged[k];
  const { data, error } = await supabase
    .from("leads")
    .update({
      title: d.title,
      source_id: d.sourceId,
      person_id: d.personId,
      organization_id: d.organizationId,
      estimated_value: d.estimatedValue,
      custom_fields: merged,
    })
    .eq("id", id)
    .is("deleted_at", null)
    .select("id");
  if (error) return { ok: false, error: translateDbError(error) };
  if (!data || data.length === 0) {
    return { ok: false, error: "Não foi possível salvar: o lead não existe, está na lixeira ou você não tem permissão." };
  }
  revalidatePath("/", "layout");
  return { ok: true, data: undefined };
}

async function transition(
  id: string,
  from: string[],
  patch: Record<string, unknown>,
  wrongState: string,
): Promise<ActionResult> {
  if (!uuid.safeParse(id).success) return { ok: false, error: "Dados inválidos." };
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, error: NO_PERMISSION };
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("leads")
    .update(patch)
    .eq("id", id)
    .is("deleted_at", null)
    .in("status", from)
    .select("id");
  if (error) return { ok: false, error: translateDbError(error) };
  if (!data || data.length === 0) return { ok: false, error: wrongState };
  revalidatePath("/", "layout");
  return { ok: true, data: undefined };
}

/** Só de `open`. O motivo precisa estar ativo e ser da empresa do lead. */
export async function disqualifyLead(id: string, input: DisqualifyInput): Promise<ActionResult> {
  if (!uuid.safeParse(id).success) return { ok: false, error: "Dados inválidos." };
  const parsed = disqualifySchema.safeParse(input);
  if (!parsed.success) {
    const message = parsed.error.issues[0].message;
    return { ok: false, error: message, fieldErrors: { reasonId: message } };
  }
  const supabase = await createServerClient();
  const lead = await supabase.from("leads").select("company_id").eq("id", id).is("deleted_at", null).maybeSingle();
  if (lead.error) {
    console.error("[leads] leitura antes de desqualificar:", lead.error.code, lead.error.message);
    return { ok: false, error: "Não foi possível concluir. Tente novamente." };
  }
  if (!lead.data) return { ok: false, error: "Registro não encontrado ou sem permissão." };
  const reason = await supabase
    .from("disqualification_reasons")
    .select("id")
    .eq("id", parsed.data.reasonId)
    .eq("company_id", lead.data.company_id)
    .eq("active", true)
    .maybeSingle();
  if (reason.error) return { ok: false, error: "Não foi possível concluir. Tente novamente." };
  if (!reason.data) return { ok: false, error: "Escolha um motivo.", fieldErrors: { reasonId: "Escolha um motivo." } };
  return transition(
    id,
    ["open"],
    {
      status: "disqualified",
      disqualification_reason_id: parsed.data.reasonId,
      disqualification_note: parsed.data.note,
    },
    "Só leads abertos podem ser desqualificados.",
  );
}

/** De `disqualified` ou `archived` para `open`; limpa motivo e observação. */
export async function reopenLead(id: string): Promise<ActionResult> {
  return transition(
    id,
    ["disqualified", "archived"],
    { status: "open", disqualification_reason_id: null, disqualification_note: null },
    "Só leads desqualificados ou arquivados podem ser reabertos.",
  );
}

/** De `open` ou `disqualified` para `archived`. */
export async function archiveLead(id: string): Promise<ActionResult> {
  return transition(
    id,
    ["open", "disqualified"],
    { status: "archived" },
    "Só leads abertos ou desqualificados podem ser arquivados.",
  );
}

/** Busca pessoas da empresa por nome (o RLS limita ao que o usuário lê). Máximo de 20. */
export async function searchPersonsByName(
  companyId: string,
  term: string,
): Promise<ActionResult<{ id: string; name: string }[]>> {
  if (!uuid.safeParse(companyId).success) return { ok: false, error: "Dados inválidos." };
  const t = safeTerm(term);
  const supabase = await createServerClient();
  let q = supabase
    .from("persons")
    .select("id, full_name")
    .eq("company_id", companyId)
    .is("deleted_at", null)
    .order("full_name")
    .limit(20);
  if (t) q = q.ilike("full_name", `%${t}%`);
  const { data, error } = await q;
  if (error) return { ok: false, error: translateDbError(error) };
  return { ok: true, data: (data ?? []).map((p) => ({ id: p.id, name: p.full_name })) };
}
