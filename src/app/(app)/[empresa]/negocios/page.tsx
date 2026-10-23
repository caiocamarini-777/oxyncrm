import { Suspense } from "react";
import { notFound } from "next/navigation";
import { DealStatusTabs } from "@/components/deals/deal-columns";
import { DealsTable } from "@/components/deals/deals-table";
import { ForecastView } from "@/components/deals/forecast-view";
import { Pagination } from "@/components/records/pagination";
import { ExportLink } from "@/components/records/export-link";
import { CreateDealDialog } from "@/components/deals/create-deal-dialog";
import { DealsToolbar } from "@/components/deals/deals-toolbar";
import { KanbanBoard } from "@/components/deals/kanban-board";
import type { CompanySummary, CompanyScope } from "@/lib/companies/pure";
import { requireUser } from "@/lib/auth/session";
import { getAccessibleCompanies, resolveCompanyScope } from "@/lib/companies/scope";
import { BOARD_STAGE_LIMIT, DEAL_SORTS, FORECAST_LIMIT, getBoard, getForecast, listActiveLostReasons, listDeals } from "@/lib/deals/queries";
import type { DealListQuery } from "@/lib/deals/queries";
import { parseDealListQuery, parseDealView } from "@/lib/deals/query";
import { listPipelinesWithStages } from "@/lib/pipelines/queries";
import { listActiveCustomFieldDefs, listCompanyLabels, listTeams } from "@/lib/records/lookups";
import { listAssignableOwners } from "@/lib/records/owners";
import { getEntityPermissions } from "@/lib/records/permissions";

export const instant = false;

export default async function DealsPage({
  params,
  searchParams,
}: {
  params: Promise<{ empresa: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ empresa }, rawParams, profile, companies] = await Promise.all([
    params,
    searchParams,
    requireUser(),
    getAccessibleCompanies(),
  ]);
  const scope = resolveCompanyScope(empresa, companies, profile.isSuperAdmin);
  if (!scope) notFound();

  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(rawParams)) {
    for (const item of Array.isArray(v) ? v : v === undefined ? [] : [v]) sp.append(k, item);
  }
  const query = parseDealListQuery(sp, DEAL_SORTS);

  if (scope.kind === "all") return <AllCompaniesDeals scope={scope} query={query} companies={companies} />;

  const view = parseDealView(sp.get("visao"));
  const company = scope.company;
  const [allPipelines, permissions, owners, labels, defs, teams, lostReasons] = await Promise.all([
    listPipelinesWithStages(company.id),
    getEntityPermissions(company.id, "deals"),
    listAssignableOwners(company.id),
    listCompanyLabels(company.id),
    listActiveCustomFieldDefs(company.id, "deals"),
    listTeams(),
    listActiveLostReasons(company.id),
  ]);
  const pipelines = allPipelines.filter((p) => !p.archived);
  const requested = sp.get("funil");
  const requestedPipeline = pipelines.find((p) => p.id === requested) ?? null;
  // A lista mostra todos os funis até que um seja escolhido; kanban e forecast sempre têm um funil.
  const pipeline = view === "lista" ? requestedPipeline : (requestedPipeline ?? pipelines[0] ?? null);
  const defaultPipeline = requestedPipeline ?? pipelines[0] ?? null;

  const filters = { q: query.q, owner: query.owner, team: query.team, label: query.label, rotting: query.rotting, overdue: query.overdue };
  const board = pipeline && view === "kanban" ? await getBoard(company.id, pipeline.id, filters) : null;
  const forecast = pipeline && view === "forecast" ? await getForecast(company.id, pipeline.id, filters) : null;
  const listQuery = { ...query, pipeline: pipeline?.id ?? null };
  const list = view === "lista" && pipelines.length > 0 ? await listDeals(scope, listQuery) : null;
  const stageScope = pipeline ? [pipeline] : pipelines;

  const options = {
    owners: owners.map((o) => ({ value: o.id, label: o.fullName })),
    teams: teams.map((t) => ({ value: t.id, label: t.name })),
    labels: labels.map((l) => ({ value: l.id, label: l.name })),
    stages: stageScope.flatMap((p) =>
      p.stages
        .filter((st) => !st.archived)
        .map((st) => ({ value: st.id, label: stageScope.length > 1 ? `${st.name} (${p.name})` : st.name })),
    ),
  };

  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-heading text-2xl font-semibold">Negócios</h1>
      {view === "lista" ? (
        <Suspense>
          <DealStatusTabs />
        </Suspense>
      ) : null}
      <Suspense>
        <DealsToolbar
          pipelines={pipelines.map((p) => ({ id: p.id, name: p.name }))}
          pipelineId={pipeline?.id ?? null}
          view={view}
          options={options}
          actions={
            <>
              {view === "lista" && permissions.export ? <ExportLink scopeSlug={company.slug} segment="negocios" /> : null}
              {permissions.create && defaultPipeline ? (
              <CreateDealDialog
                companyId={company.id}
                pipelines={pipelines.map((p) => ({ id: p.id, name: p.name, stages: p.stages.filter((s) => !s.archived).map((s) => ({ id: s.id, name: s.name })) }))}
                defaultPipelineId={defaultPipeline.id}
                defs={defs}
                owners={owners}
              />
              ) : null}
            </>
          }
        />
      </Suspense>
      {pipelines.length === 0 ? (
        <p className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">
          Nenhum funil ativo nesta empresa. Um administrador pode criar funis em Configurações.
        </p>
      ) : view === "lista" ? (
        list ? (
          <Suspense>
            <DealsTable rows={list.rows} total={list.total} query={listQuery} allCompanies={false} />
            <Pagination total={list.total} page={query.page} />
          </Suspense>
        ) : null
      ) : view === "forecast" ? (
        forecast ? (
          <Suspense>
            <ForecastView
              buckets={forecast.buckets}
              companySlug={company.slug}
              weighted={sp.get("ponderado") === "1"}
              truncated={forecast.truncated}
              limit={FORECAST_LIMIT}
              lastMonthLabel={forecast.buckets[forecast.buckets.length - 2].label}
            />
          </Suspense>
        ) : null
      ) : board ? (
        <KanbanBoard
          key={board.pipeline.id}
          board={board}
          companyId={company.id}
          companySlug={company.slug}
          stageLimit={BOARD_STAGE_LIMIT}
          canEdit={permissions.edit}
          canDelete={permissions.delete}
          defs={defs}
          owners={owners}
          lostReasons={lostReasons}
        />
      ) : null}
    </div>
  );
}

/** Visão "Todas as empresas": só a lista; Kanban e Forecast pedem a empresa na barra. */
async function AllCompaniesDeals({
  scope,
  query,
  companies,
}: {
  scope: CompanyScope;
  query: Required<DealListQuery>;
  companies: CompanySummary[];
}) {
  const [result, perCompany, teams] = await Promise.all([
    listDeals(scope, query),
    Promise.all(
      companies.map(async (company) => {
        const [permissions, owners, labels] = await Promise.all([
          getEntityPermissions(company.id, "deals"),
          listAssignableOwners(company.id),
          listCompanyLabels(company.id),
        ]);
        return { company, permissions, owners, labels };
      }),
    ),
    listTeams(),
  ]);
  const ownerMap = new Map<string, string>();
  for (const c of perCompany) for (const o of c.owners) ownerMap.set(o.id, o.fullName);
  const options = {
    owners: [...ownerMap].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label, "pt-BR")),
    teams: teams.map((t) => ({ value: t.id, label: t.name })),
    labels: perCompany.flatMap((c) => c.labels.map((l) => ({ value: l.id, label: `${l.name} (${c.company.name})` }))),
  };
  const canExport = perCompany.some((c) => c.permissions.export);
  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-heading text-2xl font-semibold">Negócios</h1>
      <Suspense>
        <DealStatusTabs />
      </Suspense>
      <Suspense>
        <DealsToolbar
          pipelines={[]}
          pipelineId={null}
          view="lista"
          options={options}
          allCompanies
          companies={companies}
          actions={canExport ? <ExportLink scopeSlug="todas" segment="negocios" /> : null}
        />
      </Suspense>
      <Suspense>
        <DealsTable rows={result.rows} total={result.total} query={query} allCompanies />
        <Pagination total={result.total} page={query.page} />
      </Suspense>
    </div>
  );
}
