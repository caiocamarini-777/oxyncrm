import "server-only";
import type { CompanyScope } from "@/lib/companies/pure";
import { PAGE_SIZE, recordHref, type Paged, type RecordEntity } from "@/lib/records/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerClient } from "@/lib/supabase/server";
import type { TimelineItem } from "@/lib/timeline/queries";
import { canDecide, type MeetingStatus, type SuggestionKind } from "./decisions";
import type { MeetingNotes } from "./notes";
import { isPendingOverdue, type MeetingListTab, type MeetingTabKey } from "./view";

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

// ---------------------------------------------------------------------------------------------------------------
// Página Reuniões e contador do menu
// ---------------------------------------------------------------------------------------------------------------

/**
 * Em que aba da página Reuniões a reunião cai (`null`: só aparece em "Todas"). "Sem vínculo" é `unlinked` ou o
 * caso calculado de `done` com o registro vinculado na lixeira (`recordTrashed`, verificado por quem chama), que
 * vale mais que as sugestões pendentes: a reunião precisa de outro registro antes de qualquer decisão.
 * `suggestionsPending` conta as sugestões sem decisão: `pending` e `failed`.
 */
export function meetingTab(m: { status: MeetingStatus; suggestionsPending: number; recordTrashed: boolean }): MeetingTabKey | null {
  if (m.status === "unlinked") return "sem-vinculo";
  if (m.status === "failed") return "com-erro";
  if (m.status === "done") {
    if (m.recordTrashed) return "sem-vinculo";
    if (m.suggestionsPending > 0) return "pendentes";
  }
  return null;
}

export type MeetingListRecord = {
  entity: RecordEntity;
  id: string;
  title: string;
  /** Rota do card (com o slug da empresa da reunião). */
  href: string;
};

export type MeetingListRow = {
  id: string;
  title: string;
  /** Início da reunião (ISO). Sem início, cai no fim e depois na criação. */
  startedAt: string;
  status: MeetingStatus;
  /** Aba em que a reunião cai (calculada); `null` aparece só em "Todas". */
  tab: MeetingTabKey | null;
  ownerId: string;
  ownerName: string;
  companyId: string;
  companyName: string;
  companySlug: string;
  /** Registro vinculado que existe e está vivo; `null` sem vínculo ou com o registro na lixeira. */
  record: MeetingListRecord | null;
  /** `done` cujo registro vinculado está na lixeira (ou sumiu). */
  recordTrashed: boolean;
  /** Sugestões sem decisão: `pending` e `failed`. */
  suggestionsPending: number;
  /** Sugestões sem decisão (pendentes ou com falha) há mais de 24 h, medido desde que a reunião foi concluída. */
  overdue: boolean;
  lastError: string | null;
  /** É o dono (ou admin geral): pode vincular, descartar e tentar de novo. A ação confere de novo no servidor. */
  canAct: boolean;
};

export type MeetingList = Paged<MeetingListRow> & {
  /** A leitura falhou (por exemplo, tabelas ainda não criadas): a lista vem vazia. */
  failed: boolean;
};

export type MeetingViewer = { id: string; isSuperAdmin: boolean };

type RecordInfo = { title: string; trashed: boolean };

const NAME_COLUMN: Record<RecordEntity, string> = {
  leads: "title",
  persons: "full_name",
  organizations: "name",
  deals: "title",
};

const isRecordEntity = (v: unknown): v is RecordEntity => typeof v === "string" && v in NAME_COLUMN;
const recordKey = (entity: string, id: string) => `${entity}:${id}`;

/** Quantos ids por consulta `in`, para a URL do PostgREST não estourar. */
const ID_CHUNK = 100;
/** Janela das abas calculadas (Pendentes e Sem vínculo): as mais recentes. A paginação é em memória. */
const WINDOW = 500;
/** Reuniões concluídas do usuário conferidas pelo contador do menu. */
const COUNT_WINDOW = 200;

const LIST_COLUMNS =
  "id, company_id, owner_id, title, started_at, ended_at, created_at, updated_at, status, last_error, entity, record_id, " +
  "owner:profiles!owner_id(full_name), company:companies(name, slug)";

/** Sugestões sem decisão: `pending` e também `failed` (o card ainda deixa confirmar ou descartar de novo). */
const UNDECIDED_STATUSES = ["pending", "failed"];
const countPending = (rows: unknown): number =>
  many(rows).filter((r) => isObject(r) && typeof r.status === "string" && canDecide(r.status)).length;

const MEETING_STATUSES: MeetingStatus[] = ["waiting_transcript", "processing", "unlinked", "done", "failed", "ignored"];

/**
 * Registros vinculados pelas reuniões, lidos com o cliente do usuário (a RLS esconde os da lixeira de quem não
 * pode excluir). Registro que não volta na consulta conta como na lixeira, a mesma regra das ações.
 */
async function resolveRecords(refs: { entity: RecordEntity; id: string }[]): Promise<Map<string, RecordInfo>> {
  const out = new Map<string, RecordInfo>();
  const byEntity = new Map<RecordEntity, Set<string>>();
  for (const r of refs) byEntity.set(r.entity, (byEntity.get(r.entity) ?? new Set()).add(r.id));
  if (byEntity.size === 0) return out;
  const supabase = await createServerClient();
  // Uma consulta por entidade e lote de ids, todas ao mesmo tempo: o contador do menu roda no layout de toda página.
  const lookups = [...byEntity].flatMap(([entity, idSet]) => {
    const ids = [...idSet];
    const col = NAME_COLUMN[entity];
    return Array.from({ length: Math.ceil(ids.length / ID_CHUNK) }, (_, i) =>
      Promise.resolve(
        supabase
          .from(entity)
          .select(`id, deleted_at, ${col}`)
          .in("id", ids.slice(i * ID_CHUNK, (i + 1) * ID_CHUNK)),
      ).then(({ data, error }) => {
        if (error) throw new Error(`ler ${entity}: ${error.code} ${error.message}`);
        for (const r of (data ?? []) as unknown as Record<string, unknown>[]) {
          if (typeof r.id !== "string") continue;
          out.set(recordKey(entity, r.id), { title: str(r[col]).trim(), trashed: r.deleted_at != null });
        }
      }),
    );
  });
  await Promise.all(lookups);
  return out;
}

/** Referência ao registro vinculado de uma linha de `meetings`, se houver. */
function recordRef(row: Record<string, unknown>): { entity: RecordEntity; id: string } | null {
  return isRecordEntity(row.entity) && typeof row.record_id === "string" ? { entity: row.entity, id: row.record_id } : null;
}

/**
 * Linha de `meetings` (com `owner`, `company` e `meeting_suggestions(status)` embutidos) -> linha da página.
 * `records` é o resultado de `resolveRecords` para os registros vinculados das linhas.
 */
export function toMeetingListRow(
  row: unknown,
  records: Map<string, RecordInfo>,
  viewer: MeetingViewer,
  nowMs: number,
): MeetingListRow | null {
  if (!isObject(row) || typeof row.id !== "string" || typeof row.owner_id !== "string" || typeof row.company_id !== "string") return null;
  const status = MEETING_STATUSES.find((s) => s === row.status);
  const startedAt = [row.started_at, row.ended_at, row.created_at].find((d): d is string => typeof d === "string" && d !== "");
  if (!status || !startedAt) return null;

  const ref = recordRef(row);
  const info = ref ? records.get(recordKey(ref.entity, ref.id)) : undefined;
  // Só `done` com vínculo entra na conta (mesma regra de `linkedRecordTrashed` nas ações).
  const recordTrashed = status === "done" && ref !== null && (!info || info.trashed);
  const company = one(row.company);
  const owner = one(row.owner);
  const companySlug = isObject(company) ? str(company.slug) : "";
  const suggestionsPending = countPending(row.meeting_suggestions);
  const updatedAt = typeof row.updated_at === "string" ? row.updated_at : startedAt;
  const tab = meetingTab({ status, suggestionsPending, recordTrashed });

  return {
    id: row.id,
    title: str(row.title).trim() || "Reunião do Meet",
    startedAt,
    status,
    tab,
    ownerId: row.owner_id,
    ownerName: isObject(owner) ? str(owner.full_name) : "",
    companyId: row.company_id,
    companyName: isObject(company) ? str(company.name) : "",
    companySlug,
    record:
      ref && info && !info.trashed && companySlug
        ? { entity: ref.entity, id: ref.id, title: info.title, href: recordHref(ref.entity, companySlug, ref.id) }
        : null,
    recordTrashed,
    suggestionsPending,
    overdue: tab === "pendentes" && isPendingOverdue(updatedAt, nowMs),
    lastError: typeof row.last_error === "string" && row.last_error.trim() ? row.last_error.trim() : null,
    canAct: viewer.isSuperAdmin || row.owner_id === viewer.id,
  };
}

/**
 * Reuniões da página `/[empresa]/reunioes`, as mais recentes primeiro (Pendentes: as que esperam há mais tempo).
 * Tudo pelo cliente do USUÁRIO: a RLS (`can_read_meeting`) decide o que ele vê. "Sem vínculo" e "Com erro" mostram
 * só as do próprio usuário (todas, para o admin geral). Falha em silêncio (log e lista vazia, com `failed`),
 * porque as tabelas podem não existir ainda.
 *
 * Pendentes e Sem vínculo dependem de estado calculado (registro na lixeira), então olham as 500 reuniões mais
 * recentes do alcance e paginam em memória; "Todas" pagina no banco.
 */
export async function listMeetings(scope: CompanyScope, tab: MeetingListTab, page: number, viewer: MeetingViewer): Promise<MeetingList> {
  const empty = (failed: boolean): MeetingList => ({ rows: [], total: 0, page, pageSize: PAGE_SIZE, failed });
  try {
    const supabase = await createServerClient();
    const from = (page - 1) * PAGE_SIZE;
    const nowMs = Date.now();

    // Em Pendentes, o join interno traz só as reuniões que têm sugestão pendente (e só essas sugestões).
    const suggestions = tab === "pendentes" ? "meeting_suggestions!inner(status)" : "meeting_suggestions(status)";
    let q = supabase
      .from("meetings")
      // O total exato só importa em "Todas", que pagina no banco; nas demais ele sai do filtro em memória.
      .select(`${LIST_COLUMNS}, ${suggestions}`, tab === "todas" ? { count: "exact" } : undefined)
      .neq("status", "ignored");
    if (scope.kind === "company") q = q.eq("company_id", scope.company.id);
    if (tab === "pendentes") q = q.eq("status", "done").in("meeting_suggestions.status", UNDECIDED_STATUSES);
    if (tab === "com-erro") q = q.eq("status", "failed");
    if (tab === "sem-vinculo") q = q.in("status", ["unlinked", "done"]);
    if ((tab === "com-erro" || tab === "sem-vinculo") && !viewer.isSuperAdmin) q = q.eq("owner_id", viewer.id);
    q = q.order("started_at", { ascending: false, nullsFirst: false }).order("id");
    q = tab === "todas" ? q.range(from, from + PAGE_SIZE - 1) : q.limit(WINDOW);

    const { data, error, count } = await q;
    if (error) {
      // Página além do fim: lista vazia, sem alarme.
      if (error.code === "PGRST103") return empty(false);
      console.error("[reunioes] lista:", error.code, error.message);
      return empty(true);
    }
    const raw = (data ?? []) as unknown as Record<string, unknown>[];
    const refs = raw.flatMap((r) => recordRef(r) ?? []);
    const records = await resolveRecords(refs);
    const rows = raw.flatMap((r) => toMeetingListRow(r, records, viewer, nowMs) ?? []);

    if (tab === "todas") return { rows, total: count ?? rows.length, page, pageSize: PAGE_SIZE, failed: false };

    const mine = rows.filter((r) => r.tab === tab);
    // Pendentes: a reunião mais antiga primeiro, que é a que espera há mais tempo.
    if (tab === "pendentes") mine.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
    return { rows: mine.slice(from, from + PAGE_SIZE), total: mine.length, page, pageSize: PAGE_SIZE, failed: false };
  } catch (e) {
    console.error("[reunioes] lista:", e);
    return empty(true);
  }
}

/**
 * O que espera decisão do usuário, para o contador do menu: reuniões dele sem vínculo (inclusive concluídas com o
 * registro na lixeira) e concluídas com sugestão pendente. Roda em toda página: falha em silêncio e devolve 0.
 */
export async function countMyPending(userId: string): Promise<number> {
  try {
    const supabase = await createServerClient();
    const [unlinked, done] = await Promise.all([
      supabase.from("meetings").select("id", { count: "exact", head: true }).eq("owner_id", userId).eq("status", "unlinked"),
      supabase
        .from("meetings")
        .select("id, status, entity, record_id, meeting_suggestions(status)")
        .eq("owner_id", userId)
        .eq("status", "done")
        .order("started_at", { ascending: false, nullsFirst: false })
        .limit(COUNT_WINDOW),
    ]);
    if (unlinked.error || done.error) {
      const e = unlinked.error ?? done.error;
      console.error("[reunioes] contador:", e?.code, e?.message);
      return 0;
    }
    const raw = (done.data ?? []) as unknown as Record<string, unknown>[];
    const records = await resolveRecords(raw.flatMap((r) => recordRef(r) ?? []));
    let total = unlinked.count ?? 0;
    for (const r of raw) {
      const ref = recordRef(r);
      const info = ref ? records.get(recordKey(ref.entity, ref.id)) : undefined;
      const tab = meetingTab({
        status: "done",
        suggestionsPending: countPending(r.meeting_suggestions),
        recordTrashed: ref !== null && (!info || info.trashed),
      });
      if (tab) total += 1;
    }
    return total;
  } catch (e) {
    console.error("[reunioes] contador:", e);
    return 0;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Tela inicial
// ---------------------------------------------------------------------------------------------------------------

/** Mais reuniões do que isso encerradas num mesmo dia não cabem na tela inicial. */
const ENDED_LIMIT = 50;

/**
 * Reuniões sem vínculo do próprio usuário nas empresas dadas: a mesma conta da aba Sem vínculo da página Reuniões
 * (`unlinked`, ou `done` com o registro na lixeira), só que sempre do usuário, mesmo para o admin geral. Falha em
 * silêncio (log e lista vazia), porque as tabelas podem não existir ainda.
 */
export async function listOwnUnlinkedMeetings(userId: string, companyIds: string[]): Promise<MeetingListRow[]> {
  if (companyIds.length === 0) return [];
  try {
    const supabase = await createServerClient();
    const { data, error } = await supabase
      .from("meetings")
      .select(`${LIST_COLUMNS}, meeting_suggestions(status)`)
      .in("status", ["unlinked", "done"])
      .eq("owner_id", userId)
      .in("company_id", companyIds)
      .order("started_at", { ascending: false, nullsFirst: false })
      .order("id")
      .limit(WINDOW);
    if (error) {
      console.error("[reunioes] tela inicial, sem vínculo:", error.code, error.message);
      return [];
    }
    const raw = (data ?? []) as unknown as Record<string, unknown>[];
    const records = await resolveRecords(raw.flatMap((r) => recordRef(r) ?? []));
    const viewer: MeetingViewer = { id: userId, isSuperAdmin: false };
    const nowMs = Date.now();
    return raw.flatMap((r) => toMeetingListRow(r, records, viewer, nowMs) ?? []).filter((r) => r.tab === "sem-vinculo");
  } catch (e) {
    console.error("[reunioes] tela inicial, sem vínculo:", e);
    return [];
  }
}

/** Reunião do Meet já encerrada, vinculada a um registro vivo, para a lista "Realizadas hoje" da tela inicial. */
export type EndedMeeting = {
  id: string;
  title: string;
  endedAt: string;
  status: "done" | "processing";
  /** Resumo das notas; vazio enquanto elas ainda não foram geradas. */
  summary: string;
  companyName: string;
  record: MeetingListRecord;
};

/**
 * Linha de `meetings` (com `company` e `meeting_notes(summary)` embutidos) -> reunião encerrada. Fica de fora a
 * que não aparece no card: sem vínculo, com o registro na lixeira (cai em Sem vínculo), sem fim, ou com status
 * que o card não mostra.
 */
export function toEndedMeeting(row: unknown, records: Map<string, RecordInfo>): EndedMeeting | null {
  if (!isObject(row) || typeof row.id !== "string" || typeof row.ended_at !== "string" || row.ended_at === "") return null;
  const status = VISIBLE_STATUSES.find((s) => s === row.status);
  const ref = recordRef(row);
  const info = ref ? records.get(recordKey(ref.entity, ref.id)) : undefined;
  const company = one(row.company);
  const companySlug = isObject(company) ? str(company.slug) : "";
  if (!status || !ref || !info || info.trashed || !companySlug) return null;
  const notes = one(row.meeting_notes);
  return {
    id: row.id,
    title: str(row.title).trim() || "Reunião do Meet",
    endedAt: row.ended_at,
    status,
    summary: isObject(notes) ? str(notes.summary) : "",
    companyName: isObject(company) ? str(company.name) : "",
    record: { entity: ref.entity, id: ref.id, title: info.title, href: recordHref(ref.entity, companySlug, ref.id) },
  };
}

/**
 * Reuniões do usuário nas empresas dadas que terminaram entre `start` (inclusive) e `end` (exclusive), as mais
 * recentes primeiro. Só as que o card mostra (concluídas ou em processamento, com registro vivo). Falha em
 * silêncio (log e lista vazia).
 */
export async function listOwnEndedMeetings(
  userId: string,
  companyIds: string[],
  range: { start: string; end: string },
): Promise<EndedMeeting[]> {
  if (companyIds.length === 0) return [];
  try {
    const supabase = await createServerClient();
    const { data, error } = await supabase
      .from("meetings")
      .select("id, title, status, ended_at, entity, record_id, company:companies(name, slug), meeting_notes(summary)")
      .eq("owner_id", userId)
      .in("company_id", companyIds)
      .in("status", [...VISIBLE_STATUSES])
      .gte("ended_at", range.start)
      .lt("ended_at", range.end)
      .order("ended_at", { ascending: false })
      .order("id")
      .limit(ENDED_LIMIT);
    if (error) {
      console.error("[reunioes] tela inicial, realizadas:", error.code, error.message);
      return [];
    }
    const raw = (data ?? []) as unknown as Record<string, unknown>[];
    const records = await resolveRecords(raw.flatMap((r) => recordRef(r) ?? []));
    return raw.flatMap((r) => toEndedMeeting(r, records) ?? []);
  } catch (e) {
    console.error("[reunioes] tela inicial, realizadas:", e);
    return [];
  }
}
