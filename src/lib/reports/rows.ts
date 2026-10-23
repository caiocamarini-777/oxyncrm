import type { ReportSpec } from "./spec";

export type ReportRow = { id: string; companyId: string | null; name: string; spec: ReportSpec; updatedAt: string };
export type RawReport = { id: string; company_id: string | null; name: string; spec: unknown; updated_at: string };
export const toReportRow = (r: RawReport): ReportRow => ({
  id: r.id,
  companyId: r.company_id,
  name: r.name,
  spec: r.spec as ReportSpec,
  updatedAt: r.updated_at,
});

export type WidgetRow = {
  id: string;
  dashboardId: string;
  reportId: string | null;
  /** Spec do relatório salvo, ou a do próprio widget. Nula quando o espectador não lê o relatório. */
  spec: ReportSpec | null;
  title: string;
  position: number;
  colSpan: number;
  rowSpan: number;
};
export type RawWidget = {
  id: string;
  dashboard_id: string;
  report_id: string | null;
  spec: unknown;
  title: string;
  position: number;
  col_span: number;
  row_span: number;
  reports?: { name: string; spec: unknown } | null;
};
export const toWidgetRow = (w: RawWidget): WidgetRow => ({
  id: w.id,
  dashboardId: w.dashboard_id,
  reportId: w.report_id,
  spec: ((w.reports?.spec ?? w.spec) as ReportSpec | null) ?? null,
  title: w.title || w.reports?.name || "",
  position: w.position,
  colSpan: w.col_span,
  rowSpan: w.row_span,
});

export type ShareLinkRow = {
  id: string;
  createdAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
};
export type RawLink = { id: string; created_at: string; expires_at: string | null; revoked_at: string | null };
export const toLinkRow = (l: RawLink): ShareLinkRow => ({
  id: l.id,
  createdAt: l.created_at,
  expiresAt: l.expires_at,
  revokedAt: l.revoked_at,
});

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
