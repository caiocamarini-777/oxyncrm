import { Suspense } from "react";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { ActivitiesToolbar } from "@/components/activities/activities-toolbar";
import { ActivityList } from "@/components/activities/activity-list";
import { AgendaMonth } from "@/components/activities/agenda-month";
import { AgendaWeek } from "@/components/activities/agenda-week";
import type { CompanyCtx, PageCtx } from "@/components/activities/page-context";
import { Pagination } from "@/components/records/pagination";
import { AGENDA_LIMIT, countOverdue, getActivityCatalog, getAgenda, listActivities } from "@/lib/activities/queries";
import { dayKey } from "@/lib/activities/time";
import { agendaRange, parseActivityListQuery, parseAnchor, parseView } from "@/lib/activities/view";
import { requireUser } from "@/lib/auth/session";
import { getAccessibleCompanies, resolveCompanyScope } from "@/lib/companies/scope";
import { listTeams } from "@/lib/records/lookups";
import { listAssignableOwners } from "@/lib/records/owners";
import { getEntityPermissions } from "@/lib/records/permissions";

export const instant = false;

export default async function ActivitiesPage({
  params,
  searchParams,
}: {
  params: Promise<{ empresa: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await connection();
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
  const now = new Date();
  const view = parseView(sp.get("visao"));
  const anchor = parseAnchor(sp.get("data"), dayKey(now));
  const query = parseActivityListQuery(sp);

  const scoped = scope.kind === "all" ? companies : [scope.company];
  const [perCompany, teams] = await Promise.all([
    Promise.all(
      scoped.map(async (company) => {
        const [permissions, owners, catalog] = await Promise.all([
          getEntityPermissions(company.id, "leads"),
          listAssignableOwners(company.id),
          getActivityCatalog(company.id),
        ]);
        return { company, permissions, owners, catalog };
      }),
    ),
    listTeams(),
  ]);

  const multi = scoped.length > 1;
  const ctx: PageCtx = {
    allCompanies: scope.kind === "all",
    currentUserId: profile.id,
    nowIso: now.toISOString(),
    companies: perCompany.map(
      (c): CompanyCtx => ({
        id: c.company.id,
        slug: c.company.slug,
        name: c.company.name,
        catalog: c.catalog,
        owners: c.owners,
        canCreate: c.permissions.create,
        canEdit: c.permissions.edit,
        canReassign: c.permissions.reassign,
      }),
    ),
  };

  const ownerMap = new Map<string, string>();
  for (const c of perCompany) for (const o of c.owners) ownerMap.set(o.id, o.fullName);
  const suffix = (name: string, company: string) => (multi ? `${name} (${company})` : name);
  const options = {
    owners: [...ownerMap].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label, "pt-BR")),
    teams: teams.map((t) => ({ value: t.id, label: t.name })),
    types: perCompany.flatMap((c) => c.catalog.types.map((t) => ({ value: t.id, label: suffix(t.name, c.company.name) }))),
    channels: perCompany.flatMap((c) =>
      c.catalog.channels.filter((ch) => !ch.isLegacy).map((ch) => ({ value: ch.id, label: suffix(ch.name, c.company.name) })),
    ),
  };

    const filtered = Boolean(query.q) || ["owner", "team", "type", "channel"].some((k) => sp.has(k));

  let body: React.ReactNode;
  if (view === "lista") {
    const [result, overdueCount] = await Promise.all([listActivities(scope, query, now), countOverdue(scope, query, now)]);
    body = (
      <>
        <ActivityList
          rows={result.rows}
          total={result.total}
          query={query}
          ctx={ctx}
          overdueCount={overdueCount}
          filtered={filtered}
        />
        <Pagination total={result.total} page={query.page} />
      </>
    );
  } else {
    const { from, to } = agendaRange(anchor, view);
    const rows = await getAgenda(
      scope,
      from,
      to,
      { q: query.q, owner: query.owner, team: query.team, type: query.type, channel: query.channel },
      now,
    );
    const truncated = rows.length >= AGENDA_LIMIT;
    body =
      view === "semana" ? (
        <AgendaWeek rows={rows} anchor={anchor} ctx={ctx} truncated={truncated} />
      ) : (
        <AgendaMonth rows={rows} anchor={anchor} ctx={ctx} truncated={truncated} />
      );
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-heading text-2xl font-semibold">Atividades</h1>
      <Suspense>
        <ActivitiesToolbar view={view} options={options} ctx={ctx} />
      </Suspense>
      <Suspense>{body}</Suspense>
    </div>
  );
}
