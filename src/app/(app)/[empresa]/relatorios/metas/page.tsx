import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { DeleteGoalButton } from "@/components/goals/delete-goal-button";
import { GoalForm } from "@/components/goals/goal-form";
import { GoalProgress, goalValueType } from "@/components/goals/goal-progress";
import { dayKey } from "@/lib/activities/time";
import { requireUser } from "@/lib/auth/session";
import { getAccessibleCompanies, resolveCompanyScope } from "@/lib/companies/scope";
import { listAssignableOwners } from "@/lib/records/owners";
import { getReportPermissions, reportCompanyIds } from "@/lib/reports/permissions";
import { GOAL_METRIC_LABELS, GOAL_PERIOD_LABELS } from "@/lib/reports/goals";
import { listGoals } from "@/lib/reports/queries";
import { createServerClient } from "@/lib/supabase/server";

export const instant = false;

export default async function GoalsPage({ params }: { params: Promise<{ empresa: string }> }) {
  await connection();
  const { empresa } = await params;
  const [perms, profile, companies] = await Promise.all([getReportPermissions(empresa), requireUser(), getAccessibleCompanies()]);
  if (!perms.viewReports) notFound();
  const scope = resolveCompanyScope(empresa, companies, profile.isSuperAdmin);
  if (!scope) notFound();

  const reportIds = await reportCompanyIds(empresa);
  const inScope = companies.filter((c) => reportIds.includes(c.id));
  const name = new Map(inScope.map((c) => [c.id, c.name]));
  const goals = (await listGoals(empresa)).filter((g) => name.has(g.companyId));
  const multi = scope.kind === "all";

  let form: React.ReactNode = null;
  if (profile.isSuperAdmin) {
    const supabase = await createServerClient();
    const [owners, teams] = await Promise.all([
      Promise.all(inScope.map(async (c) => [c.id, await listAssignableOwners(c.id)] as const)),
      supabase.from("teams").select("id, name").order("name"),
    ]);
    form = (
      <GoalForm
        companies={inScope.map((c) => ({ value: c.id, label: c.name }))}
        defaultCompanyId={scope.kind === "company" ? scope.company.id : null}
        membersByCompany={Object.fromEntries(
          owners.map(([id, list]) => [id, list.filter((o) => o.active).map((o) => ({ value: o.id, label: o.fullName }))]),
        )}
        teams={(teams.data ?? []).map((t) => ({ value: t.id as string, label: t.name as string }))}
        today={dayKey(new Date())}
      />
    );
  }

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between gap-4">
        <div>
          <Link href={`/${empresa}/relatorios`} className="text-sm text-muted-foreground hover:underline">
            Relatórios
          </Link>
          <h1 className="font-heading text-2xl font-semibold">Metas</h1>
        </div>
        {form}
      </header>

      {goals.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhuma meta definida.</p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {goals.map((g) => (
            <li key={g.id} className="flex items-start gap-4 px-4 py-4">
              <div className="min-w-0 flex-1 space-y-1">
                <GoalProgress
                  label={g.label}
                  caption={multi ? name.get(g.companyId) : undefined}
                  type={goalValueType(g.metric)}
                  target={g.targetValue}
                  actual={g.actual}
                  percent={g.percent}
                  periodStart={g.periodStart}
                  periodEnd={g.periodEnd}
                />
                <p className="text-xs text-muted-foreground">
                  {GOAL_METRIC_LABELS[g.metric as keyof typeof GOAL_METRIC_LABELS] ?? g.metric}, {GOAL_PERIOD_LABELS[g.period].toLowerCase()}
                </p>
              </div>
              {profile.isSuperAdmin ? <DeleteGoalButton id={g.id} label={g.label} /> : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
