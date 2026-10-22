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
} from "@/lib/records/list-helpers";
import { PAGE_SIZE, type ListQuery, type Paged } from "@/lib/records/types";

const fail = (what: string, error: { message: string; code?: string }) => failFor("organizations", what, error);

export const ORGANIZATION_SORTS = ["name", "cnpj", "domain", "segment", "created_at"];

export type OrganizationLabel = LabelRef;

export type OrganizationRow = {
  id: string;
  companyId: string;
  companySlug: string;
  companyName: string;
  name: string;
  cnpj: string | null;
  domain: string | null;
  segment: string | null;
  ownerId: string;
  ownerName: string;
  personsCount: number;
  labels: OrganizationLabel[];
  createdAt: string;
};

export type OrganizationAddress = {
  street?: string;
  number?: string;
  city?: string;
  state?: string;
  zip?: string;
};

export type OrganizationDetail = {
  id: string;
  companyId: string;
  companySlug: string;
  companyName: string;
  name: string;
  legalName: string | null;
  cnpj: string | null;
  domain: string | null;
  segment: string | null;
  address: OrganizationAddress;
  ownerId: string;
  customFields: Record<string, unknown>;
  createdAt: string;
  labelIds: string[];
  persons: { id: string; fullName: string; jobTitle: string | null }[];
};

const LIST_SELECT =
  "id, company_id, name, cnpj, domain, segment, owner_id, created_at, company:companies(name, slug), owner:profiles!owner_id(full_name)";

type RawRow = {
  id: string;
  company_id: string;
  name: string;
  cnpj: string | null;
  domain: string | null;
  segment: string | null;
  owner_id: string;
  created_at: string;
  company: { name: string; slug: string } | null;
  owner: { full_name: string } | null;
};

/**
 * Linhas da lista conforme os filtros. `companyIds` (se informado) restringe as empresas
 * (usado pela exportação); o RLS continua valendo.
 */
export async function fetchOrganizationRows(
  scope: CompanyScope,
  query: ListQuery,
  range: { from: number; to: number },
  companyIds?: string[],
): Promise<{ rows: OrganizationRow[]; total: number }> {
  const labelIds = await idsByLabelsFor("organizations", query.label);
  if (labelIds && labelIds.length === 0) return { rows: [], total: 0 };

  const supabase = await createServerClient();
  let q = supabase
    .from("organizations")
    .select(LIST_SELECT, { count: "exact" })
    .is("deleted_at", null);
  if (scope.kind === "company") q = q.eq("company_id", scope.company.id);
  if (companyIds) q = q.in("company_id", companyIds);
  if (query.owner.length > 0) q = q.in("owner_id", query.owner);
  if (labelIds) q = q.in("id", labelIds);
  if (query.createdFrom) q = q.gte("created_at", startOfDay(query.createdFrom));
  if (query.createdTo) q = q.lte("created_at", endOfDay(query.createdTo));
  const term = safeTerm(query.q);
  if (term) {
    const digits = term.replace(/\D/g, "");
    const parts = [`name.ilike.%${term}%`, `domain.ilike.%${term}%`, `legal_name.ilike.%${term}%`];
    if (digits) parts.push(`cnpj.ilike.%${digits}%`);
    q = q.or(parts.join(","));
  }
  const sort = ORGANIZATION_SORTS.includes(query.sort) ? query.sort : "created_at";
  q = q.order(sort, { ascending: query.dir === "asc", nullsFirst: false }).order("id");
  const { data, count, error } = await q.range(range.from, range.to);
  // PGRST103: página além do fim; é lista vazia, não falha.
  if (error?.code === "PGRST103") return { rows: [], total: 0 };
  if (error) fail("lista", error);

  const raw = (data ?? []) as unknown as RawRow[];
  const ids = raw.map((r) => r.id);
  const counts = new Map<string, number>();
  let labelsBy = new Map<string, OrganizationLabel[]>();
  if (ids.length > 0) {
    const [persons, labels] = await Promise.all([
      supabase.from("persons").select("organization_id").in("organization_id", ids).is("deleted_at", null),
      loadRecordLabels("organizations", ids),
    ]);
    if (persons.error) fail("pessoas vinculadas", persons.error);
    labelsBy = labels;
    for (const p of persons.data ?? []) {
      const id = p.organization_id as string;
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  }

  const rows = raw.map((r) => ({
    id: r.id,
    companyId: r.company_id,
    companySlug: one(r.company)?.slug ?? "",
    companyName: one(r.company)?.name ?? "",
    name: r.name,
    cnpj: r.cnpj,
    domain: r.domain,
    segment: r.segment,
    ownerId: r.owner_id,
    ownerName: one(r.owner)?.full_name ?? "",
    personsCount: counts.get(r.id) ?? 0,
    labels: labelsBy.get(r.id) ?? [],
    createdAt: r.created_at,
  }));
  return { rows, total: count ?? 0 };
}

export async function listOrganizations(
  scope: CompanyScope,
  query: ListQuery,
): Promise<Paged<OrganizationRow>> {
  const from = (query.page - 1) * PAGE_SIZE;
  const { rows, total } = await fetchOrganizationRows(scope, query, { from, to: from + PAGE_SIZE - 1 });
  return { rows, total, page: query.page, pageSize: PAGE_SIZE };
}

export async function getOrganization(id: string): Promise<OrganizationDetail | null> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return null;
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("organizations")
    .select(
      "id, company_id, name, legal_name, cnpj, domain, segment, address, owner_id, custom_fields, created_at, company:companies(name, slug)",
    )
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) fail("detalhe", error);
  if (!data) return null;
  const [labels, persons] = await Promise.all([
    supabase.from("record_labels").select("label_id").eq("entity", "organizations").eq("record_id", id),
    supabase
      .from("persons")
      .select("id, full_name, job_title")
      .eq("organization_id", id)
      .is("deleted_at", null)
      .order("full_name"),
  ]);
  if (labels.error) fail("etiquetas do detalhe", labels.error);
  if (persons.error) fail("pessoas do detalhe", persons.error);
  const company = one(data.company as { name: string; slug: string } | { name: string; slug: string }[] | null);
  return {
    id: data.id,
    companyId: data.company_id,
    companySlug: company?.slug ?? "",
    companyName: company?.name ?? "",
    name: data.name,
    legalName: data.legal_name,
    cnpj: data.cnpj,
    domain: data.domain,
    segment: data.segment,
    address: (data.address ?? {}) as OrganizationAddress,
    ownerId: data.owner_id,
    customFields: (data.custom_fields ?? {}) as Record<string, unknown>,
    createdAt: data.created_at,
    labelIds: (labels.data ?? []).map((l) => l.label_id as string),
    persons: (persons.data ?? []).map((p) => ({ id: p.id, fullName: p.full_name, jobTitle: p.job_title })),
  };
}
