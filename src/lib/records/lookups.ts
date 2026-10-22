import "server-only";
import { createServerClient } from "@/lib/supabase/server";
import type { CustomFieldDef, CustomFieldEntity, LabelColor, CustomFieldType } from "@/lib/custom-fields/schema";

export type CompanyLabel = { id: string; name: string; color: LabelColor };

export async function listCompanyLabels(companyId: string): Promise<CompanyLabel[]> {
  const supabase = await createServerClient();
  const { data } = await supabase.from("labels").select("id, name, color").eq("company_id", companyId).order("name");
  return (data ?? []).map((l) => ({ id: l.id, name: l.name, color: l.color as LabelColor }));
}

/** Somente definições ativas (arquivadas não aparecem nem são editadas). */
export async function listActiveCustomFieldDefs(
  companyId: string,
  entity: CustomFieldEntity,
): Promise<CustomFieldDef[]> {
  const supabase = await createServerClient();
  const { data } = await supabase
    .from("custom_field_defs")
    .select("key, label, type, options")
    .eq("company_id", companyId)
    .eq("entity", entity)
    .is("archived_at", null)
    .order("position")
    .order("label");
  return (data ?? []).map((d) => ({
    key: d.key,
    label: d.label,
    type: d.type as CustomFieldType,
    options: Array.isArray(d.options) ? (d.options as string[]) : [],
  }));
}
