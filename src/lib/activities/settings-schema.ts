import { z } from "zod";
import { NEXT_ACTIVITY_LABELS, NEXT_ACTIVITY_RULES } from "@/lib/pipelines/schema";

export const CLASSIFICATIONS = ["success", "neutral", "failure"] as const;
export const CLASSIFICATION_LABELS = { success: "Sucesso", neutral: "Neutro", failure: "Insucesso" } as const;
export type Classification = (typeof CLASSIFICATIONS)[number];

export const LEAD_RULE_LABELS = NEXT_ACTIVITY_LABELS;

const name = (max: number) =>
  z.string().trim().min(1, "Informe o nome.").max(max, `Use no máximo ${max} caracteres.`);

export const activityTypeSchema = z.object({ name: name(40), isMeeting: z.boolean() });
export const activityChannelSchema = z.object({ name: name(40) });
export const activityOutcomeSchema = z.object({
  name: name(60),
  classification: z.enum(CLASSIFICATIONS, { message: "Escolha a classificação." }),
  booksMeeting: z.boolean(),
});
export const leadRuleSchema = z.enum(NEXT_ACTIVITY_RULES, { message: "Escolha uma regra." });
export type LeadRule = z.infer<typeof leadRuleSchema>;

export type ActivityConfigKind = "activity_type" | "activity_channel" | "activity_outcome";
export const NAME_MAX: Record<ActivityConfigKind, number> = {
  activity_type: 40,
  activity_channel: 40,
  activity_outcome: 60,
};
