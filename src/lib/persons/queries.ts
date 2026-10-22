import "server-only";
import { createServerClient } from "@/lib/supabase/server";
import type { CompanyScope } from "@/lib/companies/pure";
import type { LabelColor } from "@/lib/custom-fields/schema";
import { PAGE_SIZE, type ListQuery, type Paged } from "@/lib/records/types";
import type { ContactEntry } from "./schema";

export const PERSON_SORTS = ["full_name", "job_title", "created_at"];

export type PersonLabel = { id: string; name: string; color: LabelColor };

export type PersonRow = {
  id: string;
  companyId: string;
  companySlug: string;
  companyName: string;
  fullName: string;
  jobTitle: string | null;
  /** Só quando o usuário consegue ler a organização. */
  organization: { id: string; name: string } | null;
  primaryEmail: string | null;
  primaryPhone: string | null;
  ownerId: string;
  ownerName: string;
  labels: PersonLabel[];
  createdAt: string;
};

export type PersonOrganization =
  | { state: "ok"; id: string; name: string }
  | { state: "no_access"; name: string | null }
  | { state: "trashed"; name: string };

export type PersonDetail = {
  id: string;
  companyId: string;
  companySlug: string;
  companyName: string;
  fullName: string;
  jobTitle: string | null;
  organizationId: string | null;
  organization: PersonOrganization | null;
  emails: ContactEntry[];
  phones: ContactEntry[];
  linkedinUrl: string | null;
  ownerId: string;
  customFields: Record<string, unknown>;
  createdAt: string;
  labelIds: string[];
};

const LIST_SELECT =
  "id, company_id, full_name, job_title, emails, phones, owner_id, created_at, company:companies(name, slug), owner:profiles!owner_id(full_name), organization:organizations(id, name, deleted_at)";

type Rel<T> = T | T[] | null;
type RawRow = {
  id: string;
  company_id: string;
  full_name: string;
  job_title: string | null;
  emails: ContactEntry[] | null;
  phones: ContactEntry[] | null;
  owner_id: string;
  created_at: string;
  company: Rel<{ name: string; slug: string }>;
  owner: Rel<{ full_name: string }>;
  organization: Rel<{ id: string; name: string; deleted_at: string | null }>;
};

function one<T>(v: Rel<T>): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

/** Registra no servidor e interrompe: falha de consulta não pode virar "sem resultados". */
function fail(what: string, error: { message: string; code?: string }): never {
  console.error(`[persons] ${what}:`, error.code, error.message);
  throw new Error(`Falha ao carregar pessoas (${what}).`);
}

function safeTerm(q: string): string {
  return q.replace(/[,()*%\\"]/g, " ").replace(/\s+/g, " ").trim();
}
const startOfDay = (d: string) => `${d}T00:00:00-03:00`;
const endOfDay = (d: string) => `${d}T23:59:59.999-03:00`;

async function idsByLabels(labels: string[]): Promise<string[] | null> {
  if (labels.length === 0) return null;
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("record_labels")
    .select("record_id")
    .eq("entity", "persons")
    .in("label_id", labels);
  if (error) fail("filtro de etiquetas", error);
  return [...new Set((data ?? []).map((r) => r.record_id as string))];
}

export async function fetchPersonRows(
  scope: CompanyScope,
  query: ListQuery,
  range: { from: number; to: number },
  companyIds?: string[],
): Promise<{ rows: PersonRow[]; total: number }> {
  const labelIds = await idsByLabels(query.label);
  if (labelIds && labelIds.length === 0) return { rows: [], total: 0 };

  const supabase = await createServerClient();
  let q = supabase.from("persons").select(LIST_SELECT, { count: "exact" }).is("deleted_at", null);
  if (scope.kind === "company") q = q.eq("company_id", scope.company.id);
  if (companyIds) q = q.in("company_id", companyIds);
  if (query.owner.length > 0) q = q.in("owner_id", query.owner);
  if (labelIds) q = q.in("id", labelIds);
  if (query.createdFrom) q = q.gte("created_at", startOfDay(query.createdFrom));
  if (query.createdTo) q = q.lte("created_at", endOfDay(query.createdTo));
  const term = safeTerm(query.q);
  if (term) q = q.or([`full_name.ilike.%${term}%`, `job_title.ilike.%${term}%`].join(","));
  const sort = PERSON_SORTS.includes(query.sort) ? query.sort : "created_at";
  q = q.order(sort, { ascending: query.dir === "asc", nullsFirst: false }).order("id");
  const { data, count, error } = await q.range(range.from, range.to);
  if (error?.code === "PGRST103") return { rows: [], total: 0 };
  if (error) fail("lista", error);

  const raw = (data ?? []) as unknown as RawRow[];
  const ids = raw.map((r) => r.id);
  const labelsBy = new Map<string, PersonLabel[]>();
  if (ids.length > 0) {
    const links = await supabase
      .from("record_labels")
      .select("record_id, label:labels(id, name, color)")
      .eq("entity", "persons")
      .in("record_id", ids);
    if (links.error) fail("etiquetas", links.error);
    for (const l of (links.data ?? []) as unknown as { record_id: string; label: Rel<PersonLabel> }[]) {
      const label = one(l.label);
      if (!label) continue;
      labelsBy.set(l.record_id, [...(labelsBy.get(l.record_id) ?? []), label]);
    }
  }

  const rows: PersonRow[] = raw.map((r) => {
    const org = one(r.organization);
    return {
      id: r.id,
      companyId: r.company_id,
      companySlug: one(r.company)?.slug ?? "",
      companyName: one(r.company)?.name ?? "",
      fullName: r.full_name,
      jobTitle: r.job_title,
      organization: org && !org.deleted_at ? { id: org.id, name: org.name } : null,
      primaryEmail: r.emails?.[0]?.value ?? null,
      primaryPhone: r.phones?.[0]?.value ?? null,
      ownerId: r.owner_id,
      ownerName: one(r.owner)?.full_name ?? "",
      labels: (labelsBy.get(r.id) ?? []).sort((a, b) => a.name.localeCompare(b.name, "pt-BR")),
      createdAt: r.created_at,
    };
  });
  return { rows, total: count ?? 0 };
}

export async function listPersons(scope: CompanyScope, query: ListQuery): Promise<Paged<PersonRow>> {
  const from = (query.page - 1) * PAGE_SIZE;
  const { rows, total } = await fetchPersonRows(scope, query, { from, to: from + PAGE_SIZE - 1 });
  return { rows, total, page: query.page, pageSize: PAGE_SIZE };
}

async function resolveOrganization(orgId: string | null): Promise<PersonOrganization | null> {
  if (!orgId) return null;
  const supabase = await createServerClient();
  const readable = await supabase
    .from("organizations")
    .select("id, name")
    .eq("id", orgId)
    .is("deleted_at", null)
    .maybeSingle();
  if (readable.error) fail("organização vinculada", readable.error);
  if (readable.data) return { state: "ok", id: readable.data.id, name: readable.data.name };
  // Sem leitura (ou na lixeira): só o nome e o estado, via função security definer.
  const label = await supabase.rpc("organization_label", { p_id: orgId });
  if (label.error) fail("nome da organização", label.error);
  const row = ((label.data ?? []) as { name: string; trashed: boolean }[])[0];
  if (!row) return { state: "no_access", name: null };
  return row.trashed ? { state: "trashed", name: row.name } : { state: "no_access", name: row.name };
}

export async function getPerson(id: string): Promise<PersonDetail | null> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return null;
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("persons")
    .select(
      "id, company_id, full_name, job_title, organization_id, emails, phones, linkedin_url, owner_id, custom_fields, created_at, company:companies(name, slug)",
    )
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) fail("detalhe", error);
  if (!data) return null;
  const [labels, organization] = await Promise.all([
    supabase.from("record_labels").select("label_id").eq("entity", "persons").eq("record_id", id),
    resolveOrganization(data.organization_id),
  ]);
  if (labels.error) fail("etiquetas do detalhe", labels.error);
  const company = one(data.company as Rel<{ name: string; slug: string }>);
  return {
    id: data.id,
    companyId: data.company_id,
    companySlug: company?.slug ?? "",
    companyName: company?.name ?? "",
    fullName: data.full_name,
    jobTitle: data.job_title,
    organizationId: data.organization_id,
    organization,
    emails: (data.emails ?? []) as ContactEntry[],
    phones: (data.phones ?? []) as ContactEntry[],
    linkedinUrl: data.linkedin_url,
    ownerId: data.owner_id,
    customFields: (data.custom_fields ?? {}) as Record<string, unknown>,
    createdAt: data.created_at,
    labelIds: (labels.data ?? []).map((l) => l.label_id as string),
  };
}
