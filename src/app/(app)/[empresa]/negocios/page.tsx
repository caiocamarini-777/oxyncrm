import { Suspense } from "react";
import { notFound } from "next/navigation";
import { CreateDealDialog } from "@/components/deals/create-deal-dialog";
import { DealsToolbar, KanbanCompanyChooser } from "@/components/deals/deals-toolbar";
import { KanbanBoard } from "@/components/deals/kanban-board";
import { requireUser } from "@/lib/auth/session";
import { getAccessibleCompanies, resolveCompanyScope } from "@/lib/companies/scope";
import { BOARD_STAGE_LIMIT, getBoard, listActiveLostReasons } from "@/lib/deals/queries";
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

  if (scope.kind === "all") {
    // A lista de todas as empresas chega na próxima etapa; por ora o kanban pede a empresa.
    return (
      <div className="flex flex-col gap-4">
        <h1 className="font-heading text-2xl font-semibold">Negócios</h1>
        <KanbanCompanyChooser companies={companies} />
      </div>
    );
  }

  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(rawParams)) {
    for (const item of Array.isArray(v) ? v : v === undefined ? [] : [v]) sp.append(k, item);
  }
  const query = parseDealListQuery(sp, []);
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
  const pipeline = pipelines.find((p) => p.id === requested) ?? pipelines[0] ?? null;

  const filters = { q: query.q, owner: query.owner, team: query.team, label: query.label, rotting: query.rotting };
  const board = pipeline && view === "kanban" ? await getBoard(company.id, pipeline.id, filters) : null;

  const options = {
    owners: owners.map((o) => ({ value: o.id, label: o.fullName })),
    teams: teams.map((t) => ({ value: t.id, label: t.name })),
    labels: labels.map((l) => ({ value: l.id, label: l.name })),
  };

  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-heading text-2xl font-semibold">Negócios</h1>
      <Suspense>
        <DealsToolbar
          pipelines={pipelines.map((p) => ({ id: p.id, name: p.name }))}
          pipelineId={pipeline?.id ?? null}
          view={view}
          options={options}
          actions={
            permissions.create && pipeline ? (
              <CreateDealDialog
                companyId={company.id}
                pipelines={pipelines.map((p) => ({ id: p.id, name: p.name, stages: p.stages.filter((s) => !s.archived).map((s) => ({ id: s.id, name: s.name })) }))}
                defaultPipelineId={pipeline.id}
                defs={defs}
                owners={owners}
              />
            ) : null
          }
        />
      </Suspense>
      {!pipeline ? (
        <p className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">
          Nenhum funil ativo nesta empresa. Um administrador pode criar funis em Configurações.
        </p>
      ) : view !== "kanban" ? (
        <p className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">Esta visão chega em breve.</p>
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
