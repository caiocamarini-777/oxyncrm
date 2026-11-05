import "server-only";
import type { RecordEntity } from "@/lib/records/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerClient } from "@/lib/supabase/server";
import type { TimelineItem } from "@/lib/timeline/queries";
import type { SuggestionKind } from "./decisions";
import type { MeetingNotes } from "./notes";

/**
 * Leituras das reuniões do assistente para o histórico do card. Tudo pelo cliente do USUÁRIO (a RLS de
 * `meetings` e filhas segue a visibilidade do registro vinculado); a única exceção é `external_ids`, que só o
 * admin geral lê e é consultada com o cliente administrativo apenas para casar ids.
 *
 * As tabelas podem ainda não existir no banco (migration não aplicada): as leituras falham em silêncio e
 * devolvem vazio, para a página do registro nunca quebrar por causa da reunião.
 */

/** O card mostra só reuniões vinculadas e já com transcrição; `unlinked`, `failed` e `ignored` ficam de fora. */
const VISIBLE_STATUSES = ["done", "processing"] as const;
const MAX_MEETINGS = 50;

export type RecordMeetingNotes = Omit<MeetingNotes, "suggestions">;
export type SuggestionStatus = "pending" | "confirmed" | "dismissed" | "failed";
export type RecordMeetingSuggestion = {
  id: string;
  kind: SuggestionKind;
  /** JSON guardado pelo assistente, conforme o `kind` (validado só na hora de usar). */
  payload: unknown;
  status: SuggestionStatus;
  lastError: string | null;
};

export type RecordMeeting = {
  id: string;
  title: string;
  /** Início da reunião (ISO). Sem início, cai no fim e depois na criação. */
  startedAt: string;
  status: "done" | "processing";
  /** Nulo enquanto as notas ainda não foram geradas. */
  notes: RecordMeetingNotes | null;
  suggestions: RecordMeetingSuggestion[];
  hasTranscript: boolean;
  /** O usuário pode decidir as sugestões (confirmar, editar, descartar). A ação confere de novo no servidor. */
  canEdit: boolean;
};

const KIND_ORDER: SuggestionKind[] = ["meeting_outcome", "next_activity", "stage"];
const STATUSES: SuggestionStatus[] = ["pending", "confirmed", "dismissed", "failed"];

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
/** Relação embutida do PostgREST: objeto (um para um) ou lista, conforme a chave. */
const one = (v: unknown): unknown => (Array.isArray(v) ? v[0] : v);
const many = (v: unknown): unknown[] => (Array.isArray(v) ? v : v == null ? [] : [v]);
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/** Notas vindas do JSON do banco: tolera formato fora do esperado e descarta o que não serve. */
function toNotes(row: unknown): RecordMeetingNotes | null {
  if (!isObject(row)) return null;
  const qualification: RecordMeetingNotes["qualification"] = [];
  for (const q of many(row.qualification)) {
    if (isObject(q) && typeof q.question === "string" && typeof q.answer === "string") {
      qualification.push({ question: q.question, answer: q.answer });
    }
  }
  const nextSteps: RecordMeetingNotes["next_steps"] = [];
  for (const s of many(row.next_steps)) {
    if (isObject(s) && typeof s.what === "string") {
      nextSteps.push({ what: s.what, owner: str(s.owner), due: typeof s.due === "string" ? s.due : null });
    }
  }
  return {
    summary: str(row.summary),
    pains: strings(row.pains),
    objections: strings(row.objections),
    qualification,
    next_steps: nextSteps,
  };
}

function toSuggestions(rows: unknown): RecordMeetingSuggestion[] {
  const out: RecordMeetingSuggestion[] = [];
  for (const r of many(rows)) {
    if (!isObject(r) || typeof r.id !== "string") continue;
    const kind = KIND_ORDER.find((k) => k === r.kind);
    const status = STATUSES.find((s) => s === r.status);
    if (!kind || !status) continue;
    out.push({ id: r.id, kind, payload: r.payload ?? {}, status, lastError: typeof r.last_error === "string" ? r.last_error : null });
  }
  // Ordem fixa (resultado, próxima atividade, etapa); o sort é estável.
  return out.sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));
}

/** Linha de `meetings` (com `meeting_notes`, `meeting_suggestions` e `meeting_transcripts` embutidos) -> reunião do card. */
export function toRecordMeeting(row: unknown, canEdit: boolean): RecordMeeting | null {
  if (!isObject(row) || typeof row.id !== "string") return null;
  const status = VISIBLE_STATUSES.find((s) => s === row.status);
  const startedAt = [row.started_at, row.ended_at, row.created_at].find((d): d is string => typeof d === "string" && d !== "");
  if (!status || !startedAt) return null;
  return {
    id: row.id,
    title: str(row.title).trim() || "Reunião do Meet",
    startedAt,
    status,
    notes: toNotes(one(row.meeting_notes)),
    suggestions: toSuggestions(row.meeting_suggestions),
    hasTranscript: isObject(one(row.meeting_transcripts)),
    canEdit,
  };
}

// `meeting_transcripts(meeting_id)`: só a chave, para saber se existe sem trazer o texto (até 1 MB).
const MEETING_COLUMNS =
  "id, title, started_at, ended_at, created_at, status, " +
  "meeting_notes(summary, pains, objections, qualification, next_steps), " +
  "meeting_suggestions(id, kind, payload, status, last_error), " +
  "meeting_transcripts(meeting_id)";

/**
 * Reuniões do Meet mostradas no histórico do registro, da mais recente para a mais antiga. Falha em silêncio
 * (log e lista vazia), para a página do registro não quebrar.
 */
export async function getRecordMeetings(entity: RecordEntity, recordId: string): Promise<RecordMeeting[]> {
  try {
    const supabase = await createServerClient();
    const { data, error } = await supabase
      .from("meetings")
      .select(MEETING_COLUMNS)
      .eq("entity", entity)
      .eq("record_id", recordId)
      .in("status", [...VISIBLE_STATUSES])
      .order("started_at", { ascending: false, nullsFirst: false })
      .limit(MAX_MEETINGS);
    if (error) {
      console.error("[reunioes] card:", error.code, error.message);
      return [];
    }
    if (!data || data.length === 0) return [];
    // Mesma regra de `can_edit_meeting` para reunião vinculada a registro vivo: a permissão do registro.
    const editable = await supabase.rpc("can_edit_record", { p_entity: entity, p_record_id: recordId });
    const canEdit = !editable.error && editable.data === true;
    return (data as unknown[]).flatMap((row) => toRecordMeeting(row, canEdit) ?? []);
  } catch (e) {
    console.error("[reunioes] card:", e);
    return [];
  }
}

/**
 * Ids, no Pipedrive, das anotações gravadas pelo assistente nas reuniões mostradas no card (como texto, porque
 * `pipedrive_note_id` é bigint). Falha em silêncio: sem eles, nada é escondido.
 */
export async function getMeetingNotePipedriveIds(entity: RecordEntity, recordId: string): Promise<Set<string>> {
  try {
    const supabase = await createServerClient();
    const { data, error } = await supabase
      .from("meeting_notes")
      .select("pipedrive_note_id, meetings!inner(entity, record_id, status)")
      .eq("meetings.entity", entity)
      .eq("meetings.record_id", recordId)
      .in("meetings.status", [...VISIBLE_STATUSES])
      .not("pipedrive_note_id", "is", null);
    if (error) {
      console.error("[reunioes] anotações do Pipedrive:", error.code, error.message);
      return new Set();
    }
    const ids = ((data ?? []) as { pipedrive_note_id: number | string | null }[])
      .map((r) => r.pipedrive_note_id)
      .filter((id): id is number | string => id != null)
      .map(String);
    return new Set(ids);
  } catch (e) {
    console.error("[reunioes] anotações do Pipedrive:", e);
    return new Set();
  }
}

/**
 * Entre os ids de anotação do Pipedrive dados, quais já foram importados como anotação do CRM:
 * `notes.id` -> id no Pipedrive. `external_ids` só é legível pelo admin geral, por isso o cliente administrativo;
 * a consulta é limitada aos ids das reuniões do próprio card e só devolve ids. Falha em silêncio.
 */
export async function importedNoteExternalIds(pipedriveIds: Set<string>): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (pipedriveIds.size === 0) return out;
  try {
    const { data, error } = await createAdminClient()
      .from("external_ids")
      .select("external_id, record_id")
      .eq("source", "pipedrive")
      .eq("entity", "notes")
      .in("external_id", [...pipedriveIds]);
    if (error) {
      console.error("[reunioes] anotações importadas:", error.code, error.message);
      return out;
    }
    for (const r of (data ?? []) as { external_id: string; record_id: string }[]) out.set(r.record_id, r.external_id);
  } catch (e) {
    console.error("[reunioes] anotações importadas:", e);
  }
  return out;
}

/**
 * Esconde do histórico as anotações importadas do Pipedrive que o assistente gravou: o bloco da reunião já
 * mostra o mesmo conteúdo. Só anotações com `externalId` no conjunto saem; o resto fica.
 */
export function hideMeetingNotes(items: TimelineItem[], meetingNotePipedriveIds: Set<string>): TimelineItem[] {
  if (meetingNotePipedriveIds.size === 0) return items;
  return items.filter((i) => !(i.note && i.externalId !== undefined && meetingNotePipedriveIds.has(i.externalId)));
}
