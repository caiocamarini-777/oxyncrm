import { z } from "zod";
import { NEXT_ACTIVITY_LABELS, NEXT_ACTIVITY_RULES } from "@/lib/pipelines/schema";

export const CLASSIFICATIONS = ["success", "neutral", "failure"] as const;
export const CLASSIFICATION_LABELS = { success: "Sucesso", neutral: "Neutro", failure: "Insucesso" } as const;
export type Classification = (typeof CLASSIFICATIONS)[number];

export const LEAD_RULE_LABELS = NEXT_ACTIVITY_LABELS;

/** Limite de nome por lista (igual aos checks do banco). */
export const NAME_MAX = {
  source: 80,
  reason: 80,
  lost_reason: 80,
  activity_type: 40,
  activity_channel: 40,
  activity_outcome: 60,
} as const;

const name = (max: number) =>
  z.string().trim().min(1, "Informe o nome.").max(max, `Use no máximo ${max} caracteres.`);

export const activityTypeSchema = z.object({ name: name(NAME_MAX.activity_type), isMeeting: z.boolean() });
export const activityChannelSchema = z.object({ name: name(NAME_MAX.activity_channel) });
export const activityOutcomeSchema = z.object({
  name: name(NAME_MAX.activity_outcome),
  classification: z.enum(CLASSIFICATIONS, { message: "Escolha a classificação." }),
  booksMeeting: z.boolean(),
});
export const leadRuleSchema = z.enum(NEXT_ACTIVITY_RULES, { message: "Escolha uma regra." });
export type LeadRule = z.infer<typeof leadRuleSchema>;

export type ActivityConfigKind = "activity_type" | "activity_channel" | "activity_outcome";
