"use server";

import { getCurrentProfile } from "@/lib/auth/session";
import type { CompanyScope } from "@/lib/companies/pure";
import { getAccessibleCompanies } from "@/lib/companies/scope";
import { RECORD_ENTITIES, recordHref, type RecordEntity } from "@/lib/records/types";
import { createServerClient } from "@/lib/supabase/server";

export type SearchResult = {
  entity: RecordEntity;
  id: string;
  title: string;
  subtitle: string | null;
  href: string;
};

const PER_ENTITY = 5;

/** Busca registros (até 5 por tipo) via `global_search`; o RLS limita ao que o usuário enxerga. */
export async function searchRecords(query: string, scope: CompanyScope): Promise<SearchResult[]> {
  const q = typeof query === "string" ? query.trim() : "";
  if (q.length < 2 || q.length > 100) return [];
  const profile = await getCurrentProfile();
  if (!profile) return [];
  const companies = await getAccessibleCompanies();

  let companyId: string | null = null;
  if (scope?.kind === "company") {
    const match = companies.find((c) => c.id === scope.company.id);
    if (!match) return [];
    companyId = match.id;
  }

  const supabase = await createServerClient();
  const { data, error } = await supabase.rpc("global_search", {
    p_query: q,
    p_company: companyId,
    p_limit: PER_ENTITY,
  });
  if (error) {
    console.error("[busca] global_search:", error.code, error.message);
    return [];
  }
  const slugs = new Map(companies.map((c) => [c.id, c.slug]));
  const out: SearchResult[] = [];
  for (const r of (data ?? []) as {
    entity: string;
    record_id: string;
    company_id: string;
    title: string;
    subtitle: string | null;
  }[]) {
    const slug = slugs.get(r.company_id);
    if (!slug || !(RECORD_ENTITIES as readonly string[]).includes(r.entity)) continue;
    const entity = r.entity as RecordEntity;
    out.push({
      entity,
      id: r.record_id,
      title: r.title,
      subtitle: r.subtitle,
      href: recordHref(entity, slug, r.record_id),
    });
  }
  return out;
}
