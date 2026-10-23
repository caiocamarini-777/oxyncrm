import { z } from "zod";
import { REMINDER_MINUTES } from "./reminders";
import { toUtc } from "./time";

export const MEETING_OUTCOMES = ["held", "no_show", "rescheduled", "canceled"] as const;
export type MeetingOutcome = (typeof MEETING_OUTCOMES)[number];
export const MEETING_OUTCOME_LABELS: Record<MeetingOutcome, string> = {
  held: "Realizada",
  no_show: "No-show",
  rescheduled: "Remarcada",
  canceled: "Cancelada",
};

export const MSG_LINK = "Vincule a atividade a um lead, negócio, pessoa ou organização.";

const optionalUuid = z
  .string()
  .uuid()
  .optional()
  .nullable()
  .transform((v) => v ?? null);

/** `YYYY-MM-DDTHH:mm` na hora de São Paulo; sai em ISO UTC. */
const localDateTime = z
  .string({ message: "Informe a data e a hora." })
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "Informe a data e a hora.")
  .transform((v, ctx) => {
    try {
      return toUtc(v);
    } catch {
      ctx.addIssue({ code: "custom", message: "Informe a data e a hora." });
      return z.NEVER;
    }
  });

const subject = z.string().trim().min(1, "Informe o assunto.").max(200, "Use no máximo 200 caracteres.");

const reminder = z
  .number()
  .nullable()
  .optional()
  .transform((v) => v ?? null)
  .refine((v) => v === null || REMINDER_MINUTES.includes(v), "Escolha uma opção de lembrete.");

const activityBase = z.object({
  typeId: z.string({ message: "Escolha o tipo." }).uuid("Escolha o tipo."),
  channelId: z.string({ message: "Escolha o canal." }).uuid("Escolha o canal."),
  subject,
  description: z
    .string()
    .trim()
    .max(5000, "Use no máximo 5.000 caracteres.")
    .optional()
    .nullable()
    .transform((v) => (v ? v : null)),
  dueAt: localDateTime,
  durationMinutes: z
    .number({ message: "Informe a duração." })
    .int("Informe a duração em minutos.")
    .min(0, "A duração não pode ser negativa.")
    .max(1440, "A duração máxima é de 24 horas.")
    .default(30),
  reminderMinutes: reminder,
  ownerId: z.string().uuid().optional(),
  leadId: optionalUuid,
  dealId: optionalUuid,
  personId: optionalUuid,
  organizationId: optionalUuid,
});

/** Edição: vínculos ausentes ficam como estão; a regra "ao menos um" vale sobre o resultado mesclado. */
export const activityEditSchema = activityBase;

export const activitySchema = activityBase.refine(
  (a) => Boolean(a.leadId || a.dealId || a.personId || a.organizationId),
  { message: MSG_LINK, path: ["links"] },
);
export type ActivityInput = z.input<typeof activitySchema>;
export type ActivityData = z.output<typeof activitySchema>;

/** Próxima atividade: mesmos campos da atividade, sem vínculos (herda os da origem). */
export const nextActivitySchema = activityBase.pick({
  typeId: true,
  channelId: true,
  subject: true,
  dueAt: true,
  durationMinutes: true,
  reminderMinutes: true,
  ownerId: true,
});
export type NextActivityInput = z.input<typeof nextActivitySchema>;

/** Reunião agendada pelo resultado: assunto e data; o tipo é opcional (primeiro tipo de reunião ativo). */
export const meetingSchema = activityBase.pick({ subject: true, dueAt: true }).extend({
  typeId: z.string().uuid().optional(),
  durationMinutes: activityBase.shape.durationMinutes.optional(),
});
export type MeetingInput = z.input<typeof meetingSchema>;

export const completeSchema = z
  .object({
    /** O tipo da atividade é de reunião (decide qual resultado vale). */
    isMeeting: z.boolean(),
    outcomeId: z.string().uuid("Informe o resultado da atividade.").optional().nullable(),
    meetingOutcome: z.enum(MEETING_OUTCOMES, { message: "Informe o resultado da reunião." }).optional().nullable(),
    note: z
      .string()
      .trim()
      .max(2000, "Use no máximo 2.000 caracteres.")
      .optional()
      .nullable()
      .transform((v) => (v ? v : null)),
    meeting: meetingSchema.optional().nullable(),
    next: nextActivitySchema.optional().nullable(),
  })
  .superRefine((v, ctx) => {
    if (v.isMeeting && !v.meetingOutcome) {
      ctx.addIssue({ code: "custom", message: "Informe o resultado da reunião.", path: ["meetingOutcome"] });
    }
    if (!v.isMeeting && !v.outcomeId) {
      ctx.addIssue({ code: "custom", message: "Informe o resultado da atividade.", path: ["outcomeId"] });
    }
  });
export type CompleteInput = z.input<typeof completeSchema>;
export type CompleteData = z.output<typeof completeSchema>;
