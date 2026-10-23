import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { PresetFilters } from "@/components/reports/preset-filters";
import { ReportChart } from "@/components/reports/report-chart";
import { getReportLookups } from "@/lib/reports/lookups";
import { getReportPermissions } from "@/lib/reports/permissions";
import { presetSpecFromQuery } from "@/lib/reports/preset-query";
import { getPreset } from "@/lib/reports/presets";
import { runReportResult } from "@/lib/reports/queries";
import { getAccessibleCompanies, resolveCompanyScope } from "@/lib/companies/scope";
import { requireUser } from "@/lib/auth/session";

export const instant = false;

const CHANNEL_FUNNEL_NOTE =
  "Um lead com reuniões de canais diferentes conta em cada canal; as linhas não somam.";

export default async function PresetReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ empresa: string; preset: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await connection();
  const [{ empresa, preset: presetKey }, raw] = await Promise.all([params, searchParams]);
  const preset = getPreset(presetKey);
  if (!preset || preset.key === "goal_progress") notFound();
  const [perms, profile, companies] = await Promise.all([
    getReportPermissions(empresa),
    requireUser(),
    getAccessibleCompanies(),
  ]);
  if (!perms.viewReports) notFound();
  const scope = resolveCompanyScope(empresa, companies, profile.isSuperAdmin);
  if (!scope) notFound();

  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(raw)) {
    for (const item of Array.isArray(v) ? v : v === undefined ? [] : [v]) sp.append(k, item);
  }

  const lookups = await getReportLookups(empresa);
  const pipelines = lookups.fields.pipeline ?? [];
  const spec = presetSpecFromQuery(preset, sp, pipelines[0]?.value ?? null);
  const res = spec ? await runReportResult(spec, empresa) : null;

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <Link href={`/${empresa}/relatorios`} className="text-sm text-muted-foreground hover:underline">
          Relatórios
        </Link>
        <h1 className="font-heading text-2xl font-semibold">{preset.name}</h1>
        <p className="text-sm text-muted-foreground">{preset.description}</p>
      </header>

      <PresetFilters
        preset={preset}
        showCompany={scope.kind === "all"}
        options={{
          company: lookups.fields.company ?? [],
          owner: lookups.fields.owner ?? [],
          team: lookups.fields.team ?? [],
          pipeline: pipelines,
        }}
      />

      {preset.key === "channel_funnel" ? (
        <p className="text-sm text-muted-foreground">{CHANNEL_FUNNEL_NOTE}</p>
      ) : null}

      <div className="rounded-lg border p-4">
        {!res ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Escolha um funil para ver o relatório.</p>
        ) : res.ok ? (
          <ReportChart result={res.data} chart={preset.chart} title={preset.name} />
        ) : (
          <p role="alert" className="py-8 text-center text-sm text-destructive">
            {res.error}
          </p>
        )}
      </div>
    </div>
  );
}
