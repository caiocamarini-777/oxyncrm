import { CompaniesTable, type CompanyListItem } from "@/components/settings/companies-table";
import { requireSuperAdmin } from "@/lib/auth/session";
import { createServerClient } from "@/lib/supabase/server";

export const instant = false;

export default async function CompaniesSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ novo?: string }>;
}) {
  await requireSuperAdmin();
  const { novo } = await searchParams;
  const supabase = await createServerClient();
  const [{ data: companies }, { data: memberships }] = await Promise.all([
    supabase
      .from("companies")
      .select("id, name, slug, legal_name, cnpj, archived_at, finance_enabled")
      .order("name"),
    supabase.from("memberships").select("company_id"),
  ]);
  const counts = new Map<string, number>();
  for (const m of memberships ?? []) {
    counts.set(m.company_id, (counts.get(m.company_id) ?? 0) + 1);
  }
  const items: CompanyListItem[] = (companies ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    slug: c.slug,
    legalName: c.legal_name,
    cnpj: c.cnpj,
    archived: c.archived_at !== null,
    financeEnabled: c.finance_enabled,
    members: counts.get(c.id) ?? 0,
  }));
  return <CompaniesTable companies={items} openNew={novo === "1"} />;
}
