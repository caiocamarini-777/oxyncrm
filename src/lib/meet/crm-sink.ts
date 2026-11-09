/**
 * Gravações do assistente de reuniões direto no CRM (destino depois da virada, com `MEETING_SINK=crm`), com os ids
 * do CRM. A anotação vem do cron: cliente admin, autoria do dono da reunião. Conclusão da reunião, próxima atividade e
 * etapa vêm de sugestões confirmadas e usam o cliente do USUÁRIO que confirmou (RLS e gatilhos normais; o histórico
 * registra quem confirmou).
 * Sem tentativas aqui: escrever é efeito colateral (repetir duplicaria nota/atividade), então quem chama decide.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { MEETING_OUTCOME_LABELS, type MeetingOutcome } from "@/lib/activities/schema";
import { toUtc } from "@/lib/activities/time";
import { translateDbError } from "@/lib/db-errors";
import { parseMissingFields, requiredFieldLabel } from "@/lib/deals/required";

/** Registro do CRM que recebe a gravação. */
export type CrmTarget = { companyId: string; entity: "deals" | "leads" | "persons" | "organizations"; recordId: string };

/** Erro que o vendedor corrige (tipo, resultado ou etapa inexistente, campo obrigatório): vira `failed` com a mensagem. */
export class CrmSinkUserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CrmSinkUserError";
  }
}

/** Limites do banco (`char_length`): corpo da anotação e assunto da atividade. */
const NOTE_MAX = 10_000;
const SUBJECT_MAX = 200;
/** Próxima atividade sem hora: 09:00 em São Paulo. */
const DEFAULT_TIME = "09:00";
/** Canal padrão das atividades do assistente quando a âncora não dá um. */
const VIDEO_CHANNEL = "Videochamada";
/** Assunto da reunião criada sem âncora quando o título da reunião vem vazio. */
const MEETING_SUBJECT = "Reunião";

/** Coluna de vínculo da atividade para cada entidade do alvo. */
const LINK_COLUMN = {
  deals: "deal_id",
  leads: "lead_id",
  persons: "person_id",
  organizations: "organization_id",
} as const satisfies Record<CrmTarget["entity"], string>;

type DbError = { code?: string; message?: string; details?: string | null };
type TypeRow = { id: string; name: string; is_meeting: boolean; active: boolean };
type ChannelRow = { id: string; name: string; is_legacy: boolean };
type AnchorRow = { id: string; type_id: string; channel_id: string; done: boolean; deleted_at: string | null };

const norm = (s: string) => s.trim().toLocaleLowerCase("pt-BR");
/** Rótulo do resultado da reunião: sem diferenciar maiúsculas nem espaços ("no - show" = "No-show"). */
const squash = (s: string) => s.toLocaleLowerCase("pt-BR").replace(/\s+/g, "");

/** Tabela inversa de `MEETING_OUTCOME_LABELS`: rótulo normalizado -> código gravado em `meeting_outcome`. */
const OUTCOME_BY_LABEL = new Map(
  (Object.entries(MEETING_OUTCOME_LABELS) as [MeetingOutcome, string][]).map(([code, label]) => [squash(label), code]),
);

/** Corta em `max` caracteres contados como o `char_length` do banco (um emoji é um só, sem partir ao meio). */
function cut(s: string, max: number): string {
  return s.length <= max ? s : Array.from(s).slice(0, max).join("");
}

const subjectOf = (s: string, fallback: string) => cut(s.trim() || fallback, SUBJECT_MAX);

/**
 * Erro de gravação: exceção do banco que o vendedor resolve (`OXYN_*`, sem permissão) vira `CrmSinkUserError` com o
 * texto do `translateDbError`; o resto é falha técnica (`Error` comum, quem chama decide repetir).
 */
function writeFailure(error: DbError, what: string): Error {
  if (error.message?.includes("OXYN_") || error.code === "42501") return new CrmSinkUserError(translateDbError(error));
  return new Error(`Falha ao ${what}: ${error.message ?? error.code ?? "erro desconhecido"}`);
}

/** Cron (cliente admin): grava a anotação com created_by = dono. Corpo cortado em 10.000. Devolve o id da nota. */
export async function writeCrmNote(db: SupabaseClient, t: CrmTarget, html: string, ownerId: string): Promise<string> {
  const { data, error } = await db
    .from("notes")
    .insert({ company_id: t.companyId, entity: t.entity, record_id: t.recordId, body: cut(html, NOTE_MAX), created_by: ownerId })
    .select("id")
    .single();
  if (error) throw new Error(`Falha ao gravar a anotação no CRM: ${error.message}`);
  return (data as { id: string }).id;
}

/** Tipos de atividade da empresa (ativos e inativos), por posição. */
async function companyTypes(client: SupabaseClient, companyId: string): Promise<TypeRow[]> {
  const { data, error } = await client
    .from("activity_types")
    .select("id, name, is_meeting, active")
    .eq("company_id", companyId)
    .order("position")
    .order("name");
  if (error) throw new Error(`Falha ao ler os tipos de atividade: ${error.message}`);
  return (data ?? []) as TypeRow[];
}

/** Atividade âncora como o usuário a vê (`null`: sem âncora, apagada de vez ou invisível para ele). */
async function readAnchor(client: SupabaseClient, id: string | null): Promise<AnchorRow | null> {
  if (!id) return null;
  const { data, error } = await client
    .from("activities")
    .select("id, type_id, channel_id, done, deleted_at")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`Falha ao ler a atividade da reunião: ${error.message}`);
  return (data as AnchorRow | null) ?? null;
}

/**
 * Canal da atividade: o da âncora (se ainda for ativo e não legado; o "Não informado" das importadas não serve);
 * senão "Videochamada"; senão o primeiro canal ativo e não legado da empresa.
 */
async function pickChannel(client: SupabaseClient, companyId: string, anchor: AnchorRow | null): Promise<string> {
  const { data, error } = await client
    .from("activity_channels")
    .select("id, name, is_legacy")
    .eq("company_id", companyId)
    .eq("active", true)
    .order("position")
    .order("name");
  if (error) throw new Error(`Falha ao ler os canais de atividade: ${error.message}`);
  const usable = ((data ?? []) as ChannelRow[]).filter((c) => !c.is_legacy);
  const chosen =
    (anchor && usable.find((c) => c.id === anchor.channel_id)) ??
    usable.find((c) => norm(c.name) === norm(VIDEO_CHANNEL)) ??
    usable[0];
  if (!chosen) throw new CrmSinkUserError("A empresa não tem um canal de atividade ativo no CRM.");
  return chosen.id;
}

/** Insere a atividade aberta, vinculada ao alvo (a conclusão direta é bloqueada no banco; só a RPC conclui). */
async function insertActivity(
  client: SupabaseClient,
  t: CrmTarget,
  row: { owner_id: string; type_id: string; channel_id: string; subject: string; due_at: string },
): Promise<string> {
  const { data, error } = await client
    .from("activities")
    .insert({ company_id: t.companyId, ...row, [LINK_COLUMN[t.entity]]: t.recordId })
    .select("id")
    .single();
  if (error) throw writeFailure(error, "criar a atividade no CRM");
  return (data as { id: string }).id;
}

/**
 * Conclui a reunião pela função do banco, só com o resultado. "Remarcada" sem `p_meeting` é aceita: a nova reunião é
 * opcional na função e o vendedor a cria pela sugestão de próxima atividade.
 */
async function completeMeeting(client: SupabaseClient, activityId: string, outcome: MeetingOutcome): Promise<void> {
  const { error } = await client.rpc("complete_activity", {
    p_id: activityId,
    p_outcome_id: null,
    p_meeting_outcome: outcome,
    p_note: null,
    p_meeting: null,
    p_next: null,
  });
  if (error) throw writeFailure(error, "concluir a reunião no CRM");
}

/**
 * Conclui a reunião com o resultado (rótulo de `MEETING_OUTCOME_LABELS`).
 * - Âncora aberta (não apagada, tipo de reunião): conclui a âncora.
 * - Âncora concluída, na lixeira, sumida ou que deixou de ser reunião: segue como sem âncora.
 * - Sem âncora: cria a atividade de reunião (primeiro tipo de reunião ativo da empresa, canal pela regra de
 *   `pickChannel`, no horário em que a reunião começou) e a conclui. Se o banco recusar a conclusão (por exemplo, o
 *   funil exige a próxima atividade), a reunião criada vai para a lixeira, para a nova tentativa não duplicar.
 */
export async function completeCrmMeeting(
  client: SupabaseClient,
  t: CrmTarget,
  a: { anchorActivityId: string | null; outcomeLabel: string; subject: string; startedAt: string; ownerId: string },
): Promise<void> {
  const outcome = OUTCOME_BY_LABEL.get(squash(a.outcomeLabel));
  if (!outcome) throw new CrmSinkUserError(`O resultado "${a.outcomeLabel.trim()}" não existe no CRM.`);

  const [anchor, types] = await Promise.all([readAnchor(client, a.anchorActivityId), companyTypes(client, t.companyId)]);
  const anchorIsMeeting = !!anchor && types.find((ty) => ty.id === anchor.type_id)?.is_meeting === true;
  if (anchor && !anchor.done && !anchor.deleted_at && anchorIsMeeting) {
    await completeMeeting(client, anchor.id, outcome);
    return;
  }

  const type = types.find((ty) => ty.active && ty.is_meeting);
  if (!type) throw new CrmSinkUserError("A empresa não tem um tipo de reunião ativo no CRM.");
  const channelId = await pickChannel(client, t.companyId, anchor);
  const id = await insertActivity(client, t, {
    owner_id: a.ownerId,
    type_id: type.id,
    channel_id: channelId,
    subject: subjectOf(a.subject, MEETING_SUBJECT),
    due_at: a.startedAt,
  });
  try {
    await completeMeeting(client, id, outcome);
  } catch (e) {
    // Só na recusa do banco (a transação da função voltou atrás). Falha técnica pode ter concluído: não mexe.
    if (e instanceof CrmSinkUserError) {
      try {
        await client.from("activities").update({ deleted_at: new Date().toISOString() }).eq("id", id);
      } catch {
        // melhor esforço: a recusa original é o que o vendedor precisa ver
      }
    }
    throw e;
  }
}

/**
 * Cria a próxima atividade. Tipo pelo nome (sem diferenciar maiúsculas) entre os ativos da empresa; `dueDate` e
 * `dueTime` no horário de São Paulo (sem hora, 09:00); canal pela regra de `pickChannel`; vínculo pelo alvo.
 */
export async function createCrmActivity(
  client: SupabaseClient,
  t: CrmTarget,
  a: { type: string; subject: string; dueDate: string; dueTime: string | null; ownerId: string; anchorActivityId: string | null },
): Promise<void> {
  const wanted = norm(a.type);
  const type = (await companyTypes(client, t.companyId)).find((ty) => ty.active && norm(ty.name) === wanted);
  if (!type) throw new CrmSinkUserError(`O tipo "${a.type.trim()}" não existe no CRM.`);
  let dueAt: string;
  try {
    dueAt = toUtc(`${a.dueDate}T${a.dueTime ?? DEFAULT_TIME}`);
  } catch {
    throw new CrmSinkUserError("Data e hora inválidas.");
  }
  const anchor = await readAnchor(client, a.anchorActivityId);
  const channelId = await pickChannel(client, t.companyId, anchor);
  await insertActivity(client, t, {
    owner_id: a.ownerId,
    type_id: type.id,
    channel_id: channelId,
    subject: subjectOf(a.subject, type.name),
    due_at: dueAt,
  });
}

/**
 * Texto da falta de obrigatórios da etapa: as chaves do DETAIL de `OXYN_REQUIRED_FIELDS` com os nomes de
 * `requiredFieldLabel` (os campos personalizados pelo rótulo). Sem DETAIL, o texto genérico do `translateDbError`.
 */
async function missingFieldsMessage(client: SupabaseClient, companyId: string, error: DbError): Promise<string> {
  const keys = parseMissingFields(error.details ?? "");
  if (keys.length === 0) return translateDbError(error);
  let defs: { key: string; label: string }[] = [];
  if (keys.some((k) => k.startsWith("cf:"))) {
    const r = await client.from("custom_field_defs").select("key, label").eq("company_id", companyId).eq("entity", "deals");
    // sem os rótulos, a chave aparece como está: a mensagem ainda sai
    if (!r.error) defs = (r.data ?? []) as { key: string; label: string }[];
  }
  return `Faltam campos para esta etapa: ${keys.map((k) => requiredFieldLabel(k, defs)).join(", ")}.`;
}

/**
 * Move o negócio para a etapa pelo nome (sem diferenciar maiúsculas), dentro do funil dele e sem as arquivadas.
 * Negócio já na etapa: nada a gravar. Campos obrigatórios da etapa faltando: `CrmSinkUserError` com a lista.
 */
export async function moveCrmStage(client: SupabaseClient, dealId: string, stageName: string): Promise<void> {
  const found = await client
    .from("deals")
    .select("id, company_id, pipeline_id, stage_id")
    .eq("id", dealId)
    .is("deleted_at", null)
    .maybeSingle();
  if (found.error) throw new Error(`Falha ao ler o negócio: ${found.error.message}`);
  const deal = found.data as { id: string; company_id: string; pipeline_id: string; stage_id: string } | null;
  if (!deal) throw new CrmSinkUserError("O negócio não foi encontrado.");

  const stages = await client.from("stages").select("id, name").eq("pipeline_id", deal.pipeline_id).is("archived_at", null);
  if (stages.error) throw new Error(`Falha ao ler as etapas do funil: ${stages.error.message}`);
  const wanted = norm(stageName);
  const stage = ((stages.data ?? []) as { id: string; name: string }[]).find((s) => norm(s.name) === wanted);
  if (!stage) throw new CrmSinkUserError(`A etapa "${stageName.trim()}" não existe no funil deste negócio.`);
  if (stage.id === deal.stage_id) return;

  const { data, error } = await client
    .from("deals")
    .update({ stage_id: stage.id })
    .eq("id", deal.id)
    .is("deleted_at", null)
    .select("id");
  if (error) {
    if (error.message?.includes("OXYN_REQUIRED_FIELDS")) {
      throw new CrmSinkUserError(await missingFieldsMessage(client, deal.company_id, error));
    }
    throw writeFailure(error, "mover o negócio de etapa");
  }
  if (!data || data.length === 0) {
    throw new CrmSinkUserError("Não foi possível mover: o negócio está na lixeira ou você não tem permissão.");
  }
}

/** Nomes que vão para o Claude no modo CRM. */
export async function loadCrmNames(
  db: SupabaseClient,
  companyId: string,
): Promise<{ outcomes: string[]; activityTypes: string[] }> {
  const types = await companyTypes(db, companyId);
  return {
    outcomes: Object.values(MEETING_OUTCOME_LABELS),
    activityTypes: types.filter((ty) => ty.active).map((ty) => ty.name),
  };
}
