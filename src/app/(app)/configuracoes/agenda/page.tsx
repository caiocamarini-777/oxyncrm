import { Suspense } from "react";
import { SettingsCompanyPicker, NoCompany } from "@/components/settings/company-picker";
import { CalendarSyncForm } from "@/components/settings/calendar-sync-form";
import { requireSuperAdmin } from "@/lib/auth/session";
import { readCalendarSettings } from "@/lib/calendar/settings";
import { resolveSettingsCompany } from "@/lib/companies/settings-company";
import { fail } from "@/lib/records/list-helpers";
import { createServerClient } from "@/lib/supabase/server";

export const instant = false;

export default async function CalendarSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ empresa?: string }>;
}) {
  await requireSuperAdmin();
  const { empresa } = await searchParams;
  const { companies, selected } = await resolveSettingsCompany(empresa);
  if (!selected) return <NoCompany />;
  const supabase = await createServerClient();
  const company = await supabase.from("companies").select("settings").eq("id", selected.id).single();
  if (company.error) fail("configurações", "empresa", company.error);
  const { enabled } = readCalendarSettings(company.data.settings);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-heading text-2xl font-semibold">Agenda do Google</h1>
        <Suspense>
          <SettingsCompanyPicker companies={companies} selected={selected.slug} />
        </Suspense>
      </div>
      <p className="text-sm text-muted-foreground">
        Ligue só no dia da virada, depois que cada vendedor desligar a sincronização de agenda no Pipedrive. Na
        primeira rodada o CRM adota os eventos que já existem e não reenvia convites.
      </p>
      <CalendarSyncForm key={selected.id} companyId={selected.id} enabled={enabled} />
    </div>
  );
}
