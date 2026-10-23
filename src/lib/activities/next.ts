import { dayKey, dueStatus, formatShortDate, startOfNextDayUtc } from "./time";

/** Linha de `next_activity_for` já em camelCase. */
export type NextActivityRow = { activityId: string; dueAt: string; subject: string };

/** Próxima atividade aberta de um registro, pronta para o selo. */
export type NextActivity = {
  id: string;
  dueAt: string;
  subject: string;
  status: "overdue" | "today" | "upcoming";
  /** "Atrasada", "Hoje", "Amanhã" ou "23/10". */
  label: string;
};

export function toNextActivity(row: NextActivityRow, now: Date): NextActivity {
  const status = dueStatus(row.dueAt, false, now);
  if (status === "done") throw new Error("Atividade concluída não é a próxima.");
  let label: string;
  if (status === "overdue") label = "Atrasada";
  else if (status === "today") label = "Hoje";
  else if (dayKey(row.dueAt) === dayKey(startOfNextDayUtc(dayKey(now)))) label = "Amanhã";
  else label = formatShortDate(row.dueAt);
  return { id: row.activityId, dueAt: row.dueAt, subject: row.subject, status, label };
}
