import "server-only";
import { createServerClient } from "@/lib/supabase/server";
import { fail } from "@/lib/records/list-helpers";
import { toNextActivity, type NextActivity } from "./next";

/** Próxima atividade aberta de cada registro, em uma única consulta (`next_activity_for`). */
export async function loadNextActivities(
  entity: "leads" | "deals",
  ids: string[],
  now: Date = new Date(),
): Promise<Map<string, NextActivity>> {
  const out = new Map<string, NextActivity>();
  if (ids.length === 0) return out;
  const supabase = await createServerClient();
  const { data, error } = await supabase.rpc("next_activity_for", { p_entity: entity, p_ids: ids });
  if (error) fail(entity, "próxima atividade", error);
  for (const r of data ?? []) {
    out.set(r.record_id, toNextActivity({ activityId: r.activity_id, dueAt: r.due_at, subject: r.subject }, now));
  }
  return out;
}

/** Canal da atividade concluída mais recente de cada lead. */
export async function loadLastChannels(leadIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (leadIds.length === 0) return out;
  const supabase = await createServerClient();
  const { data, error } = await supabase.rpc("last_channel_for", { p_ids: leadIds });
  if (error) fail("leads", "último canal", error);
  for (const r of data ?? []) out.set(r.lead_id, r.channel_name);
  return out;
}
