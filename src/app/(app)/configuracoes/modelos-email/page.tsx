import { Suspense } from "react";
import { SettingsCompanyPicker, NoCompany } from "@/components/settings/company-picker";
import { EmailTemplatesManager } from "@/components/settings/email-templates-manager";
import { requireSuperAdmin } from "@/lib/auth/session";
import { resolveSettingsCompany } from "@/lib/companies/settings-company";
import { fail } from "@/lib/records/list-helpers";
import { createServerClient } from "@/lib/supabase/server";

export const instant = false;

export default async function EmailTemplatesSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ empresa?: string }>;
}) {
  await requireSuperAdmin();
  const { empresa } = await searchParams;
  const { companies, selected } = await resolveSettingsCompany(empresa);
  if (!selected) return <NoCompany />;
  const supabase = await createServerClient();
  const [templates, company] = await Promise.all([
    supabase
      .from("email_templates")
      .select("id, name, subject, body")
      .eq("company_id", selected.id)
      .is("deleted_at", null)
      .order("name"),
    supabase.from("companies").select("settings").eq("id", selected.id).single(),
  ]);
  if (templates.error) fail("configurações", "modelos de e-mail", templates.error);
  if (company.error) fail("configurações", "empresa", company.error);
  const settings = company.data.settings as Record<string, unknown> | null;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-heading text-2xl font-semibold">Modelos de e-mail</h1>
        <Suspense>
          <SettingsCompanyPicker companies={companies} selected={selected.slug} />
        </Suspense>
      </div>
      <p className="text-sm text-muted-foreground">
        Modelos ficam disponíveis ao escrever um e-mail em qualquer registro da empresa.
      </p>
      <EmailTemplatesManager
        key={selected.id}
        companyId={selected.id}
        templates={templates.data ?? []}
        sentAsActivity={settings?.email_sent_as_activity === true}
      />
    </div>
  );
}
