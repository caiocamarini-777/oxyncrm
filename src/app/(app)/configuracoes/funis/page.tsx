import { Suspense } from "react";
import { SettingsCompanyPicker, NoCompany } from "@/components/settings/company-picker";
import { PipelinesManager } from "@/components/settings/pipelines-manager";
import { requireSuperAdmin } from "@/lib/auth/session";
import { resolveSettingsCompany } from "@/lib/companies/settings-company";
import { listPipelinesWithStages } from "@/lib/pipelines/queries";
import { listActiveCustomFieldDefs } from "@/lib/records/lookups";

export const instant = false;

export default async function PipelinesSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ empresa?: string }>;
}) {
  await requireSuperAdmin();
  const { empresa } = await searchParams;
  const { companies, selected } = await resolveSettingsCompany(empresa);
  if (!selected) return <NoCompany />;
  const [pipelines, defs] = await Promise.all([
    listPipelinesWithStages(selected.id),
    listActiveCustomFieldDefs(selected.id, "deals"),
  ]);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-heading text-2xl font-semibold">Funis</h1>
        <Suspense>
          <SettingsCompanyPicker companies={companies} selected={selected.slug} />
        </Suspense>
      </div>
      <p className="text-sm text-muted-foreground">
        Funis arquivados saem do quadro de negócios, mas os negócios deles continuam existindo.
      </p>
      <PipelinesManager
        key={selected.id}
        companyId={selected.id}
        pipelines={pipelines}
        customDefs={defs.map((d) => ({ key: d.key, label: d.label }))}
      />
    </div>
  );
}
