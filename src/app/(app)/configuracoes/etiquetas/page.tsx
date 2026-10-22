import { Suspense } from "react";
import { SettingsCompanyPicker, NoCompany } from "@/components/settings/company-picker";
import { LabelsManager, type LabelRow } from "@/components/settings/labels-manager";
import { requireSuperAdmin } from "@/lib/auth/session";
import { resolveSettingsCompany } from "@/lib/companies/settings-company";
import { fail } from "@/lib/records/list-helpers";
import { createServerClient } from "@/lib/supabase/server";
import type { LabelColor } from "@/lib/custom-fields/schema";

export const instant = false;

export default async function LabelsSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ empresa?: string }>;
}) {
  await requireSuperAdmin();
  const { empresa } = await searchParams;
  const { companies, selected } = await resolveSettingsCompany(empresa);
  if (!selected) return <NoCompany />;
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("labels")
    .select("id, name, color")
    .eq("company_id", selected.id)
    .order("name");
  if (error) fail("configurações", "etiquetas", error);
  const labels: LabelRow[] = (data ?? []).map((l) => ({
    id: l.id,
    name: l.name,
    color: l.color as LabelColor,
  }));
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-heading text-2xl font-semibold">Etiquetas</h1>
        <Suspense>
          <SettingsCompanyPicker companies={companies} selected={selected.slug} />
        </Suspense>
      </div>
      <LabelsManager key={selected.id} companyId={selected.id} labels={labels} />
    </div>
  );
}
