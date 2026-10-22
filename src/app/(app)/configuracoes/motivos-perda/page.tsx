import { Suspense } from "react";
import { SettingsCompanyPicker, NoCompany } from "@/components/settings/company-picker";
import { ListItemsManager } from "@/components/settings/list-items-manager";
import { requireSuperAdmin } from "@/lib/auth/session";
import { resolveSettingsCompany } from "@/lib/companies/settings-company";
import { fail } from "@/lib/records/list-helpers";
import { createServerClient } from "@/lib/supabase/server";

export const instant = false;

export default async function LostReasonsSettingsPage({
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
    .from("lost_reasons")
    .select("id, name, active")
    .eq("company_id", selected.id)
    .order("position")
    .order("name");
  if (error) fail("configurações", "motivos de perda", error);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-heading text-2xl font-semibold">Motivos de perda</h1>
        <Suspense>
          <SettingsCompanyPicker companies={companies} selected={selected.slug} />
        </Suspense>
      </div>
      <p className="text-sm text-muted-foreground">Motivos inativos não aparecem nos formulários, mas continuam nos negócios que já os usam.</p>
      <ListItemsManager
        key={selected.id}
        kind="lost_reason"
        companyId={selected.id}
        items={data ?? []}
        addLabel="Novo motivo"
        emptyText="Nenhum motivo cadastrado."
      />
    </div>
  );
}
