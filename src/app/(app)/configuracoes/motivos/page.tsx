import { Suspense } from "react";
import { CompanyPicker, NoCompany } from "@/components/settings/company-picker";
import { ListItemsManager } from "@/components/settings/list-items-manager";
import { requireSuperAdmin } from "@/lib/auth/session";
import { resolveSettingsCompany } from "@/lib/companies/settings-company";
import { createServerClient } from "@/lib/supabase/server";

export const instant = false;

export default async function ReasonsSettingsPage({
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
    .from("disqualification_reasons")
    .select("id, name, active")
    .eq("company_id", selected.id)
    .order("position")
    .order("name");
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-heading text-2xl font-semibold">Motivos de desqualificação</h1>
        <Suspense>
          <CompanyPicker companies={companies} selected={selected.slug} />
        </Suspense>
      </div>
      <p className="text-sm text-muted-foreground">Motivos inativos não aparecem nos formulários, mas continuam nos leads que já os usam.</p>
      <ListItemsManager
        key={selected.id}
        kind="reason"
        companyId={selected.id}
        items={data ?? []}
        addLabel="Novo motivo"
        emptyText="Nenhum motivo cadastrado."
      />
    </div>
  );
}
