/**
 * Gravações do assistente de reuniões direto no CRM (destino depois da virada, com `MEETING_SINK=crm`), com os ids
 * do CRM, todas com o cliente admin. A anotação vem do cron, com autoria do dono da reunião. Conclusão da reunião,
 * próxima atividade e etapa vêm de sugestões confirmadas: quem chama confere antes que o vendedor pode editar o
 * registro vinculado, e a atividade criada leva `created_by` = quem confirmou. Sem `auth.uid()`, as travas do usuário
 * logado (conclusão direta, colunas da Agenda) não valem; os checks da tabela e o gatilho de campos obrigatórios da
 * etapa valem.
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
/** Etapa sugerida para negócio ganho ou perdido. */
const NOT_OPEN = "O negócio não está aberto: a etapa não foi mudada.";

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
type AnchorRow = {
  id: string;
  type_id: string;
  channel_id: string;
  done: boolean;
  meeting_outcome: MeetingOutcome | null;
  deleted_at: string | null;
};

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

/** Atividade âncora, lida com o cliente admin (`null`: sem âncora ou apagada de vez). */
async function readAnchor(client: SupabaseClient, id: string | null): Promise<AnchorRow | null> {
  if (!id) return null;
  const { data, error } = await client
    .from("activities")
    .select("id, type_id, channel_id, done, meeting_outcome, deleted_at")
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

/**
 * Insere a atividade vinculada ao alvo, com `created_by` = quem confirmou (o padrão `auth.uid()` fica nulo no cliente
 * admin). A reunião criada sem âncora já entra concluída (`done`, `completed_at` e `meeting_outcome`).
 */
async function insertActivity(
  client: SupabaseClient,
  t: CrmTarget,
  row: {
    owner_id: string;
    created_by: string;
    type_id: string;
    channel_id: string;
    subject: string;
    due_at: string;
    done?: true;
    completed_at?: string;
    meeting_outcome?: MeetingOutcome;
  },
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
 * Conclui a âncora aberta direto, como a função `complete_activity` grava (`done`, `completed_at`, `meeting_outcome`).
 * Cliente admin: a trava de conclusão direta só vale para o usuário logado, e a regra de próxima atividade
 * obrigatória do funil não se aplica à conclusão automática. Só se ainda estiver aberta e fora da lixeira: `false`
 * quando outra gravação mudou a âncora entre a leitura e aqui.
 */
async function closeAnchor(admin: SupabaseClient, id: string, outcome: MeetingOutcome): Promise<boolean> {
  const { data, error } = await admin
    .from("activities")
    .update({ done: true, completed_at: new Date().toISOString(), meeting_outcome: outcome })
    .eq("id", id)
    .eq("done", false)
    .is("deleted_at", null)
    .select("id");
  if (error) throw writeFailure(error, "concluir a reunião no CRM");
  return (data ?? []).length > 0;
}

/**
 * Conclui a reunião com o resultado (rótulo de `MEETING_OUTCOME_LABELS`), com o cliente admin. Devolve o id da reunião
 * criada, ou `null` quando a âncora resolveu.
 * - Âncora de reunião aberta: conclui a âncora (`closeAnchor`).
 * - Âncora de reunião já concluída (pelo vendedor, por outra confirmação ou por uma resposta perdida): com o mesmo
 *   resultado, nada a gravar; com outro, `CrmSinkUserError`. Nunca cria uma segunda reunião.
 * - Sem âncora, âncora apagada (lixeira ou de vez) ou que deixou de ser reunião: cria a reunião JÁ CONCLUÍDA num
 *   único insert (primeiro tipo de reunião ativo da empresa, canal pela regra de `pickChannel`, no horário em que a
 *   reunião começou), com o dono da reunião e `created_by` = quem confirmou. Sem passo de desfazer.
 */
export async function completeCrmMeeting(
  admin: SupabaseClient,
  t: CrmTarget,
  a: {
    anchorActivityId: string | null;
    outcomeLabel: string;
    subject: string;
    startedAt: string;
    ownerId: string;
    actorId: string;
  },
): Promise<string | null> {
  const outcome = OUTCOME_BY_LABEL.get(squash(a.outcomeLabel));
  if (!outcome) throw new CrmSinkUserError(`O resultado "${a.outcomeLabel.trim()}" não existe no CRM.`);

  const [first, types] = await Promise.all([readAnchor(admin, a.anchorActivityId), companyTypes(admin, t.companyId)]);
  /** Âncora que ainda é a reunião: fora da lixeira e de um tipo de reunião. */
  const isMeeting = (row: AnchorRow | null): row is AnchorRow =>
    !!row && !row.deleted_at && types.find((ty) => ty.id === row.type_id)?.is_meeting === true;

  let anchor = first;
  if (isMeeting(anchor) && !anchor.done) {
    if (await closeAnchor(admin, anchor.id, outcome)) return null;
    // Mudou entre a leitura e a gravação (outra confirmação ou o vendedor): decide pelo estado novo.
    anchor = await readAnchor(admin, anchor.id);
    if (isMeeting(anchor) && !anchor.done) {
      throw new Error("Falha ao concluir a reunião no CRM: a atividade mudou durante a gravação.");
    }
  }
  if (isMeeting(anchor)) {
    if (anchor.meeting_outcome === outcome) return null;
    const label = anchor.meeting_outcome ? MEETING_OUTCOME_LABELS[anchor.meeting_outcome] : null;
    throw new CrmSinkUserError(label ? `Esta reunião já foi concluída como "${label}".` : "Esta reunião já foi concluída.");
  }

  const type = types.find((ty) => ty.active && ty.is_meeting);
  if (!type) throw new CrmSinkUserError("A empresa não tem um tipo de reunião ativo no CRM.");
  const channelId = await pickChannel(admin, t.companyId, anchor);
  return insertActivity(admin, t, {
    owner_id: a.ownerId,
    created_by: a.actorId,
    type_id: type.id,
    channel_id: channelId,
    subject: subjectOf(a.subject, MEETING_SUBJECT),
    due_at: a.startedAt,
    done: true,
    completed_at: new Date().toISOString(),
    meeting_outcome: outcome,
  });
}

/**
 * Cria a próxima atividade aberta, com o cliente admin: dono da reunião como dono e `created_by` = quem confirmou.
 * Tipo pelo nome (sem diferenciar maiúsculas) entre os ativos da empresa; `dueDate` e `dueTime` no horário de São
 * Paulo (sem hora, 09:00); canal pela regra de `pickChannel`; vínculo pelo alvo.
 */
export async function createCrmActivity(
  admin: SupabaseClient,
  t: CrmTarget,
  a: {
    type: string;
    subject: string;
    dueDate: string;
    dueTime: string | null;
    ownerId: string;
    actorId: string;
    anchorActivityId: string | null;
  },
): Promise<void> {
  const wanted = norm(a.type);
  const type = (await companyTypes(admin, t.companyId)).find((ty) => ty.active && norm(ty.name) === wanted);
  if (!type) throw new CrmSinkUserError(`O tipo "${a.type.trim()}" não existe no CRM.`);
  let dueAt: string;
  try {
    dueAt = toUtc(`${a.dueDate}T${a.dueTime ?? DEFAULT_TIME}`);
  } catch {
    throw new CrmSinkUserError("Data e hora inválidas.");
  }
  const anchor = await readAnchor(admin, a.anchorActivityId);
  const channelId = await pickChannel(admin, t.companyId, anchor);
  await insertActivity(admin, t, {
    owner_id: a.ownerId,
    created_by: a.actorId,
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
 * Move o negócio aberto para a etapa pelo nome (sem diferenciar maiúsculas), dentro do funil dele e sem as
 * arquivadas, com o cliente admin. Como o `moveDeal`, o negócio vai para o fim da etapa (maior posição + 1024, ou 0
 * se vazia). Ganho ou perdido: `CrmSinkUserError`, sem gravar. Negócio já na etapa: nada a gravar. Campos
 * obrigatórios da etapa faltando (o gatilho do banco vale também para o admin): `CrmSinkUserError` com a lista.
 */
export async function moveCrmStage(admin: SupabaseClient, dealId: string, stageName: string): Promise<void> {
  const found = await admin
    .from("deals")
    .select("id, company_id, pipeline_id, stage_id, status")
    .eq("id", dealId)
    .is("deleted_at", null)
    .maybeSingle();
  if (found.error) throw new Error(`Falha ao ler o negócio: ${found.error.message}`);
  const deal = found.data as
    | { id: string; company_id: string; pipeline_id: string; stage_id: string; status: string }
    | null;
  if (!deal) throw new CrmSinkUserError("O negócio não foi encontrado.");
  // Mesma regra do `moveDeal`: ganho ou perdido não muda de etapa.
  if (deal.status !== "open") throw new CrmSinkUserError(NOT_OPEN);

  const stages = await admin.from("stages").select("id, name").eq("pipeline_id", deal.pipeline_id).is("archived_at", null);
  if (stages.error) throw new Error(`Falha ao ler as etapas do funil: ${stages.error.message}`);
  const wanted = norm(stageName);
  const stage = ((stages.data ?? []) as { id: string; name: string }[]).find((s) => norm(s.name) === wanted);
  if (!stage) throw new CrmSinkUserError(`A etapa "${stageName.trim()}" não existe no funil deste negócio.`);
  if (stage.id === deal.stage_id) return;

  const last = await admin
    .from("deals")
    .select("position")
    .eq("stage_id", stage.id)
    .neq("id", deal.id)
    .is("deleted_at", null)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (last.error) throw new Error(`Falha ao ler as posições da etapa: ${last.error.message}`);
  const lastPosition = (last.data as { position: number | string } | null)?.position;
  const position = lastPosition == null ? 0 : Number(lastPosition) + 1024;

  const { data, error } = await admin
    .from("deals")
    .update({ stage_id: stage.id, position })
    .eq("id", deal.id)
    .is("deleted_at", null)
    .eq("status", "open")
    .select("id");
  if (error) {
    if (error.message?.includes("OXYN_REQUIRED_FIELDS")) {
      throw new CrmSinkUserError(await missingFieldsMessage(admin, deal.company_id, error));
    }
    throw writeFailure(error, "mover o negócio de etapa");
  }
  if (!data || data.length === 0) {
    throw new CrmSinkUserError("Não foi possível mover: o negócio não está aberto ou está na lixeira.");
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
