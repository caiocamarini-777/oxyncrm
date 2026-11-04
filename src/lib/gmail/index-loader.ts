import type { SupabaseClient } from "@supabase/supabase-js";
import type { ContactIndex } from "./matcher";

const PAGE = 1000; // o PostgREST devolve no máximo 1.000 linhas por consulta

/** Lê a tabela inteira em páginas (`.range`), numa ordem estável. */
async function fetchAll<T>(
  label: string,
  page: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) throw new Error(`Falha ao carregar ${label}: ${error.message}`);
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

/**
 * Índice de contatos de uma empresa para o casador: pessoas e organizações não apagadas,
 * leads e negócios abertos e não apagados. Carregado uma vez por conta a cada execução.
 */
export async function loadContactIndex(db: SupabaseClient, companyId: string): Promise<ContactIndex> {
  const [persons, orgs, leads, deals] = await Promise.all([
    fetchAll<{ id: string; organization_id: string | null; emails: unknown }>("pessoas", (a, b) =>
      db.from("persons").select("id, organization_id, emails").eq("company_id", companyId).is("deleted_at", null).order("id").range(a, b),
    ),
    fetchAll<{ id: string; domain: string | null }>("organizações", (a, b) =>
      db.from("organizations").select("id, domain").eq("company_id", companyId).is("deleted_at", null).not("domain", "is", null).order("id").range(a, b),
    ),
    fetchAll<{ id: string; person_id: string | null; organization_id: string | null }>("leads", (a, b) =>
      db.from("leads").select("id, person_id, organization_id").eq("company_id", companyId).is("deleted_at", null).eq("status", "open").order("id").range(a, b),
    ),
    fetchAll<{ id: string; person_id: string | null; organization_id: string | null }>("negócios", (a, b) =>
      db.from("deals").select("id, person_id, organization_id").eq("company_id", companyId).is("deleted_at", null).eq("status", "open").order("id").range(a, b),
    ),
  ]);

  const personsByEmail: ContactIndex["personsByEmail"] = new Map();
  for (const p of persons) {
    if (!Array.isArray(p.emails)) continue;
    for (const e of p.emails as { value?: unknown }[]) {
      const email = typeof e?.value === "string" ? e.value.trim().toLowerCase() : "";
      if (!email) continue;
      const list = personsByEmail.get(email) ?? [];
      if (!list.some((x) => x.id === p.id)) list.push({ id: p.id, organizationId: p.organization_id });
      personsByEmail.set(email, list);
    }
  }

  const orgsByDomain: ContactIndex["orgsByDomain"] = new Map();
  for (const o of orgs) {
    const domain = o.domain?.trim().toLowerCase();
    if (!domain) continue;
    orgsByDomain.set(domain, [...(orgsByDomain.get(domain) ?? []), o.id]);
  }

  const ref = (r: { id: string; person_id: string | null; organization_id: string | null }) => ({
    id: r.id,
    personId: r.person_id,
    organizationId: r.organization_id,
  });
  return { personsByEmail, orgsByDomain, openLeads: leads.map(ref), openDeals: deals.map(ref) };
}
