"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import type { ActionResult } from "@/lib/db-errors";
import { createPipedriveClient } from "@/lib/import/pipedrive/client";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerClient } from "@/lib/supabase/server";
import {
  canDecide,
  canDiscard,
  canLink,
  canRetry,
  isLinkEntity,
  outcomeIdFor,
  outcomeMap,
  stagePipedriveIdFor,
  typeKeyFor,
  validateEdited,
  type EditedPayload,
  type LinkEntity,
  type MeetingStatus,
  type SuggestionKind,
} from "./decisions";
import { defaultMeetDeps, pipedriveIdOf, processMeeting, resolveSinkTarget } from "./run";
import { pipedriveSink, pipedriveUserFor, SinkError, type SinkTarget } from "./sink";

/**
 * Ações do vendedor sobre as reuniões do assistente. Em todas: a permissão é conferida com o cliente do
 * USUÁRIO (`can_edit_meeting`, que segue a regra do registro vinculado) e só depois a escrita acontece com o
 * cliente administrativo, porque as tabelas de reunião não têm política de escrita para o usuário.
 */

const uuid = z.string().uuid();
const DENIED = { ok: false, error: "Você não tem permissão para esta ação." } as const;
const INVALID = { ok: false, error: "Dados inválidos." } as const;
const NOT_FOUND = { ok: false, error: "Reunião não encontrada." } as const;
const BUSY = { ok: false, error: "A reunião já está sendo processada." } as const;
const MAX_ERROR_CHARS = 500;

/** Os registros mudam de tela (cartão do registro, lista de reuniões): o layout inteiro, como as demais ações. */
const refresh = () => revalidatePath("/", "layout");

type MeetingRow = {
  id: string;
  company_id: string;
  owner_id: string;
  title: string;
  started_at: string | null;
  ended_at: string | null;
  status: MeetingStatus;
  entity: LinkEntity | "organizations" | null;
  record_id: string | null;
  anchor_activity_id: string | null;
};
const MEETING_COLUMNS = "id, company_id, owner_id, title, started_at, ended_at, status, entity, record_id, anchor_activity_id";

type Admin = ReturnType<typeof createAdminClient>;

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Confere `can_edit_meeting` com o usuário e carrega a reunião com o cliente administrativo. */
async function authorize(meetingId: string): Promise<{ ok: true; db: Admin; meeting: MeetingRow } | { ok: false; error: string }> {
  if (!uuid.safeParse(meetingId).success) return INVALID;
  await requireUser();
  const supabase = await createServerClient();
  const { data: allowed, error } = await supabase.rpc("can_edit_meeting", { p_meeting: meetingId });
  if (error) return { ok: false, error: "Não foi possível conferir a permissão. Tente novamente." };
  if (allowed !== true) return DENIED;
  const db = createAdminClient();
  const { data, error: readError } = await db.from("meetings").select(MEETING_COLUMNS).eq("id", meetingId).maybeSingle();
  if (readError) return { ok: false, error: "Não foi possível ler a reunião. Tente novamente." };
  if (!data) return NOT_FOUND;
  return { ok: true, db, meeting: data as MeetingRow };
}

function pipedriveToken(): string {
  const token = process.env.PIPEDRIVE_API_TOKEN;
  if (!token) throw new Error("PIPEDRIVE_API_TOKEN não configurado.");
  return token;
}

type StageMap = Record<string, { stages: Record<string, string | null> }>;

/**
 * Etapas da última importação concluída do Pipedrive: `mappings.pipelines` e, para os funis criados pela
 * importação, `cursor.cache.pipelines` (o importador resolve nesta ordem).
 */
async function importedStagePipelines(db: Admin): Promise<{ mapped?: StageMap; cached?: StageMap }> {
  const { data, error } = await db
    .from("import_jobs")
    .select("mappings, cursor")
    .eq("source", "pipedrive")
    .eq("status", "done")
    .order("finished_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Falha ao ler as importações do Pipedrive: ${error.message}`);
  const row = data as { mappings?: { pipelines?: StageMap } | null; cursor?: { cache?: { pipelines?: StageMap } | null } | null } | null;
  return { mapped: row?.mappings?.pipelines, cached: row?.cursor?.cache?.pipelines };
}

type Suggestion = { id: string; meeting_id: string; kind: SuggestionKind; payload: unknown; status: string };

/** Erro de entrada do vendedor (corrigível): a sugestão segue pendente. */
class UserError extends Error {}

/**
 * Grava a sugestão no Pipedrive. Tudo o que pode falhar por dado do vendedor (resultado, tipo ou etapa que não
 * existem no Pipedrive) é resolvido ANTES de qualquer escrita, e vira `UserError`.
 */
async function applySuggestion(db: Admin, m: MeetingRow, kind: SuggestionKind, payload: EditedPayload): Promise<void> {
  if (!m.entity || !m.record_id || m.entity === "organizations") {
    throw new UserError("A reunião não está vinculada a um negócio, lead ou pessoa.");
  }
  const entity = m.entity;
  const token = pipedriveToken();
  const sink = pipedriveSink({ token });
  const client = createPipedriveClient({ token });
  const target: SinkTarget = await resolveSinkTarget(db, m.company_id, entity, m.record_id).catch((e) => {
    throw new UserError(message(e));
  });
  const userId = await pipedriveUserFor(db, m.owner_id);

  if (kind === "meeting_outcome") {
    const { outcome } = payload as { outcome: string };
    const fields = await client.activityFields().catch(() => []);
    const options = fields.find((f) => f.key === "outcome")?.options ?? [];
    const outcomeId = outcomeIdFor(outcome, outcomeMap(options));
    if (outcomeId == null) throw new UserError(`O resultado "${outcome}" não existe no Pipedrive.`);
    // R1: a âncora é a atividade do CRM; o id no Pipedrive vem de external_ids.
    const anchorPipedriveId = m.anchor_activity_id
      ? await pipedriveIdOf(db, m.company_id, "activities", m.anchor_activity_id)
      : null;
    await sink.completeMeeting(target, {
      anchorPipedriveId,
      outcomeId,
      subject: m.title,
      startedAt: m.started_at ?? m.ended_at ?? new Date().toISOString(),
      userId,
    });
    return;
  }

  if (kind === "next_activity") {
    const a = payload as { type: string; subject: string; due_date: string; due_time: string | null };
    const types = await client.activityTypes();
    await sink.createActivity(target, {
      typeKey: typeKeyFor(a.type, types),
      subject: a.subject,
      dueDate: a.due_date,
      dueTime: a.due_time,
      userId,
    });
    return;
  }

  // Etapa: só em negócio. O nome vira a etapa do CRM (mesmo funil do negócio) e daí o id no Pipedrive.
  if (entity !== "deals") throw new UserError("A etapa só pode ser movida em um negócio.");
  const { stage } = payload as { stage: string };
  const deal = await db.from("deals").select("pipeline_id").eq("id", m.record_id).maybeSingle();
  if (deal.error) throw new Error(`Falha ao ler o negócio: ${deal.error.message}`);
  const pipelineId = (deal.data as { pipeline_id: string } | null)?.pipeline_id;
  if (!pipelineId) throw new UserError("O negócio não foi encontrado.");
  const stages = await db.from("stages").select("id, name, archived_at").eq("pipeline_id", pipelineId);
  if (stages.error) throw new Error(`Falha ao ler as etapas do funil: ${stages.error.message}`);
  const wanted = stage.trim().toLocaleLowerCase("pt-BR");
  const crmStage = ((stages.data ?? []) as { id: string; name: string; archived_at: string | null }[]).find(
    (s) => !s.archived_at && s.name.trim().toLocaleLowerCase("pt-BR") === wanted,
  );
  if (!crmStage) throw new UserError(`A etapa "${stage}" não existe no funil deste negócio.`);
  const imported = await importedStagePipelines(db);
  const stageId = stagePipedriveIdFor(crmStage.id, imported.mapped, imported.cached);
  if (stageId == null) throw new UserError(`A etapa "${stage}" ainda não existe no Pipedrive.`);
  await sink.moveStage(target.pipedriveId, stageId);
}

/**
 * Confirma uma sugestão: grava no Pipedrive e só então vira `confirmed`. `edited` (opcional) substitui o
 * conteúdo sugerido; vale a mesma validação para os dois. Falha do Pipedrive deixa a sugestão em `failed`.
 */
export async function confirmSuggestion(id: string, edited?: unknown): Promise<ActionResult> {
  if (!uuid.safeParse(id).success) return INVALID;
  const profile = await requireUser();
  const db = createAdminClient();
  const found = await db.from("meeting_suggestions").select("id, meeting_id, kind, payload, status").eq("id", id).maybeSingle();
  if (found.error) return { ok: false, error: "Não foi possível ler a sugestão. Tente novamente." };
  const suggestion = found.data as Suggestion | null;
  if (!suggestion) return { ok: false, error: "Sugestão não encontrada." };

  const auth = await authorize(suggestion.meeting_id);
  if (!auth.ok) return auth;
  if (!canDecide(suggestion.status)) return { ok: false, error: "Esta sugestão já foi decidida." };

  const valid = validateEdited(suggestion.kind, edited ?? suggestion.payload);
  if (!valid.ok) return { ok: false, error: valid.error };

  try {
    await applySuggestion(auth.db, auth.meeting, suggestion.kind, valid.payload);
  } catch (e) {
    if (e instanceof UserError) return { ok: false, error: e.message };
    if (e instanceof SinkError) {
      const lastError = e.message.slice(0, MAX_ERROR_CHARS);
      await auth.db
        .from("meeting_suggestions")
        .update({ status: "failed", last_error: lastError, decided_by: profile.id, decided_at: new Date().toISOString() })
        .eq("id", id)
        .in("status", ["pending", "failed"]);
      refresh();
      return { ok: false, error: `Não foi possível gravar no Pipedrive: ${lastError}` };
    }
    console.error("meet: falha ao preparar a sugestão", id, message(e));
    return { ok: false, error: "Não foi possível consultar o Pipedrive. Tente novamente." };
  }

  // Só depois da gravação. Se outra confirmação ganhou a corrida, a gravação já aconteceu: não é erro.
  const saved = await auth.db
    .from("meeting_suggestions")
    .update({
      status: "confirmed",
      payload: valid.payload,
      last_error: null,
      decided_by: profile.id,
      decided_at: new Date().toISOString(),
    })
    .eq("id", id)
    .in("status", ["pending", "failed"])
    .select("id");
  if (saved.error) {
    console.error("meet: sugestão gravada no Pipedrive sem registrar a confirmação", id, saved.error.message);
    return { ok: false, error: "A sugestão foi gravada no Pipedrive, mas não foi possível registrar a confirmação." };
  }
  refresh();
  return { ok: true, data: undefined };
}

export async function dismissSuggestion(id: string): Promise<ActionResult> {
  if (!uuid.safeParse(id).success) return INVALID;
  const profile = await requireUser();
  const db = createAdminClient();
  const found = await db.from("meeting_suggestions").select("meeting_id").eq("id", id).maybeSingle();
  if (found.error) return { ok: false, error: "Não foi possível ler a sugestão. Tente novamente." };
  const meetingId = (found.data as { meeting_id: string } | null)?.meeting_id;
  if (!meetingId) return { ok: false, error: "Sugestão não encontrada." };
  const auth = await authorize(meetingId);
  if (!auth.ok) return auth;
  const { data, error } = await auth.db
    .from("meeting_suggestions")
    .update({ status: "dismissed", decided_by: profile.id, decided_at: new Date().toISOString() })
    .eq("id", id)
    .in("status", ["pending", "failed"])
    .select("id");
  if (error) return { ok: false, error: "Não foi possível descartar a sugestão. Tente novamente." };
  if (!data || data.length === 0) return { ok: false, error: "Esta sugestão já foi decidida." };
  refresh();
  return { ok: true, data: undefined };
}

/** Resultado de `processMeeting`: lê o status final e devolve o erro guardado se a reunião não concluiu. */
async function outcomeOf(db: Admin, meetingId: string, opts: { linking?: boolean } = {}): Promise<ActionResult> {
  const { data } = await db.from("meetings").select("status, last_error").eq("id", meetingId).maybeSingle();
  const row = data as { status: MeetingStatus; last_error: string | null } | null;
  refresh();
  // Ao vincular, voltar a `unlinked` significa que o registro foi para a lixeira no meio do caminho.
  if (opts.linking && row?.status === "unlinked") return { ok: false, error: "O registro foi excluído; escolha outro." };
  if (row && (row.status === "processing" || row.status === "failed")) {
    return {
      ok: false,
      error: `Não foi possível concluir agora${row.last_error ? `: ${row.last_error}` : ""}. A reunião será tentada de novo.`,
    };
  }
  return { ok: true, data: undefined };
}

/**
 * Caso calculado de "Sem vínculo": reunião `done` cujo registro vinculado foi para a lixeira (ou sumiu).
 * Só `done` com vínculo entra na conta; os demais status já dizem tudo.
 */
async function linkedRecordTrashed(db: Admin, m: MeetingRow): Promise<boolean> {
  if (m.status !== "done" || !m.entity || !m.record_id) return false;
  const { data, error } = await db.from(m.entity).select("deleted_at").eq("id", m.record_id).maybeSingle();
  if (error) throw new Error(`Falha ao ler o registro vinculado: ${error.message}`);
  const row = data as { deleted_at: string | null } | null;
  return !row || row.deleted_at != null;
}

/**
 * Vincula uma reunião sem vínculo (inclusive a concluída cujo registro foi para a lixeira) a um negócio, lead ou
 * pessoa que já existe (nunca cria registro) e roda a gravação na hora, reaproveitando as notas já geradas.
 */
export async function linkMeeting(meetingId: string, entity: "deals" | "leads" | "persons", recordId: string): Promise<ActionResult> {
  if (!uuid.safeParse(meetingId).success || !uuid.safeParse(recordId).success || !isLinkEntity(entity)) return INVALID;
  const profile = await requireUser();
  const auth = await authorize(meetingId);
  if (!auth.ok) return auth;
  const { db, meeting } = auth;
  let trashed: boolean;
  try {
    trashed = await linkedRecordTrashed(db, meeting);
  } catch (e) {
    console.error("meet: falha ao conferir o registro vinculado", meetingId, message(e));
    return { ok: false, error: "Não foi possível ler o registro vinculado. Tente novamente." };
  }
  if (!canLink(meeting, profile.id, profile.isSuperAdmin, trashed)) {
    return { ok: false, error: "Só reuniões sem vínculo podem ser vinculadas." };
  }

  // O registro: da mesma empresa, vivo, e que o usuário pode editar (conferido com o cliente dele).
  const supabase = await createServerClient();
  const editable = await supabase.rpc("can_edit_record", { p_entity: entity, p_record_id: recordId });
  if (editable.error || editable.data !== true) return DENIED;
  const rec = await db.from(entity).select("company_id, deleted_at").eq("id", recordId).maybeSingle();
  if (rec.error) return { ok: false, error: "Não foi possível ler o registro. Tente novamente." };
  const row = rec.data as { company_id: string; deleted_at: string | null } | null;
  if (!row || row.deleted_at) return { ok: false, error: "O registro não existe ou está na lixeira." };
  if (row.company_id !== meeting.company_id) return { ok: false, error: "O registro precisa ser da mesma empresa da reunião." };

  // Antes de mexer no status: sem id no Pipedrive não há onde gravar a anotação.
  try {
    await resolveSinkTarget(db, meeting.company_id, entity, recordId);
  } catch (e) {
    return { ok: false, error: `Este registro ainda não pode receber a reunião: ${message(e)}` };
  }

  // Reunião concluída: a anotação foi para o registro antigo. Solta o id da anotação (será reescrita no novo
  // registro) e apaga as sugestões não decididas; confirmadas e descartadas ficam.
  if (meeting.status === "done") {
    const note = await db.from("meeting_notes").update({ pipedrive_note_id: null, written_at: null }).eq("meeting_id", meetingId);
    const sugg = await db.from("meeting_suggestions").delete().eq("meeting_id", meetingId).in("status", ["pending", "failed"]);
    if (note.error || sugg.error) return { ok: false, error: "Não foi possível preparar a reunião para o novo vínculo. Tente novamente." };
  }

  // Troca de status condicional ANTES de processar: duas chamadas (ou o cron) não processam a mesma reunião.
  // O status esperado é o que acabou de ser verificado acima (`unlinked`, ou `done` com o registro na lixeira).
  const claimed = await db
    .from("meetings")
    .update({ status: "processing", entity, record_id: recordId, anchor_activity_id: null, attempts: 0, last_error: null })
    .eq("id", meetingId)
    .eq("status", meeting.status)
    .select("id");
  if (claimed.error) return { ok: false, error: "Não foi possível vincular a reunião. Tente novamente." };
  if (!claimed.data || claimed.data.length === 0) return BUSY;

  try {
    await processMeeting(defaultMeetDeps(db), meetingId);
  } catch (e) {
    console.error("meet: falha ao processar a reunião vinculada", meetingId, message(e));
    refresh();
    return { ok: false, error: "A reunião foi vinculada, mas a gravação falhou e será tentada de novo." };
  }
  return outcomeOf(db, meetingId, { linking: true });
}

/**
 * Descarta uma reunião sem vínculo (inclusive a concluída com o registro na lixeira) ou com falha: apaga a
 * transcrição, as notas e as sugestões e só então vira `ignored` (se uma limpeza falhar, dá para tentar de novo).
 */
export async function discardMeeting(meetingId: string): Promise<ActionResult> {
  const auth = await authorize(meetingId);
  if (!auth.ok) return auth;
  const { db, meeting } = auth;
  let trashed: boolean;
  try {
    trashed = await linkedRecordTrashed(db, meeting);
  } catch (e) {
    console.error("meet: falha ao conferir o registro vinculado", meetingId, message(e));
    return { ok: false, error: "Não foi possível ler o registro vinculado. Tente novamente." };
  }
  if (!canDiscard(meeting.status, trashed)) {
    return { ok: false, error: "Só reuniões sem vínculo ou com falha podem ser descartadas." };
  }
  const cleaned = await Promise.all([
    db.from("meeting_transcripts").delete().eq("meeting_id", meetingId),
    db.from("meeting_notes").delete().eq("meeting_id", meetingId),
    db.from("meeting_suggestions").delete().eq("meeting_id", meetingId),
  ]);
  const failed = cleaned.find((r) => r.error);
  if (failed?.error) {
    console.error("meet: falha ao apagar os dados da reunião descartada", meetingId, failed.error.message);
    return { ok: false, error: "Não foi possível apagar a transcrição. Tente novamente." };
  }
  const { data, error } = await db
    .from("meetings")
    .update({ status: "ignored" })
    .eq("id", meetingId)
    .eq("status", meeting.status)
    .select("id");
  if (error) return { ok: false, error: "Não foi possível descartar a reunião. Tente novamente." };
  if (!data || data.length === 0) return BUSY;
  refresh();
  return { ok: true, data: undefined };
}

/** Tenta de novo uma reunião com falha: zera as tentativas e processa. */
export async function retryMeeting(meetingId: string): Promise<ActionResult> {
  const auth = await authorize(meetingId);
  if (!auth.ok) return auth;
  const { db, meeting } = auth;
  if (!canRetry(meeting.status)) return { ok: false, error: "Só reuniões com falha podem ser tentadas de novo." };
  const claimed = await db
    .from("meetings")
    .update({ status: "processing", attempts: 0, last_error: null })
    .eq("id", meetingId)
    .eq("status", "failed")
    .select("id");
  if (claimed.error) return { ok: false, error: "Não foi possível tentar de novo. Tente novamente." };
  if (!claimed.data || claimed.data.length === 0) return BUSY;
  try {
    await processMeeting(defaultMeetDeps(db), meetingId);
  } catch (e) {
    console.error("meet: falha ao tentar de novo a reunião", meetingId, message(e));
    refresh();
    return { ok: false, error: "Não foi possível processar agora. A reunião será tentada de novo." };
  }
  return outcomeOf(db, meetingId);
}

/**
 * Transcrição de uma reunião, lida sob demanda ao abrir "Ver transcrição" (o texto pode ter até 1 MB e não vai
 * junto com o card). A leitura é com o cliente do USUÁRIO: a RLS (`can_read_meeting`) decide quem vê. `null`
 * quando não há transcrição, o usuário não pode lê-la ou a leitura falhou.
 */
export async function getMeetingTranscript(meetingId: string): Promise<string | null> {
  if (!uuid.safeParse(meetingId).success) return null;
  await requireUser();
  const supabase = await createServerClient();
  const { data, error } = await supabase.from("meeting_transcripts").select("text").eq("meeting_id", meetingId).maybeSingle();
  if (error) {
    console.error("meet: falha ao ler a transcrição", meetingId, error.message);
    return null;
  }
  return (data as { text: string } | null)?.text ?? null;
}
