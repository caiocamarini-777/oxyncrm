import "server-only";
import { getCurrentProfile } from "@/lib/auth/session";
import { createServerClient } from "@/lib/supabase/server";
import type { RecordEntity } from "@/lib/records/types";
import { describeEvent } from "./describe";

export type TimelineItem = {
  kind: string;
  at: string;
  actorName: string;
  text: string;
  note?: { id: string; body: string; canEdit: boolean };
};

function fail(what: string, error: { message: string; code?: string }): never {
  console.error(`[timeline] ${what}:`, error.code, error.message);
  throw new Error(`Falha ao carregar a linha do tempo (${what}).`);
}

/** Eventos e anotações do registro, mais recente primeiro. */
export async function getTimeline(entity: RecordEntity, recordId: string): Promise<TimelineItem[]> {
  const supabase = await createServerClient();
  const profile = await getCurrentProfile();
  const [events, notes] = await Promise.all([
    supabase
      .from("timeline_events")
      .select("id, kind, actor_id, data, created_at")
      .eq("entity", entity)
      .eq("record_id", recordId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(500),
    supabase
      .from("notes")
      .select("id, body, created_by, created_at")
      .eq("entity", entity)
      .eq("record_id", recordId)
      .is("deleted_at", null),
  ]);
  if (events.error) fail("eventos", events.error);
  if (notes.error) fail("anotações", notes.error);

  const ids = new Set<string>();
  const reasonIds = new Set<string>();
  const stageIds = new Set<string>();
  const activityIds = new Set<string>();
  for (const e of events.data) {
    if (e.actor_id) ids.add(e.actor_id);
    const d = (e.data ?? {}) as Record<string, unknown>;
    for (const k of ["from", "to"]) if (e.kind === "owner_changed" && typeof d[k] === "string") ids.add(d[k] as string);
    if (typeof d.reason_id === "string") reasonIds.add(d.reason_id);
    if ((e.kind === "activity_scheduled" || e.kind === "activity_completed") && typeof d.activity_id === "string") {
      activityIds.add(d.activity_id);
    }
    if (e.kind === "stage_changed") {
      for (const k of ["from", "to"]) if (typeof d[k] === "string") stageIds.add(d[k] as string);
    }
  }
  for (const n of notes.data) ids.add(n.created_by);

  const names: Record<string, string> = {};
  if (ids.size > 0) {
    const { data, error } = await supabase.from("profiles").select("id, full_name").in("id", [...ids]);
    if (error) fail("pessoas", error);
    for (const p of data) names[p.id] = p.full_name;
  }
  if (reasonIds.size > 0) {
    const { data, error } = await supabase
      .from(entity === "deals" ? "lost_reasons" : "disqualification_reasons")
      .select("id, name")
      .in("id", [...reasonIds]);
    if (error) fail("motivos", error);
    for (const r of data) names[r.id] = r.name;
  }
  if (stageIds.size > 0) {
    const { data, error } = await supabase.from("stages").select("id, name").in("id", [...stageIds]);
    if (error) fail("etapas", error);
    for (const r of data) names[r.id] = r.name;
  }
  if (activityIds.size > 0) {
    // assunto e tipo atuais da atividade (o evento guarda só o id); sem acesso, o texto usa "atividade"
    const { data, error } = await supabase
      .from("activities")
      .select("id, subject, type:activity_types(name)")
      .in("id", [...activityIds]);
    if (error) fail("atividades", error);
    for (const a of (data ?? []) as unknown as { id: string; subject: string; type: { name: string } | { name: string }[] | null }[]) {
      names[a.id] = a.subject;
      const t = Array.isArray(a.type) ? a.type[0] : a.type;
      if (t) names[`type:${a.id}`] = t.name;
    }
  }

  const noteMap = new Map(notes.data.map((n) => [n.id, n]));
  const items: TimelineItem[] = [];
  for (const e of events.data) {
    const data = (e.data ?? {}) as Record<string, unknown>;
    const actorName = e.actor_id ? (names[e.actor_id] ?? "Alguém") : "Sistema";
    if (e.kind === "note_added") {
      const n = noteMap.get(String(data.note_id));
      if (!n) continue; // nota excluída ou removida
      items.push({
        kind: "note",
        at: e.created_at,
        actorName,
        text: "",
        note: {
          id: n.id,
          body: n.body,
          canEdit: n.created_by === profile?.id || Boolean(profile?.isSuperAdmin),
        },
      });
      continue;
    }
    items.push({ kind: e.kind, at: e.created_at, actorName, text: describeEvent({ kind: e.kind, entity, data }, names) });
  }
  return items;
}
