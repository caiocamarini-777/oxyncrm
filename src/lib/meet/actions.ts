"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import type { ActionResult } from "@/lib/db-errors";
import { hasMeetScopes } from "@/lib/gmail/connect";
import { createPipedriveClient } from "@/lib/import/pipedrive/client";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerClient } from "@/lib/supabase/server";
import {
  canDecide,
  canDiscard,
  canLink,
  canRetry,
  isLinkEntity,
  isOwnerOrAdmin,
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
import { completeCrmMeeting, createCrmActivity, CrmSinkUserError, type CrmTarget, moveCrmStage } from "./crm-sink";
import { readMeetingSettings } from "./settings";
import { defaultMeetDeps, markUnlinkedNoticesRead, pipedriveIdOf, processMeeting, resolveSinkTarget } from "./run";
import { pipedriveSink, pipedriveUserFor, SinkError, type SinkTarget } from "./sink";
import { MIRROR_ACTIVE_ERROR, meetingSinkMode, type MeetingSinkMode, mirrorActive } from "./sink-mode";

/**
 * Ações do vendedor sobre as reuniões do assistente. Em todas: a permissão é conferida com o cliente do
 * USUÁRIO (`can_edit_meeting`, que segue a regra do registro vinculado) e só depois a escrita acontece com o
 * cliente administrativo, porque as tabelas de reunião não têm política de escrita para o usuário. Vincular,
 * descartar e tentar de novo pedem ainda o dono da reunião ou o admin geral.
 * No modo CRM (`MEETING_SINK=crm`), o que a sugestão confirmada grava no CRM (atividades e etapa do negócio) também
 * vai com o cliente administrativo, depois de conferir que o vendedor pode editar o registro vinculado; a atividade
 * criada leva `created_by` = quem confirmou.
 */

const uuid = z.string().uuid();
const DENIED = { ok: false, error: "Você não tem permissão para esta ação." } as const;
const INVALID = { ok: false, error: "Dados inválidos." } as const;
const NOT_FOUND = { ok: false, error: "Reunião não encontrada." } as const;
const BUSY = { ok: false, error: "A reunião já está sendo processada." } as const;
const MAX_ERROR_CHARS = 500;
/** Nome do destino das gravações nas mensagens ao vendedor. */
const DESTINATION: Record<MeetingSinkMode, string> = { pipedrive: "Pipedrive", crm: "CRM" };

/** Os registros mudam de tela (cartão do registro, lista de reuniões): o layout inteiro, como as demais ações. */
const refresh = () => revalidatePath("/", "layout");

type MeetingRow = {
  id: string;
  company_id: string;
  account_id: string | null;
  owner_id: string;
  title: string;
  started_at: string | null;
  ended_at: string | null;
  status: MeetingStatus;
  entity: LinkEntity | "organizations" | null;
  record_id: string | null;
  anchor_activity_id: string | null;
};
const MEETING_COLUMNS =
  "id, company_id, account_id, owner_id, title, started_at, ended_at, status, entity, record_id, anchor_activity_id";

type Admin = ReturnType<typeof createAdminClient>;

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

type Authorized = { ok: true; db: Admin; meeting: MeetingRow; profile: Awaited<ReturnType<typeof requireUser>> };

/** Confere `can_edit_meeting` com o usuário e carrega a reunião com o cliente administrativo. */
async function authorize(meetingId: string): Promise<Authorized | { ok: false; error: string }> {
  if (!uuid.safeParse(meetingId).success) return INVALID;
  const profile = await requireUser();
  const supabase = await createServerClient();
  const { data: allowed, error } = await supabase.rpc("can_edit_meeting", { p_meeting: meetingId });
  if (error) return { ok: false, error: "Não foi possível conferir a permissão. Tente novamente." };
  if (allowed !== true) return DENIED;
  const db = createAdminClient();
  const { data, error: readError } = await db.from("meetings").select(MEETING_COLUMNS).eq("id", meetingId).maybeSingle();
  if (readError) return { ok: false, error: "Não foi possível ler a reunião. Tente novamente." };
  if (!data) return NOT_FOUND;
  return { ok: true, db, meeting: data as MeetingRow, profile };
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
 * Modo CRM: grava a sugestão direto no CRM com o cliente administrativo (as travas do usuário logado ficam de fora:
 * a reunião de outro dono, a conclusão automática), depois de conferir com o cliente do USUÁRIO que ele pode editar
 * o registro vinculado. A atividade criada leva `created_by` = `actorId` (quem confirmou).
 * - Com o espelho do Pipedrive ativo, não grava (o Pipedrive apagaria): `UserError` com o aviso.
 * - Organização recebe o resultado e a próxima atividade; a etapa é só de negócio.
 * - Tipo, resultado ou etapa que não existem no CRM, campo obrigatório da etapa faltando e reunião já concluída com
 *   outro resultado: `CrmSinkUserError`.
 */
async function applyToCrm(
  db: Admin,
  m: MeetingRow,
  kind: SuggestionKind,
  payload: EditedPayload,
  actorId: string,
): Promise<void> {
  if (await mirrorActive(db, new Date())) throw new UserError(MIRROR_ACTIVE_ERROR);
  if (!m.entity || !m.record_id) throw new UserError("A reunião não está vinculada a um registro do CRM.");
  if (kind === "stage" && m.entity !== "deals") throw new UserError("A etapa só pode ser movida em um negócio.");
  const rec = await db.from(m.entity).select("deleted_at").eq("id", m.record_id).maybeSingle();
  if (rec.error) throw new Error(`Falha ao ler o registro vinculado: ${rec.error.message}`);
  const row = rec.data as { deleted_at: string | null } | null;
  if (!row || row.deleted_at) throw new UserError("O registro não existe ou está na lixeira.");
  // As gravações abaixo passam por cima do RLS: a permissão do vendedor no registro vinculado vale aqui.
  const supabase = await createServerClient();
  const editable = await supabase.rpc("can_edit_record", { p_entity: m.entity, p_record_id: m.record_id });
  if (editable.error) throw new Error(`Falha ao conferir a permissão no registro: ${editable.error.message}`);
  if (editable.data !== true) throw new UserError(DENIED.error);

  const target: CrmTarget = { companyId: m.company_id, entity: m.entity, recordId: m.record_id };

  if (kind === "meeting_outcome") {
    const { outcome } = payload as { outcome: string };
    const created = await completeCrmMeeting(db, target, {
      anchorActivityId: m.anchor_activity_id,
      outcomeLabel: outcome,
      subject: m.title,
      startedAt: m.started_at ?? m.ended_at ?? new Date().toISOString(),
      ownerId: m.owner_id,
      actorId,
    });
    // A reunião criada vira a âncora: repetir a confirmação (resposta perdida, confirmação não registrada) a encontra
    // concluída e não cria outra. Falhar aqui não desfaz a gravação, que já aconteceu.
    if (created) {
      const anchored = await db.from("meetings").update({ anchor_activity_id: created }).eq("id", m.id);
      if (anchored.error) console.error("meet: reunião criada no CRM sem virar a âncora", m.id, created, anchored.error.message);
    }
    return;
  }

  if (kind === "next_activity") {
    const a = payload as { type: string; subject: string; due_date: string; due_time: string | null };
    await createCrmActivity(db, target, {
      type: a.type,
      subject: a.subject,
      dueDate: a.due_date,
      dueTime: a.due_time,
      ownerId: m.owner_id,
      actorId,
      anchorActivityId: m.anchor_activity_id,
    });
    return;
  }

  const { stage } = payload as { stage: string };
  await moveCrmStage(db, m.record_id, stage);
}

/**
 * Grava a sugestão no destino do modo: no CRM (`applyToCrm`) ou no Pipedrive. No Pipedrive, tudo o que pode falhar
 * por dado do vendedor (resultado, tipo ou etapa que não existem no Pipedrive) é resolvido ANTES de qualquer
 * escrita, e vira `UserError`.
 */
async function applySuggestion(
  db: Admin,
  m: MeetingRow,
  kind: SuggestionKind,
  payload: EditedPayload,
  mode: MeetingSinkMode,
  actorId: string,
): Promise<void> {
  if (mode === "crm") return applyToCrm(db, m, kind, payload, actorId);
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
 * Confirma uma sugestão: grava no destino do modo (`MEETING_SINK`: Pipedrive ou CRM) e só então vira `confirmed`.
 * `edited` (opcional) substitui o conteúdo sugerido; vale a mesma validação para os dois. Falha na gravação que o
 * vendedor resolve (`SinkError` do Pipedrive, `CrmSinkUserError` do CRM) deixa a sugestão em `failed` com a
 * mensagem; `UserError` e falha técnica deixam como estava.
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

  const mode = meetingSinkMode();
  try {
    await applySuggestion(auth.db, auth.meeting, suggestion.kind, valid.payload, mode, profile.id);
  } catch (e) {
    if (e instanceof UserError) return { ok: false, error: e.message };
    if (e instanceof SinkError || e instanceof CrmSinkUserError) {
      const lastError = e.message.slice(0, MAX_ERROR_CHARS);
      await auth.db
        .from("meeting_suggestions")
        .update({ status: "failed", last_error: lastError, decided_by: profile.id, decided_at: new Date().toISOString() })
        .eq("id", id)
        .in("status", ["pending", "failed"]);
      refresh();
      return { ok: false, error: `Não foi possível gravar no ${DESTINATION[mode]}: ${lastError}` };
    }
    console.error("meet: falha ao preparar a sugestão", id, message(e));
    // No CRM, a falha técnica pode ser da própria gravação; no Pipedrive, só da preparação (o SinkError é tratado acima).
    const error =
      mode === "crm"
        ? "Não foi possível gravar no CRM. Tente novamente."
        : "Não foi possível consultar o Pipedrive. Tente novamente.";
    return { ok: false, error };
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
    console.error("meet: sugestão gravada sem registrar a confirmação", mode, id, saved.error.message);
    return {
      ok: false,
      error: `A sugestão foi gravada no ${DESTINATION[mode]}, mas não foi possível registrar a confirmação.`,
    };
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

  // Antes de mexer no status. No Pipedrive, sem id lá não há onde gravar a anotação; no CRM, basta o registro vivo
  // conferido acima.
  const mode = meetingSinkMode();
  if (mode === "pipedrive") {
    try {
      await resolveSinkTarget(db, meeting.company_id, entity, recordId);
    } catch (e) {
      return { ok: false, error: `Este registro ainda não pode receber a reunião: ${message(e)}` };
    }
  }

  // Reunião concluída: a anotação foi para o registro antigo. Solta o id da anotação (ela será reescrita no novo
  // registro) e apaga as sugestões não decididas; confirmadas e descartadas ficam. No CRM, a anotação antiga vai
  // antes para a lixeira (escondida no histórico só enquanto o `crm_note_id` apontava para ela, voltaria se o registro
  // antigo saísse da lixeira), e as duas colunas são soltas: lá, `pipedrive_note_id` preenchido também conta como
  // gravada.
  if (meeting.status === "done") {
    const prepareFailed = { ok: false, error: "Não foi possível preparar a reunião para o novo vínculo. Tente novamente." } as const;
    if (mode === "crm") {
      const old = await db.from("meeting_notes").select("crm_note_id").eq("meeting_id", meetingId).maybeSingle();
      if (old.error) return prepareFailed;
      const oldNoteId = (old.data as { crm_note_id: string | null } | null)?.crm_note_id;
      if (oldNoteId) {
        const trashed = await db.from("notes").update({ deleted_at: new Date().toISOString() }).eq("id", oldNoteId).is("deleted_at", null);
        if (trashed.error) return prepareFailed;
      }
    }
    const released = mode === "crm" ? { crm_note_id: null, pipedrive_note_id: null } : { pipedrive_note_id: null };
    const note = await db.from("meeting_notes").update({ ...released, written_at: null }).eq("meeting_id", meetingId);
    const sugg = await db.from("meeting_suggestions").delete().eq("meeting_id", meetingId).in("status", ["pending", "failed"]);
    if (note.error || sugg.error) return prepareFailed;
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
 * Só o dono da reunião ou o admin geral.
 */
export async function discardMeeting(meetingId: string): Promise<ActionResult> {
  const auth = await authorize(meetingId);
  if (!auth.ok) return auth;
  const { db, meeting, profile } = auth;
  if (!isOwnerOrAdmin(meeting, profile.id, profile.isSuperAdmin)) return DENIED;
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
  // Resolvida: o aviso de "sem vínculo" do sino deixa de pedir decisão.
  await markUnlinkedNoticesRead(db, [meetingId], new Date());
  refresh();
  return { ok: true, data: undefined };
}

/**
 * Sem transcrição guardada, "Tentar de novo" só serve se o cron puder buscá-la: a caixa que trouxe a reunião
 * ativa e com os acessos do Meet, e o assistente ligado na empresa. `null` quando pode; senão, o motivo.
 */
async function cannotFetchAgain(db: Admin, m: MeetingRow): Promise<string | null> {
  const [account, company] = await Promise.all([
    m.account_id
      ? db.from("email_accounts").select("status, scopes").eq("id", m.account_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    db.from("companies").select("settings").eq("id", m.company_id).maybeSingle(),
  ]);
  if (account.error || company.error) return "Não foi possível ler a reunião. Tente novamente.";
  const acc = account.data as { status: string; scopes: string[] | null } | null;
  if (!acc || acc.status !== "active" || !hasMeetScopes(acc.scopes ?? [])) {
    return "A caixa do Google que trouxe esta reunião está desconectada ou sem acesso ao Meet. Reconecte-a no módulo E-mail e tente de novo.";
  }
  if (!readMeetingSettings((company.data as { settings?: unknown } | null)?.settings).enabled) {
    return "O assistente de reuniões está desligado nesta empresa.";
  }
  return null;
}

/**
 * Tenta de novo uma reunião com falha. Com a transcrição guardada (falhou o Claude ou o Pipedrive): zera as
 * tentativas e processa na hora. Sem ela (o Google não deixou ler a reunião, ou a transcrição não apareceu no
 * prazo): não há o que processar; a reunião volta a esperar a transcrição, e a próxima rodada do cron relê a
 * reunião e busca a transcrição de novo. Só o dono da reunião ou o admin geral.
 */
export async function retryMeeting(meetingId: string): Promise<ActionResult<{ message: string }>> {
  const auth = await authorize(meetingId);
  if (!auth.ok) return auth;
  const { db, meeting, profile } = auth;
  if (!isOwnerOrAdmin(meeting, profile.id, profile.isSuperAdmin)) return DENIED;
  if (!canRetry(meeting.status)) return { ok: false, error: "Só reuniões com falha podem ser tentadas de novo." };

  const transcript = await db.from("meeting_transcripts").select("meeting_id").eq("meeting_id", meetingId).maybeSingle();
  if (transcript.error) return { ok: false, error: "Não foi possível ler a reunião. Tente novamente." };
  if (!transcript.data) {
    const blocked = await cannotFetchAgain(db, meeting);
    if (blocked) return { ok: false, error: blocked };
    const requeued = await db
      .from("meetings")
      .update({ status: "waiting_transcript", attempts: 0, last_error: null })
      .eq("id", meetingId)
      .eq("status", "failed")
      .select("id");
    if (requeued.error) return { ok: false, error: "Não foi possível tentar de novo. Tente novamente." };
    if (!requeued.data || requeued.data.length === 0) return BUSY;
    refresh();
    return {
      ok: true,
      data: { message: "Vamos buscar a transcrição (ou as anotações do Gemini) de novo na próxima rodada." },
    };
  }

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
  const outcome = await outcomeOf(db, meetingId);
  return outcome.ok ? { ok: true, data: { message: "Reunião processada." } } : outcome;
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
