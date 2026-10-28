/** Metas: linha como chega do banco (goals_progress_self) e o formato da tela. */
export type GoalRow = {
  id: string;
  companyId: string;
  label: string;
  targetKind: "company" | "user" | "team";
  targetUserId: string | null;
  targetTeamId: string | null;
  metric: string;
  period: "week" | "month" | "quarter";
  startsOn: string;
  targetValue: number;
  actual: number;
  percent: number;
  periodStart: string;
  periodEnd: string;
};
export type RawGoal = Record<string, unknown>;
export const toGoalRow = (g: RawGoal): GoalRow => ({
  id: String(g.id),
  companyId: String(g.company_id),
  label: String(g.label ?? ""),
  targetKind: g.target_kind as GoalRow["targetKind"],
  targetUserId: (g.target_user_id as string | null) ?? null,
  targetTeamId: (g.target_team_id as string | null) ?? null,
  metric: String(g.metric),
  period: g.period as GoalRow["period"],
  startsOn: String(g.starts_on),
  targetValue: Number(g.target_value ?? 0),
  actual: Number(g.actual ?? 0),
  percent: Number(g.percent ?? 0),
  periodStart: String(g.period_start ?? ""),
  periodEnd: String(g.period_end ?? ""),
});
