import { z } from "zod";
import { parseBRL } from "@/lib/records/format";
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

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Alinha uma data (AAAA-MM-DD) ao início do período: segunda, dia 1 ou início do trimestre. Data inválida volta como veio. */
export function alignStart(date: string, period: GoalPeriod): string {
  const d = parseDay(date);
  if (!d) return date;
  if (period === "week") {
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    return iso(d);
  }
  const month = period === "month" ? d.getUTCMonth() : Math.floor(d.getUTCMonth() / 3) * 3;
  return iso(new Date(Date.UTC(d.getUTCFullYear(), month, 1)));
}

/** Espelha o check do banco em goals.starts_on; é o ponto fixo de alignStart. */
export function isAlignedStart(period: GoalPeriod, startsOn: string): boolean {
  return parseDay(startsOn) !== null && alignStart(startsOn, period) === startsOn;
}

/** Valor-alvo digitado em pt-BR ("10.000", "1.500,50") para número; vazio ou ilegível vira NaN (o schema recusa). */
export const parseTargetValue = (raw: string): number => parseBRL(raw) ?? Number.NaN;

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
