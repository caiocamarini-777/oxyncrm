import { recordHref } from "@/lib/records/types";

export type ReminderLinks = {
  deal_id: string | null;
  lead_id: string | null;
  person_id: string | null;
  organization_id: string | null;
};

/** Destino do lembrete: vínculo principal (negócio, lead, pessoa, organização) ou a lista de atividades. */
export function reminderPath(slug: string | null, a: ReminderLinks | null): string {
  if (!slug) return "/";
  if (a?.deal_id) return recordHref("deals", slug, a.deal_id);
  if (a?.lead_id) return recordHref("leads", slug, a.lead_id);
  if (a?.person_id) return recordHref("persons", slug, a.person_id);
  if (a?.organization_id) return recordHref("organizations", slug, a.organization_id);
  return `/${slug}/atividades`;
}
