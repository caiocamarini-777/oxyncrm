import "server-only";
import { fail } from "@/lib/records/list-helpers";
import { createServerClient } from "@/lib/supabase/server";
import type { CARD_VALUE_FIELDS, NEXT_ACTIVITY_RULES } from "./schema";

export type StageRow = {
  id: string;
  name: string;
  probability: number;
  rottingDays: number | null;
  requiredFields: string[];
  archived: boolean;
};

export type PipelineRow = {
  id: string;
  name: string;
  nextActivityRule: (typeof NEXT_ACTIVITY_RULES)[number];
  cardValueField: (typeof CARD_VALUE_FIELDS)[number];
  archived: boolean;
  stages: StageRow[];
};

export async function listPipelinesWithStages(companyId: string): Promise<PipelineRow[]> {
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("pipelines")
    .select(
      "id, name, next_activity_rule, card_value_field, archived_at, stages(id, name, probability, rotting_days, required_fields, position, archived_at)",
    )
    .eq("company_id", companyId)
    .order("position")
    .order("name");
  if (error) fail("configurações", "funis", error);
  return (data ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    nextActivityRule: p.next_activity_rule as PipelineRow["nextActivityRule"],
    cardValueField: p.card_value_field as PipelineRow["cardValueField"],
    archived: p.archived_at !== null,
    stages: [...(p.stages ?? [])]
      .sort((a, b) => a.position - b.position)
      .map((s) => ({
        id: s.id,
        name: s.name,
        probability: s.probability,
        rottingDays: s.rotting_days,
        requiredFields: s.required_fields,
        archived: s.archived_at !== null,
      })),
  }));
}

export type PipelineDirectoryEntry = { id: string; name: string; companyId: string; companyName: string; companySlug: string };

/** Funis ativos de várias empresas (para trocar de funil e de empresa no mesmo seletor). */
export async function listPipelineDirectory(companies: { id: string; name: string; slug: string }[]): Promise<PipelineDirectoryEntry[]> {
  if (companies.length === 0) return [];
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("pipelines")
    .select("id, name, company_id")
    .in("company_id", companies.map((c) => c.id))
    .is("archived_at", null)
    .order("position")
    .order("name");
  if (error) fail("deals", "funis", error);
  const byId = new Map(companies.map((c) => [c.id, c]));
  return (data ?? [])
    .filter((p) => byId.has(p.company_id))
    .map((p) => {
      const c = byId.get(p.company_id)!;
      return { id: p.id, name: p.name, companyId: c.id, companyName: c.name, companySlug: c.slug };
    })
    .sort((a, b) => a.companyName.localeCompare(b.companyName, "pt-BR"));
}
