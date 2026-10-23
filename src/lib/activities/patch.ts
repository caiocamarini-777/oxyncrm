import { MSG_LINK, type ActivityData, type ActivityInput } from "./schema";

export type CurrentActivity = {
  done: boolean;
  lead_id: string | null;
  deal_id: string | null;
  person_id: string | null;
  organization_id: string | null;
};

const LINKS = [
  ["leadId", "lead_id"],
  ["dealId", "deal_id"],
  ["personId", "person_id"],
  ["organizationId", "organization_id"],
] as const;

/**
 * Campos da edição. Vínculo ausente no input (undefined) fica como está no banco, inclusive os que o
 * usuário não enxerga; só `null` explícito remove. Exige ao menos um vínculo no resultado mesclado.
 */
export function buildActivityPatch(
  d: ActivityData,
  raw: ActivityInput,
  current: CurrentActivity,
): { ok: true; patch: Record<string, unknown> } | { ok: false; error: string } {
  const patch: Record<string, unknown> = {
    type_id: d.typeId,
    channel_id: d.channelId,
    subject: d.subject,
    description: d.description,
    due_at: d.dueAt,
    duration_minutes: d.durationMinutes,
    reminder_minutes: d.reminderMinutes,
  };
  if (current.done) {
    // tipo e canal de uma atividade concluída não mudam
    delete patch.type_id;
    delete patch.channel_id;
  }
  let remaining = false;
  for (const [key, col] of LINKS) {
    if (raw[key] !== undefined) {
      patch[col] = d[key];
      remaining ||= d[key] !== null;
    } else {
      remaining ||= current[col] !== null;
    }
  }
  if (!remaining) return { ok: false, error: MSG_LINK };
  return { ok: true, patch };
}
