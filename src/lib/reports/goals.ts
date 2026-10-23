import { z } from "zod";
import { UUID_RE } from "@/lib/uuid";

export const GOAL_METRICS = [
  "meetings_booked",
  "meetings_held",
  "opportunities_created",
  "won_value",
  "won_mrr",
  "activities_done",
] as const;
export const GOAL_PERIODS = ["week", "month", "quarter"] as const;
export const GOAL_TARGETS = ["company", "user", "team"] as const;
export type GoalPeriod = (typeof GOAL_PERIODS)[number];

export const GOAL_METRIC_LABELS: Record<(typeof GOAL_METRICS)[number], string> = {
  meetings_booked: "Reuniões agendadas",
  meetings_held: "Reuniões realizadas",
  opportunities_created: "Oportunidades criadas",
  won_value: "Valor ganho",
  won_mrr: "MRR ganho",
  activities_done: "Atividades concluídas",
};
export const GOAL_PERIOD_LABELS: Record<GoalPeriod, string> = {
  week: "Semana",
  month: "Mês",
  quarter: "Trimestre",
};

function parseDay(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3])
    ? d
    : null;
}

/**
 * Espelha o check do banco em goals.starts_on: semana começa na segunda, mês no dia 1 e trimestre no dia 1
 * de janeiro, abril, julho ou outubro. A Task 9 reutiliza este helper.
 */
export function isAlignedStart(period: GoalPeriod, startsOn: string): boolean {
  const d = parseDay(startsOn);
  if (!d) return false;
  if (period === "week") return d.getUTCDay() === 1;
  if (period === "month") return d.getUTCDate() === 1;
  return d.getUTCDate() === 1 && [0, 3, 6, 9].includes(d.getUTCMonth());
}

export const goalSchema = z
  .strictObject({
    companyId: z.string().regex(UUID_RE, "Escolha a empresa."),
    targetKind: z.enum(GOAL_TARGETS, { error: "Escolha o alvo da meta." }),
    targetUserId: z.string().regex(UUID_RE, "Pessoa inválida.").nullish(),
    targetTeamId: z.string().regex(UUID_RE, "Equipe inválida.").nullish(),
    metric: z.enum(GOAL_METRICS, { error: "Escolha a métrica." }),
    period: z.enum(GOAL_PERIODS, { error: "Escolha o período." }),
    startsOn: z.string(),
    targetValue: z.number({ error: "Informe o valor da meta." }).finite().positive("A meta precisa ser maior que zero."),
  })
  .superRefine((g, ctx) => {
    const issue = (path: string, message: string) => ctx.addIssue({ code: "custom", path: [path], message });
    if (g.targetKind === "company" && (g.targetUserId || g.targetTeamId)) issue("targetKind", "Meta da empresa não tem pessoa nem equipe.");
    if (g.targetKind === "user" && (!g.targetUserId || g.targetTeamId)) issue("targetUserId", "Escolha a pessoa.");
    if (g.targetKind === "team" && (!g.targetTeamId || g.targetUserId)) issue("targetTeamId", "Escolha a equipe.");
    if (!isAlignedStart(g.period, g.startsOn)) {
      issue("startsOn", "O início precisa coincidir com o período (segunda, dia 1 ou início do trimestre).");
    }
  });
export type GoalInput = z.input<typeof goalSchema>;
