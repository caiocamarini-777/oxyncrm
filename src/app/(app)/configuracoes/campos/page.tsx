import { Suspense } from "react";
import { CompanyPicker, NoCompany } from "@/components/settings/company-picker";
import { CustomFieldsManager, type CustomFieldRow } from "@/components/settings/custom-fields-manager";
import { requireSuperAdmin } from "@/lib/auth/session";
import { resolveSettingsCompany } from "@/lib/companies/settings-company";
import { createServerClient } from "@/lib/supabase/server";
import { CUSTOM_FIELD_ENTITIES_PHASE2, type CustomFieldEntity, type CustomFieldType } from "@/lib/custom-fields/schema";

export const instant = false;

export default async function CustomFieldsSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ empresa?: string }>;
}) {
  await requireSuperAdmin();
  const { empresa } = await searchParams;
  const { companies, selected } = await resolveSettingsCompany(empresa);
  if (!selected) return <NoCompany />;
  const supabase = await createServerClient();
  const { data } = await supabase
    .from("custom_field_defs")
    .select("id, entity, key, label, type, options, archived_at")
    .eq("company_id", selected.id)
    .in("entity", [...CUSTOM_FIELD_ENTITIES_PHASE2])
    .order("position")
    .order("label");
  const fields: CustomFieldRow[] = (data ?? []).map((f) => ({
    id: f.id,
    entity: f.entity as CustomFieldEntity,
    key: f.key,
    label: f.label,
    type: f.type as CustomFieldType,
    options: Array.isArray(f.options) ? (f.options as string[]) : [],
    archived: f.archived_at !== null,
  }));
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-heading text-2xl font-semibold">Campos personalizados</h1>
        <Suspense>
          <CompanyPicker companies={companies} selected={selected.slug} />
        </Suspense>
      </div>
      <CustomFieldsManager key={selected.id} companyId={selected.id} fields={fields} />
    </div>
  );
}
