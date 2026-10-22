import "server-only";
import { createServerClient } from "@/lib/supabase/server";
import type { CompanyScope } from "@/lib/companies/pure";
import {
  endOfDay,
  fail as failFor,
  idsByLabels as idsByLabelsFor,
  loadRecordLabels,
  one,
  safeTerm,
  startOfDay,
  type LabelRef,
  type Rel,
} from "@/lib/records/list-helpers";
import { PAGE_SIZE, type ListQuery, type Paged } from "@/lib/records/types";
import { LEAD_STATUSES, type LeadStatus } from "./schema";

const fail = (what: string, error: { message: string; code?: string }) => failFor("leads", what, error);

export const LEAD_SORTS = ["title", "estimated_value", "created_at"];

/** Aba ativa: primeiro `status` válido da URL; padrão `open`. */
export function leadStatusOf(query: ListQuery): LeadStatus {
  const s = query.status.find((v): v is LeadStatus => (LEAD_STATUSES as readonly string[]).includes(v));
  return s ?? "open";
}

export type LeadRow = {
  id: string;
  companyId: string;
  companySlug: string;
  companyName: string;
  title: string;
  status: LeadStatus;
  /** Só quando o usuário consegue ler a pessoa/organização. */
  person: { id: string; name: string } | null;
  organization: { id: string; name: string } | null;
  sourceName: string | null;
  reasonName: string | null;
  estimatedValue: number | null;
  ownerId: string;
  ownerName: string;
  labels: LabelRef[];
  createdAt: string;
};

export type LeadLink =
  | { state: "ok"; id: string; name: string }
  | { state: "no_access" }
  | { state: "trashed"; name: string };

export type LeadDetail = {
  id: string;
  companyId: string;
  companySlug: string;
  companyName: string;
  title: string;
  status: LeadStatus | "converted";
  sourceId: string | null;
  sourceName: string | null;
  sourceActive: boolean;
  personId: string | null;
  person: LeadLink | null;
  organizationId: string | null;
  organization: LeadLink | null;
  estimatedValue: number | null;
  reasonName: string | null;
  disqualificationNote: string | null;
  ownerId: string;
  customFields: Record<string, unknown>;
  createdAt: string;
  labelIds: string[];
};

const LIST_SELECT =
  "id, company_id, title, status, estimated_value, owner_id, created_at, company:companies(name, slug), owner:profiles!owner_id(full_name), person:persons(id, full_name, deleted_at), organization:organizations(id, name, deleted_at), source:lead_sources(name), reason:disqualification_reasons(name)";

type RawRow = {
  id: string;
  company_id: string;
  title: string;
  status: LeadStatus;
  estimated_value: number | string | null;
  owner_id: string;
  created_at: string;
  company: Rel<{ name: string; slug: string }>;
  owner: Rel<{ full_name: string }>;
  person: Rel<{ id: string; full_name: string; deleted_at: string | null }>;
  organization: Rel<{ id: string; name: string; deleted_at: string | null }>;
  source: Rel<{ name: string }>;
  reason: Rel<{ name: string }>;
};

export async function fetchLeadRows(
  scope: CompanyScope,
  query: ListQuery,
  range: { from: number; to: number },
  companyIds?: string[],
): Promise<{ rows: LeadRow[]; total: number }> {
  const labelIds = await idsByLabelsFor("leads", query.label);
  if (labelIds && labelIds.length === 0) return { rows: [], total: 0 };

  const supabase = await createServerClient();
  let q = supabase
    .from("leads")
    .select(LIST_SELECT, { count: "exact" })
    .is("deleted_at", null)
    .eq("status", leadStatusOf(query));
  if (scope.kind === "company") q = q.eq("company_id", scope.company.id);
  if (companyIds) q = q.in("company_id", companyIds);
  if (query.owner.length > 0) q = q.in("owner_id", query.owner);
  if (query.source.length > 0) q = q.in("source_id", query.source);
  if (labelIds) q = q.in("id", labelIds);
  if (query.createdFrom) q = q.gte("created_at", startOfDay(query.createdFrom));
  if (query.createdTo) q = q.lte("created_at", endOfDay(query.createdTo));
  const term = safeTerm(query.q);
  if (term) q = q.ilike("title", `%${term}%`);
  const sort = LEAD_SORTS.includes(query.sort) ? query.sort : "created_at";
  q = q.order(sort, { ascending: query.dir === "asc", nullsFirst: false }).order("id");
  const { data, count, error } = await q.range(range.from, range.to);
  if (error?.code === "PGRST103") return { rows: [], total: 0 };
  if (error) fail("lista", error);

  const raw = (data ?? []) as unknown as RawRow[];
  const labelsBy = await loadRecordLabels("leads", raw.map((r) => r.id));
  const rows: LeadRow[] = raw.map((r) => {
    const person = one(r.person);
    const org = one(r.organization);
    return {
      id: r.id,
      companyId: r.company_id,
      companySlug: one(r.company)?.slug ?? "",
      companyName: one(r.company)?.name ?? "",
      title: r.title,
      status: r.status,
      person: person && !person.deleted_at ? { id: person.id, name: person.full_name } : null,
      organization: org && !org.deleted_at ? { id: org.id, name: org.name } : null,
      sourceName: one(r.source)?.name ?? null,
      reasonName: one(r.reason)?.name ?? null,
      estimatedValue: r.estimated_value === null ? null : Number(r.estimated_value),
      ownerId: r.owner_id,
      ownerName: one(r.owner)?.full_name ?? "",
      labels: labelsBy.get(r.id) ?? [],
      createdAt: r.created_at,
    };
  });
  return { rows, total: count ?? 0 };
}

export async function listLeads(scope: CompanyScope, query: ListQuery): Promise<Paged<LeadRow>> {
  const from = (query.page - 1) * PAGE_SIZE;
  const { rows, total } = await fetchLeadRows(scope, query, { from, to: from + PAGE_SIZE - 1 });
  return { rows, total, page: query.page, pageSize: PAGE_SIZE };
}

async function resolveLink(
  table: "persons" | "organizations",
  id: string | null,
  nameCol: "full_name" | "name",
): Promise<LeadLink | null> {
  if (!id) return null;
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from(table)
    .select(`id, ${nameCol}, deleted_at`)
    .eq("id", id)
    .maybeSingle();
  if (error) fail(table === "persons" ? "pessoa vinculada" : "organização vinculada", error);
  if (!data) return { state: "no_access" };
  const row = data as unknown as Record<string, string | null>;
  const name = String(row[nameCol] ?? "");
  return row.deleted_at ? { state: "trashed", name } : { state: "ok", id, name };
}

export async function getLead(id: string): Promise<LeadDetail | null> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return null;
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("leads")
    .select(
      "id, company_id, title, status, source_id, person_id, organization_id, estimated_value, disqualification_note, owner_id, custom_fields, created_at, company:companies(name, slug), source:lead_sources(name, active), reason:disqualification_reasons(name)",
    )
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) fail("detalhe", error);
  if (!data) return null;
  const [labels, person, organization] = await Promise.all([
    supabase.from("record_labels").select("label_id").eq("entity", "leads").eq("record_id", id),
    resolveLink("persons", data.person_id, "full_name"),
    resolveLink("organizations", data.organization_id, "name"),
  ]);
  if (labels.error) fail("etiquetas do detalhe", labels.error);
  const company = one(data.company as Rel<{ name: string; slug: string }>);
  const source = one(data.source as Rel<{ name: string; active: boolean }>);
  return {
    id: data.id,
    companyId: data.company_id,
    companySlug: company?.slug ?? "",
    companyName: company?.name ?? "",
    title: data.title,
    status: data.status as LeadDetail["status"],
    sourceId: data.source_id,
    sourceName: source?.name ?? null,
    sourceActive: source?.active ?? true,
    personId: data.person_id,
    person,
    organizationId: data.organization_id,
    organization,
    estimatedValue: data.estimated_value === null ? null : Number(data.estimated_value),
    reasonName: one(data.reason as Rel<{ name: string }>)?.name ?? null,
    disqualificationNote: data.disqualification_note,
    ownerId: data.owner_id,
    customFields: (data.custom_fields ?? {}) as Record<string, unknown>,
    createdAt: data.created_at,
    labelIds: (labels.data ?? []).map((l) => l.label_id as string),
  };
}

export type CompanyListItem = { id: string; name: string; active: boolean };

/** Origens da empresa (inclui inativas; quem monta o formulário filtra). */
export async function listLeadSources(companyId: string): Promise<CompanyListItem[]> {
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("lead_sources")
    .select("id, name, active")
    .eq("company_id", companyId)
    .order("position")
    .order("name");
  if (error) fail("origens", error);
  return (data ?? []).map((s) => ({ id: s.id, name: s.name, active: s.active }));
}

export async function listDisqualificationReasons(companyId: string): Promise<CompanyListItem[]> {
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("disqualification_reasons")
    .select("id, name, active")
    .eq("company_id", companyId)
    .eq("active", true)
    .order("position")
    .order("name");
  if (error) fail("motivos", error);
  return (data ?? []).map((s) => ({ id: s.id, name: s.name, active: s.active }));
}
