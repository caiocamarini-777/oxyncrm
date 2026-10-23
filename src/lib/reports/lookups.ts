import "server-only";
import { listAssignableOwners } from "@/lib/records/owners";
import { listActiveCustomFieldDefs } from "@/lib/records/lookups";
import { createServerClient } from "@/lib/supabase/server";
import { getAccessibleCompanies } from "@/lib/companies/scope";
import { scopeCompanyIds } from "./permissions";

export type Option = { value: string; label: string };

/** Opções de filtro e agrupamento da tela de relatórios, por chave de campo do catálogo. */
export type ReportLookups = {
  fields: Record<string, Option[]>;
  /** Campos personalizados de seleção (agrupamento), só quando o escopo é uma empresa. */
  customGroups: { base: "leads" | "deals"; key: string; label: string }[];
};

const TABLES: { key: string; table: string }[] = [
  { key: "pipeline", table: "pipelines" },
  { key: "source", table: "lead_sources" },
  { key: "lost_reason", table: "lost_reasons" },
  { key: "type", table: "activity_types" },
  { key: "channel", table: "activity_channels" },
  { key: "outcome", table: "activity_outcomes" },
  { key: "label", table: "labels" },
];

/** Catálogos das empresas do escopo (o RLS já limita ao que o usuário vê). Nomes repetidos levam a empresa. */
export async function getReportLookups(scopeSlug: string): Promise<ReportLookups> {
  const [ids, companies] = await Promise.all([scopeCompanyIds(scopeSlug), getAccessibleCompanies()]);
  const inScope = companies.filter((c) => ids.includes(c.id));
  const multi = inScope.length > 1;
  const companyName = new Map(inScope.map((c) => [c.id, c.name]));
  const supabase = await createServerClient();
  const withCompany = (name: string, companyId: string) => (multi ? `${name} (${companyName.get(companyId) ?? ""})` : name);

  const fields: Record<string, Option[]> = {
    company: inScope.map((c) => ({ value: c.id, label: c.name })),
  };

  const [teams, owners, stages, tables] = await Promise.all([
    supabase.from("teams").select("id, name").order("name"),
    Promise.all(inScope.map((c) => listAssignableOwners(c.id))),
    supabase
      .from("stages")
      .select("id, name, company_id, position, pipelines(name)")
      .in("company_id", ids)
      .is("archived_at", null)
      .order("position"),
    Promise.all(
      TABLES.map(async ({ key, table }) => {
        const { data } = await supabase.from(table).select("id, name, company_id").in("company_id", ids).order("name");
        return [key, (data ?? []).map((r) => ({ value: r.id as string, label: withCompany(r.name as string, r.company_id as string) }))] as const;
      }),
    ),
  ]);

  fields.team = (teams.data ?? []).map((t) => ({ value: t.id, label: t.name }));
  const seen = new Set<string>();
  fields.owner = owners
    .flat()
    .filter((o) => (seen.has(o.id) ? false : (seen.add(o.id), true)))
    .map((o) => ({ value: o.id, label: o.fullName }));
  const stageOptions = (stages.data ?? []).map((s) => {
    const pipeline = (s.pipelines as unknown as { name: string } | null)?.name;
    const base = pipeline ? `${pipeline}: ${s.name as string}` : (s.name as string);
    return { value: s.id as string, label: withCompany(base, s.company_id as string) };
  });
  fields.stage = stageOptions;
  fields.from_stage = stageOptions;
  fields.to_stage = stageOptions;
  for (const [key, opts] of tables) fields[key] = opts;

  const customGroups: ReportLookups["customGroups"] = [];
  if (inScope.length === 1) {
    for (const base of ["leads", "deals"] as const) {
      const defs = await listActiveCustomFieldDefs(inScope[0]!.id, base);
      for (const d of defs) if (d.type === "select") customGroups.push({ base, key: d.key, label: d.label });
    }
  }
  return { fields, customGroups };
}
