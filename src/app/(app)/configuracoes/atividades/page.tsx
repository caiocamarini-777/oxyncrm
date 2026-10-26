import { Suspense } from "react";
import { SettingsCompanyPicker, NoCompany } from "@/components/settings/company-picker";
import { ActivitySettingsManager } from "@/components/settings/activity-settings-manager";
import { leadRuleSchema, type Classification } from "@/lib/activities/settings-schema";
import { requireSuperAdmin } from "@/lib/auth/session";
import { resolveSettingsCompany } from "@/lib/companies/settings-company";
import { fail } from "@/lib/records/list-helpers";
import { createServerClient } from "@/lib/supabase/server";

export const instant = false;

export default async function ActivitySettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ empresa?: string }>;
}) {
  await requireSuperAdmin();
  const { empresa } = await searchParams;
  const { companies, selected } = await resolveSettingsCompany(empresa);
  if (!selected) return <NoCompany />;
  const supabase = await createServerClient();
  const [types, channels, outcomes, company] = await Promise.all([
    supabase.from("activity_types").select("id, name, active, is_meeting").eq("company_id", selected.id).order("position").order("name"),
    supabase.from("activity_channels").select("id, name, active, is_legacy").eq("company_id", selected.id).order("position").order("name"),
    supabase.from("activity_outcomes").select("id, name, active, classification, books_meeting").eq("company_id", selected.id).order("position").order("name"),
    supabase.from("companies").select("settings").eq("id", selected.id).single(),
  ]);
  if (types.error) fail("configurações", "tipos de atividade", types.error);
  if (channels.error) fail("configurações", "canais de atividade", channels.error);
  if (outcomes.error) fail("configurações", "resultados de atividade", outcomes.error);
  if (company.error) fail("configurações", "empresa", company.error);
  const rule = leadRuleSchema.safeParse((company.data.settings as Record<string, unknown> | null)?.lead_next_activity_rule);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-heading text-2xl font-semibold">Atividades</h1>
        <Suspense>
          <SettingsCompanyPicker companies={companies} selected={selected.slug} />
        </Suspense>
      </div>
      <ActivitySettingsManager
        key={selected.id}
        companyId={selected.id}
        types={(types.data ?? []).map((t) => ({ id: t.id, name: t.name, active: t.active, isMeeting: t.is_meeting }))}
        channels={(channels.data ?? []).map((c) => ({ id: c.id, name: c.name, active: c.active, isLegacy: c.is_legacy }))}
        outcomes={(outcomes.data ?? []).map((o) => ({
          id: o.id,
          name: o.name,
          active: o.active,
          classification: o.classification as Classification,
          booksMeeting: o.books_meeting,
        }))}
        leadRule={rule.success ? rule.data : "off"}
      />
    </div>
  );
}
