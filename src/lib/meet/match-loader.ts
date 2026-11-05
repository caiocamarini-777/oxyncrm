import type { SupabaseClient } from "@supabase/supabase-js";
import { type Candidate, type MeetingActivity, normalizeEmail } from "./match";

const PAGE = 1000; // o PostgREST devolve no máximo 1.000 linhas por consulta
const CHUNK = 100; // ids por consulta `in (...)`, para a URL não estourar
const MAX_EMAILS = 20; // teto de convidados externos consultados por reunião

type Rows = PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>;

/** Lê todas as páginas de uma consulta (`.range`), numa ordem estável. */
async function fetchAll<T>(label: string, page: (from: number, to: number) => Rows): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) throw new Error(`Falha ao carregar ${label}: ${error.message}`);
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

function chunks<T>(list: T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/**
 * Domínios de e-mail gratuito: nunca contam como internos. Um perfil com `@gmail.com` faria todo convidado
 * do Gmail virar interno, e a reunião com cliente seria ignorada.
 */
export const FREE_EMAIL_DOMAINS: ReadonlySet<string> = new Set([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "yahoo.com",
  "yahoo.com.br",
  "icloud.com",
  "bol.com.br",
  "uol.com.br",
]);

/** Domínios (minúsculos) de uma lista de e-mails de perfil, sem os de e-mail gratuito. */
export function internalDomainsFrom(emails: (string | null)[]): Set<string> {
  const domains = new Set<string>();
  for (const raw of emails) {
    const email = raw ? normalizeEmail(raw) : "";
    const at = email.lastIndexOf("@");
    if (at < 0 || at === email.length - 1) continue;
    const domain = email.slice(at + 1);
    if (!FREE_EMAIL_DOMAINS.has(domain)) domains.add(domain);
  }
  return domains;
}

/** Domínios (minúsculos) dos e-mails de `profiles`: quem tem perfil no CRM é "interno" (exceto e-mail gratuito). */
export async function loadInternalDomains(db: SupabaseClient): Promise<Set<string>> {
  const rows = await fetchAll<{ email: string | null }>("perfis", (a, b) =>
    db.from("profiles").select("email").order("id").range(a, b),
  );
  return internalDomainsFrom(rows.map((r) => r.email));
}

type PersonRow = { id: string; organization_id: string | null };
type DealRow = { id: string; person_id: string | null; organization_id: string | null };
type LeadRow = { id: string; person_id: string | null; organization_id: string | null };
type ActivityRow = {
  id: string;
  deal_id: string | null;
  lead_id: string | null;
  person_id: string | null;
  due_at: string;
};

/**
 * Filtro `or` do PostgREST: registros da pessoa ou da organização dela. Os ids são uuids que
 * vieram do próprio banco, então entram direto no texto do filtro.
 */
function ownerFilter(personIds: string[], orgIds: string[]): string {
  const parts: string[] = [];
  if (personIds.length > 0) parts.push(`person_id.in.(${personIds.join(",")})`);
  if (orgIds.length > 0) parts.push(`organization_id.in.(${orgIds.join(",")})`);
  return parts.join(",");
}

/**
 * Candidatos de vínculo de uma reunião: uma entrada por pessoa da empresa (não apagada) cujo
 * `persons.emails` contém algum dos e-mails (comparação em minúsculas, como o trigger
 * `normalize_person_contacts` grava). Cada candidato traz os negócios e leads abertos da pessoa
 * ou da organização dela e as reuniões agendadas (atividade de tipo reunião, não concluída)
 * desses registros, com o id do Pipedrive. Chamado pelo cron com o cliente admin.
 *
 * `lastActivityAt` do negócio: a atividade mais recente que já aconteceu, entre as não apagadas
 * do negócio, de qualquer tipo. Vale `completed_at` se concluída, senão `due_at`; datas futuras
 * (agendadas) não contam, porque ainda não aconteceram.
 */
export async function loadCandidates(db: SupabaseClient, companyId: string, emails: string[]): Promise<Candidate[]> {
  const lowered = [...new Set(emails.map(normalizeEmail).filter(Boolean))].slice(0, MAX_EMAILS);
  if (lowered.length === 0) return [];

  // 1. Pessoas da empresa com algum desses e-mails (índice GIN `persons_emails_gin`).
  const personLists = await Promise.all(
    lowered.map(async (email) => {
      const { data, error } = await db
        .from("persons")
        .select("id, organization_id")
        .eq("company_id", companyId)
        .is("deleted_at", null)
        .contains("emails", JSON.stringify([{ value: email }]))
        .limit(50);
      if (error) throw new Error(`Falha ao buscar pessoas por e-mail: ${error.message}`);
      return (data ?? []) as PersonRow[];
    }),
  );
  const personsById = new Map<string, PersonRow>();
  for (const list of personLists) for (const p of list) personsById.set(p.id, p);
  const persons = [...personsById.values()];
  if (persons.length === 0) return [];

  const personIds = persons.map((p) => p.id);
  const orgIds = [...new Set(persons.map((p) => p.organization_id).filter((x): x is string => !!x))];

  // 2. Negócios e leads abertos da pessoa ou da organização.
  const filter = ownerFilter(personIds, orgIds);
  const [deals, leads] = await Promise.all([
    fetchAll<DealRow>("negócios", (a, b) =>
      db
        .from("deals")
        .select("id, person_id, organization_id")
        .eq("company_id", companyId)
        .is("deleted_at", null)
        .eq("status", "open")
        .or(filter)
        .order("id")
        .range(a, b),
    ),
    fetchAll<LeadRow>("leads", (a, b) =>
      db
        .from("leads")
        .select("id, person_id, organization_id")
        .eq("company_id", companyId)
        .is("deleted_at", null)
        .eq("status", "open")
        .or(filter)
        .order("id")
        .range(a, b),
    ),
  ]);
  const dealIds = deals.map((d) => d.id);
  const leadIds = leads.map((l) => l.id);

  // 3. Reuniões agendadas: tipo com `is_meeting`, não concluídas, não apagadas.
  const activityFilter = [
    personIds.length > 0 ? `person_id.in.(${personIds.join(",")})` : "",
    dealIds.length > 0 ? `deal_id.in.(${dealIds.join(",")})` : "",
    leadIds.length > 0 ? `lead_id.in.(${leadIds.join(",")})` : "",
  ]
    .filter(Boolean)
    .join(",");
  const meetings = await fetchAll<ActivityRow>("reuniões agendadas", (a, b) =>
    db
      .from("activities")
      .select("id, deal_id, lead_id, person_id, due_at, activity_types!inner(is_meeting)")
      .eq("company_id", companyId)
      .eq("activity_types.is_meeting", true)
      .eq("done", false)
      .is("deleted_at", null)
      .or(activityFilter)
      .order("id")
      .range(a, b),
  );

  // 4. Id do Pipedrive de cada reunião.
  const pipedriveByActivity = new Map<string, string>();
  for (const part of chunks(meetings.map((m) => m.id))) {
    const rows = await fetchAll<{ external_id: string; record_id: string }>("ids do Pipedrive", (a, b) =>
      db
        .from("external_ids")
        .select("external_id, record_id")
        .eq("company_id", companyId)
        .eq("source", "pipedrive")
        .eq("entity", "activities")
        .in("record_id", part)
        .order("external_id")
        .range(a, b),
    );
    for (const r of rows) pipedriveByActivity.set(r.record_id, r.external_id);
  }

  // 5. Última atividade de cada negócio (já aconteceu; ver a regra no comentário da função).
  const now = Date.now();
  const lastByDeal = new Map<string, number>();
  for (const part of chunks(dealIds)) {
    const rows = await fetchAll<{ deal_id: string; due_at: string; completed_at: string | null }>(
      "atividades dos negócios",
      (a, b) =>
        db
          .from("activities")
          .select("deal_id, due_at, completed_at")
          .eq("company_id", companyId)
          .is("deleted_at", null)
          .in("deal_id", part)
          .order("id")
          .range(a, b),
    );
    for (const r of rows) {
      const t = new Date(r.completed_at ?? r.due_at).getTime();
      if (Number.isNaN(t) || t > now) continue;
      if (t > (lastByDeal.get(r.deal_id) ?? -Infinity)) lastByDeal.set(r.deal_id, t);
    }
  }

  const meetingActivities: MeetingActivity[] = meetings.map((m) => ({
    id: m.id,
    dealId: m.deal_id,
    leadId: m.lead_id,
    personId: m.person_id,
    dueAt: m.due_at,
    pipedriveId: pipedriveByActivity.get(m.id) ?? null,
  }));

  // 6. Um candidato por pessoa, com os registros dela ou da organização dela.
  return persons.map((p) => {
    const mine = (r: { person_id: string | null; organization_id: string | null }) =>
      r.person_id === p.id || (!!p.organization_id && r.organization_id === p.organization_id);
    const myDeals = deals.filter(mine);
    const myLeads = leads.filter(mine);
    const myDealIds = new Set(myDeals.map((d) => d.id));
    const myLeadIds = new Set(myLeads.map((l) => l.id));
    return {
      person: { id: p.id, organizationId: p.organization_id },
      deals: myDeals.map((d) => ({
        id: d.id,
        personId: d.person_id,
        organizationId: d.organization_id,
        lastActivityAt: lastByDeal.has(d.id) ? new Date(lastByDeal.get(d.id)!).toISOString() : null,
      })),
      leads: myLeads.map((l) => ({ id: l.id, personId: l.person_id, organizationId: l.organization_id })),
      meetingActivities: meetingActivities.filter(
        (a) =>
          (a.dealId && myDealIds.has(a.dealId)) || (a.leadId && myLeadIds.has(a.leadId)) || a.personId === p.id,
      ),
    };
  });
}
