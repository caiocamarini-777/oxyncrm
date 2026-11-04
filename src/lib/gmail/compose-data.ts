import "server-only";
import { getCurrentProfile } from "@/lib/auth/session";
import type { RecordEntity } from "@/lib/records/types";
import { createServerClient } from "@/lib/supabase/server";
import {
  buildTemplateVars,
  firstPersonEmail,
  type ComposeData,
  type ComposeMailbox,
  type ComposeTemplate,
} from "./compose";
import { listMyMailboxes } from "./live";

/** Modelos da empresa (sem os excluídos), por nome. A RLS limita às empresas do usuário. */
export async function getCompanyTemplates(companyId: string): Promise<ComposeTemplate[]> {
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("email_templates")
    .select("id, name, subject, body")
    .eq("company_id", companyId)
    .is("deleted_at", null)
    .order("name");
  if (error) {
    console.error("[email] modelos:", error.code, error.message);
    return [];
  }
  return (data ?? []) as ComposeTemplate[];
}

/** Caixas do usuário na empresa que podem enviar (as que pedem reconexão ficam de fora). */
export async function getSendableMailboxes(userId: string, companyId: string): Promise<ComposeMailbox[]> {
  try {
    return (await listMyMailboxes(userId, companyId))
      .filter((m) => m.status === "active")
      .map((m) => ({ id: m.id, email: m.email }));
  } catch {
    return [];
  }
}

type RecordRow = {
  company_id: string;
  title?: string;
  full_name?: string;
  name?: string;
  emails?: unknown;
  person_id?: string | null;
  organization_id?: string | null;
};

const SELECT: Record<RecordEntity, string> = {
  leads: "company_id, title, person_id, organization_id",
  deals: "company_id, title, person_id, organization_id",
  persons: "company_id, full_name, emails, organization_id",
  organizations: "company_id, name",
};
const TABLE: Record<RecordEntity, string> = {
  leads: "leads",
  deals: "deals",
  persons: "persons",
  organizations: "organizations",
};

/**
 * Dados do compositor para um card: destinatário sugerido (primeiro e-mail da pessoa do card), variáveis
 * dos modelos (pessoa, organização, negócio e usuário), modelos da empresa e as caixas do usuário nela.
 * `canEdit`: o usuário pode editar o registro (condição para enviar a partir dele).
 * Devolve `null` se o registro não existe ou o usuário não o enxerga.
 */
export async function getComposeData(entity: RecordEntity, recordId: string): Promise<(ComposeData & { companyId: string; canEdit: boolean }) | null> {
  const profile = await getCurrentProfile();
  if (!profile) return null;
  const supabase = await createServerClient();

  const rec = await supabase.from(TABLE[entity]).select(SELECT[entity]).eq("id", recordId).is("deleted_at", null).maybeSingle();
  if (rec.error || !rec.data) return null;
  const record = rec.data as unknown as RecordRow;

  const personId = entity === "persons" ? recordId : (record.person_id ?? null);
  let person: { full_name: string; emails: unknown; organization_id: string | null } | null = null;
  if (entity === "persons") {
    person = { full_name: record.full_name ?? "", emails: record.emails, organization_id: record.organization_id ?? null };
  } else if (personId) {
    const p = await supabase.from("persons").select("full_name, emails, organization_id").eq("id", personId).is("deleted_at", null).maybeSingle();
    if (!p.error && p.data) person = p.data as { full_name: string; emails: unknown; organization_id: string | null };
  }

  const orgId = entity === "organizations" ? recordId : (record.organization_id ?? person?.organization_id ?? null);
  let orgName = entity === "organizations" ? (record.name ?? "") : "";
  if (entity !== "organizations" && orgId) {
    const o = await supabase.from("organizations").select("name").eq("id", orgId).is("deleted_at", null).maybeSingle();
    if (!o.error && o.data) orgName = (o.data as { name: string }).name;
  }

  const [templates, mailboxes, canEdit] = await Promise.all([
    getCompanyTemplates(record.company_id),
    getSendableMailboxes(profile.id, record.company_id),
    supabase.rpc("can_edit_record", { p_entity: entity, p_record_id: recordId }),
  ]);
  const to = person ? firstPersonEmail(person.emails) : null;
  return {
    companyId: record.company_id,
    canEdit: canEdit.data === true,
    suggestedTo: to ? [to] : [],
    vars: buildTemplateVars({
      personName: person?.full_name,
      organizationName: orgName,
      dealTitle: entity === "deals" ? record.title : null,
      userName: profile.fullName,
    }),
    templates,
    mailboxes,
  };
}
