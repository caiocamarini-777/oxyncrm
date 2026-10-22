import type { ActivityRow } from "@/lib/activities/queries";
import type { ActivityInput, NextActivityInput } from "@/lib/activities/schema";
import { toLocalInput } from "@/lib/activities/time";
import type { RecordLinks } from "@/lib/activities/record-context";
import type { FormValues } from "./activity-form";

const HOUR = 3_600_000;

/** Próxima hora cheia (opcionalmente alguns dias depois), no formato do campo de data e hora. */
export function defaultDue(nowIso: string, addDays = 0): string {
  const t = Math.floor(new Date(nowIso).getTime() / HOUR) * HOUR + HOUR + addDays * 24 * HOUR;
  return toLocalInput(new Date(t));
}

/** Criação: vínculos do registro atual mais a pessoa e a organização escolhidas no formulário. */
export function toCreateInput(v: FormValues, links: RecordLinks): ActivityInput {
  return {
    typeId: v.typeId,
    channelId: v.channelId,
    subject: v.subject,
    description: v.description,
    dueAt: v.dueAt,
    durationMinutes: v.durationMinutes,
    reminderMinutes: v.reminderMinutes,
    ownerId: v.ownerId,
    leadId: links.leadId,
    dealId: links.dealId,
    personId: links.personId ?? v.person?.id ?? null,
    organizationId: links.organizationId ?? v.organization?.id ?? null,
  };
}

/** Edição: vínculo que o usuário não mexeu segue `undefined` (o servidor preserva, inclusive os ocultos). */
export function toEditInput(v: FormValues): ActivityInput {
  return {
    typeId: v.typeId,
    channelId: v.channelId,
    subject: v.subject,
    description: v.description,
    dueAt: v.dueAt,
    durationMinutes: v.durationMinutes,
    reminderMinutes: v.reminderMinutes,
    ownerId: v.ownerId,
    personId: v.person === undefined ? undefined : (v.person?.id ?? null),
    organizationId: v.organization === undefined ? undefined : (v.organization?.id ?? null),
  };
}

export function toNextInput(v: FormValues): NextActivityInput {
  return {
    typeId: v.typeId,
    channelId: v.channelId,
    subject: v.subject,
    dueAt: v.dueAt,
    durationMinutes: v.durationMinutes,
    reminderMinutes: v.reminderMinutes,
    ownerId: v.ownerId,
  };
}

/** Vínculos crus da atividade de origem (a próxima sugerida herda todos). */
export function linksOf(a: ActivityRow): RecordLinks {
  return { leadId: a.leadId, dealId: a.dealId, personId: a.personId, organizationId: a.organizationId };
}
