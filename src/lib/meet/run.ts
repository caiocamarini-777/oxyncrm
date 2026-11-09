import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { GmailApiError } from "@/lib/gmail/client";
import { hasMeetScopes } from "@/lib/gmail/connect";
import { createPipedriveClient } from "@/lib/import/pipedrive/client";
import { noteText } from "@/lib/timeline/describe";
import {
  type CalendarEvent,
  type MeetClient,
  type Participant,
  meetClientForAccount,
} from "./google";
import { normalizeEmail, pickRecord, splitAttendees } from "./match";
import { loadCandidates, loadInternalDomains } from "./match-loader";
import { renderNoteHtml } from "./note-html";
import {
  generateNotes,
  type MeetingNotes,
  MeetingNotesSchema,
  NOTES_MODEL,
  type NotesInput,
  type TranscriptSource,
} from "./notes";
import { readMeetingSettings } from "./settings";
import { type MeetingSink, pipedriveSink, pipedriveUserFor, SinkError, type SinkTarget } from "./sink";

/**
 * Rodada do assistente de reuniões (cron a cada 10 min). Regras na spec, seções "Capturar", "Vincular",
 * "Gerar as notas", "Gravar" e "Erros":
 *
 * 1. descarta as reuniões sem vínculo há mais de 7 dias;
 * 2. para cada caixa ativa com os escopos do Meet, na empresa com o assistente ligado, e com o lease
 *    `meeting_lock_until`: lê as reuniões encerradas desde o cursor (no máximo as das últimas 24 h), espera a
 *    transcrição (até 2 h depois do fim) e processa (vínculo, notas com o Claude, anotação no Pipedrive e
 *    sugestões). Reunião que o Google não deixou ler e que o vendedor reabriu ("Tentar de novo") é relida antes;
 * 3. tenta de novo as reuniões em `processing` (Claude ou Pipedrive falharam), até 3 tentativas. Só pega a
 *    reunião parada há mais de 10 min e a reivindica com um update condicional, porque as ações do vendedor
 *    (vincular, tentar de novo) também processam na própria requisição.
 *
 * `processMeeting` é exportada para as ações do vendedor (vincular, tentar de novo), que reaproveitam as
 * notas já guardadas em `meeting_notes` em vez de chamar o Claude de novo.
 */

/** Limite do texto corrido da transcrição (o check do banco conta caracteres). */
export const MAX_TRANSCRIPT_CHARS = 1_048_576;
/** Prazo, depois do fim da reunião, para a transcrição (ou as anotações do Gemini) aparecer. */
export const TRANSCRIPT_DEADLINE_MS = 2 * 3600_000;
/** Tentativas para o Claude e o Pipedrive antes de `failed`. */
export const MAX_ATTEMPTS = 3;
/** Reunião sem vínculo é descartada sozinha depois deste prazo. */
export const UNLINKED_DISCARD_MS = 7 * 24 * 3600_000;
/**
 * Janela máxima de leitura: as reuniões encerradas nas últimas 24 h. Vale na primeira leitura (sem cursor) e
 * também com um cursor antigo (assistente religado, caixa reconectada depois de muito tempo), para não
 * processar reuniões velhas de uma vez.
 */
export const FIRST_LOOKBACK_MS = 24 * 3600_000;
/**
 * A leitura começa um pouco antes do cursor: uma reunião que o Google só lista depois, com fim anterior ao
 * cursor, ainda entra. As repetidas são puladas pelo `conference_record`.
 */
export const CURSOR_OVERLAP_MS = 15 * 60_000;
/**
 * Reunião em `processing` só volta para a fila do cron depois deste tempo sem mudança (`updated_at`): antes
 * disso, uma ação do vendedor ou outra rodada pode estar no meio do processamento.
 */
export const PROCESSING_STALE_MS = 10 * 60_000;
/** Duração do lease de uma caixa: o `maxDuration` da rota. Rodada que morre solta a caixa sozinha. */
export const LEASE_MS = 300_000;

export const NO_TRANSCRIPT = "reunião sem transcrição";
/** Prazo esgotado sem transcrição e sem anotações do Gemini. */
export const NO_MEETING_TEXT = "reunião sem transcrição nem anotações do Gemini";
export const RECORD_DELETED = "registro excluído";
const DEFAULT_TITLE = "Reunião do Meet";
const UNKNOWN_SPEAKER = "Participante";

export type PipedriveNames = {
  /** Rótulos das opções do campo "outcome" das atividades. */
  outcomes: string[];
  /** Nomes dos tipos de atividade. */
  activityTypes: string[];
};

export type MeetDeps = {
  db: SupabaseClient;
  meetFor(accountId: string): MeetClient;
  notes: typeof generateNotes;
  sink: MeetingSink;
  now(): Date;
  /**
   * Nomes do Pipedrive para o pedido ao Claude. Opcional: sem ela, lê com `PIPEDRIVE_API_TOKEN`. A rodada
   * guarda o resultado e só busca quando alguma reunião precisa gerar notas.
   */
  pipedriveNames?: () => Promise<PipedriveNames>;
};

export type AccountRunResult = {
  accountId: string;
  /** Reuniões novas gravadas (inclusive as ignoradas). */
  created: number;
  /** Reuniões processadas até `done` ou `unlinked`. */
  processed: number;
  /** Reuniões que viraram `failed` nesta rodada. */
  failed: number;
  /** Falha ao ler o Google (a caixa segue com as retentativas). */
  error?: string;
};

/** Conteúdo de `meeting_suggestions.payload`, por `kind`. */
export type SuggestionPayload =
  | { kind: "meeting_outcome"; payload: { outcome: string } }
  | { kind: "next_activity"; payload: NonNullable<MeetingNotes["suggestions"]["next_activity"]> }
  | { kind: "stage"; payload: { stage: string } };

export type Attendee = { email: string | null; name: string; internal: boolean };

type MeetingStatus = "waiting_transcript" | "processing" | "unlinked" | "done" | "failed" | "ignored";
type LinkEntity = "deals" | "leads" | "persons" | "organizations";

type MeetingRow = {
  id: string;
  company_id: string;
  account_id: string | null;
  owner_id: string;
  conference_record: string;
  title: string;
  started_at: string | null;
  ended_at: string | null;
  attendees: Attendee[] | null;
  status: MeetingStatus;
  attempts: number | null;
  entity: LinkEntity | null;
  record_id: string | null;
};
const MEETING_COLUMNS =
  "id, company_id, account_id, owner_id, conference_record, title, started_at, ended_at, attendees, status, attempts, entity, record_id";

type AccountRow = { id: string; user_id: string; company_id: string; scopes: string[] | null; meeting_cursor: string | null };

type DbError = { message: string; code?: string } | null;

const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Erro do Google que não melhora tentando de novo: 4xx que não é de token (401, `GmailAuthError`) nem de
 * limite (429 e 403 de cota, `GmailRateLimitError`), ex.: 403 sem acesso ou 404 de espaço apagado.
 * Rede, 5xx e limite são passageiros.
 */
export function isPermanentGoogleError(e: unknown): boolean {
  return e instanceof GmailApiError && e.status >= 400 && e.status < 500 && e.status !== 401 && e.status !== 429;
}

/** Texto para `ilike` que casa só com ele mesmo (escapa `%`, `_` e `\`). */
const likeLiteral = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

function check(error: DbError, what: string): void {
  if (error) throw new Error(`Falha ao ${what}: ${error.message}`);
}

/** Guarda o resultado de uma busca assíncrona; falha não fica em cache. */
function once<T>(fn: () => Promise<T>): () => Promise<T> {
  let p: Promise<T> | null = null;
  return () => {
    if (!p) {
      p = fn();
      p.catch(() => (p = null));
    }
    return p;
  };
}

// ---- dependências padrão ---------------------------------------------------------------------------------------

/** Resultados de reunião e tipos de atividade, lidos na hora do Pipedrive. */
export async function loadPipedriveNames(token: string): Promise<PipedriveNames> {
  const client = createPipedriveClient({ token });
  const [types, fields] = await Promise.all([
    client.activityTypes(),
    // conta sem o campo de resultado (ou que recusa a rota) segue sem resultados, como na importação
    client.activityFields().catch(() => []),
  ]);
  const outcome = fields.find((f) => f.key === "outcome");
  return {
    outcomes: (outcome?.options ?? []).map((o) => String(o.label ?? "").trim()).filter(Boolean),
    activityTypes: types
      .filter((t) => t.active_flag !== false)
      .map((t) => String(t.name ?? "").trim())
      .filter(Boolean),
  };
}

function namesLoader(deps: MeetDeps): () => Promise<PipedriveNames> {
  if (deps.pipedriveNames) return deps.pipedriveNames;
  return async () => {
    const token = process.env.PIPEDRIVE_API_TOKEN;
    if (!token) throw new Error("PIPEDRIVE_API_TOKEN não configurado.");
    return loadPipedriveNames(token);
  };
}

/** Dependências de produção (cron e ações do vendedor). Pede `PIPEDRIVE_API_TOKEN`; o Claude lê `ANTHROPIC_API_KEY`. */
export function defaultMeetDeps(db: SupabaseClient): MeetDeps {
  const token = process.env.PIPEDRIVE_API_TOKEN;
  if (!token) throw new Error("PIPEDRIVE_API_TOKEN não configurado.");
  return {
    db,
    meetFor: meetClientForAccount,
    notes: generateNotes,
    sink: pipedriveSink({ token }),
    now: () => new Date(),
    pipedriveNames: once(() => loadPipedriveNames(token)),
  };
}

// ---- rodada ----------------------------------------------------------------------------------------------------

/** Contas ativas com os escopos do Meet, em empresas (não arquivadas) com o assistente ligado. */
async function loadAccounts(db: SupabaseClient): Promise<AccountRow[]> {
  const { data, error } = await db
    .from("email_accounts")
    .select("id, user_id, company_id, scopes, meeting_cursor")
    .eq("status", "active")
    .order("created_at", { ascending: true })
    .limit(200);
  check(error, "listar as caixas");
  const accounts = ((data ?? []) as AccountRow[]).filter((a) => hasMeetScopes(a.scopes ?? []));
  if (accounts.length === 0) return [];

  const companyIds = [...new Set(accounts.map((a) => a.company_id))];
  const companies = await db.from("companies").select("id, settings, archived_at").in("id", companyIds);
  check(companies.error, "ler as empresas");
  const enabled = new Set(
    ((companies.data ?? []) as { id: string; settings: unknown; archived_at: string | null }[])
      .filter((c) => !c.archived_at && readMeetingSettings(c.settings).enabled)
      .map((c) => c.id),
  );
  return accounts.filter((a) => enabled.has(a.company_id));
}

/**
 * Marca como lidos os avisos de "reunião sem vínculo" das reuniões resolvidas (vinculadas e concluídas, ou
 * descartadas). Falha aqui só vai para o log: o aviso é secundário à decisão.
 */
export async function markUnlinkedNoticesRead(db: SupabaseClient, meetingIds: string[], now: Date): Promise<void> {
  if (meetingIds.length === 0) return;
  const { error } = await db
    .from("notifications")
    .update({ read_at: now.toISOString() })
    .eq("kind", "meeting_unlinked")
    .in("meeting_id", meetingIds)
    .is("read_at", null);
  if (error) console.error("meet: falha ao marcar o aviso de reunião sem vínculo como lido", meetingIds, error.message);
}

/** Sem decisão em 7 dias, a reunião sem vínculo vira `ignored`, e a transcrição e as notas são apagadas. */
async function discardStaleUnlinked(db: SupabaseClient, now: Date): Promise<void> {
  const cutoff = new Date(now.getTime() - UNLINKED_DISCARD_MS).toISOString();
  const { data, error } = await db
    .from("meetings")
    .select("id")
    .eq("status", "unlinked")
    .lt("updated_at", cutoff)
    .limit(500);
  check(error, "listar as reuniões sem vínculo antigas");
  const ids = ((data ?? []) as { id: string }[]).map((r) => r.id);
  if (ids.length === 0) return;
  // Apaga antes de marcar: se algo falhar no meio, a próxima rodada encontra a reunião de novo.
  const transcripts = await db.from("meeting_transcripts").delete().in("meeting_id", ids);
  check(transcripts.error, "apagar as transcrições descartadas");
  const notes = await db.from("meeting_notes").delete().in("meeting_id", ids);
  check(notes.error, "apagar as notas descartadas");
  const marked = await db
    .from("meetings")
    .update({ status: "ignored", last_error: null })
    .in("id", ids)
    .eq("status", "unlinked")
    .select("id");
  check(marked.error, "descartar as reuniões sem vínculo");
  await markUnlinkedNoticesRead(
    db,
    ((marked.data ?? []) as { id: string }[]).map((r) => r.id),
    now,
  );
}

/**
 * Uma rodada: descarte, depois as caixas uma de cada vez enquanto houver orçamento. A falha de uma caixa
 * não interrompe as demais. Caixa segura por outra rodada (lease) fica de fora do resultado.
 */
export async function runMeetSync(deps: MeetDeps, opts: { budgetMs: number }): Promise<AccountRunResult[]> {
  const { db } = deps;
  const nowMs = () => deps.now().getTime();
  const end = nowMs() + opts.budgetMs;
  // Nomes do Pipedrive: uma busca por rodada, só se alguma reunião precisar de notas.
  const run: MeetDeps = { ...deps, pipedriveNames: once(namesLoader(deps)) };
  const internalDomains = once(() => loadInternalDomains(db));

  try {
    await discardStaleUnlinked(db, deps.now());
  } catch (e) {
    console.error("meet: falha no descarte das reuniões sem vínculo:", errorMessage(e));
  }

  const accounts = await loadAccounts(db);
  const results: AccountRunResult[] = [];
  for (const acc of accounts) {
    if (nowMs() >= end) break; // as demais entram na próxima rodada

    // Lease: só pega a caixa se ninguém a segura (ou se o lease anterior venceu).
    const leaseUntil = new Date(nowMs() + LEASE_MS).toISOString();
    const claimed = await db
      .from("email_accounts")
      .update({ meeting_lock_until: leaseUntil })
      .eq("id", acc.id)
      .eq("status", "active")
      .or(`meeting_lock_until.is.null,meeting_lock_until.lt."${new Date(nowMs()).toISOString()}"`)
      .select("id");
    if (claimed.error || !claimed.data?.length) continue;

    const result: AccountRunResult = { accountId: acc.id, created: 0, processed: 0, failed: 0 };
    try {
      await runAccount(run, acc, result, internalDomains, end);
    } catch (e) {
      result.error ??= errorMessage(e);
      console.error("meet: falha na caixa", acc.id, errorMessage(e));
    } finally {
      // Solta só o próprio lease (se venceu e outra rodada pegou a caixa, o dela fica).
      const released = await db
        .from("email_accounts")
        .update({ meeting_lock_until: null })
        .eq("id", acc.id)
        .eq("meeting_lock_until", leaseUntil);
      if (released.error) console.error("meet: falha ao soltar a caixa", acc.id, released.error.message);
    }
    results.push(result);
  }
  return results;
}

function count(result: AccountRunResult, status: MeetingStatus | "skipped"): void {
  if (status === "done" || status === "unlinked") result.processed++;
  else if (status === "failed") result.failed++;
}

async function runAccount(
  deps: MeetDeps,
  acc: AccountRow,
  result: AccountRunResult,
  internalDomains: () => Promise<Set<string>>,
  end: number,
): Promise<void> {
  const { db } = deps;
  const meet = deps.meetFor(acc.id);
  const timeLeft = () => deps.now().getTime() < end;

  // 1. Reuniões novas. Falha do Google aqui não impede as retentativas abaixo.
  try {
    await captureNew(deps, meet, acc, result, internalDomains);
  } catch (e) {
    result.error = errorMessage(e);
    console.error("meet: falha ao ler as reuniões da caixa", acc.id, result.error);
  }

  // 2. Reuniões esperando a transcrição.
  const handled = new Set<string>();
  const waiting = await db
    .from("meetings")
    .select(MEETING_COLUMNS)
    .eq("account_id", acc.id)
    .eq("status", "waiting_transcript")
    .order("ended_at", { ascending: true })
    .limit(50);
  check(waiting.error, "listar as reuniões esperando transcrição");
  for (const m of (waiting.data ?? []) as MeetingRow[]) {
    if (!timeLeft()) return;
    handled.add(m.id);
    try {
      // Sem convidados: a reunião foi gravada como ilegível e o vendedor a reabriu. Relê antes de esperar a
      // transcrição (e o vínculo só é procurado depois de existir transcrição).
      if ((m.attendees ?? []).length === 0) {
        const reread = await rereadMeeting(deps, meet, acc, m, internalDomains);
        if (reread === "failed") result.failed++;
        if (reread !== "waiting") continue;
      }
      const state = await fetchTranscript(deps, meet, m);
      if (state === "failed") result.failed++;
      if (state === "ready") count(result, await runProcess(deps, m.id));
    } catch (e) {
      result.error ??= errorMessage(e);
      console.error("meet: falha ao ler a transcrição", m.id, errorMessage(e));
    }
  }

  // 3. Retentativas: notas ou anotação que falharam numa rodada anterior. Só a reunião parada há mais de
  //    10 min: a mais recente pode estar sendo processada agora por uma ação do vendedor.
  const stale = new Date(deps.now().getTime() - PROCESSING_STALE_MS).toISOString();
  const pending = await db
    .from("meetings")
    .select("id")
    .eq("account_id", acc.id)
    .eq("status", "processing")
    .lt("attempts", MAX_ATTEMPTS)
    .lt("updated_at", stale)
    .order("updated_at", { ascending: true })
    .limit(20);
  check(pending.error, "listar as reuniões em processamento");
  for (const { id } of (pending.data ?? []) as { id: string }[]) {
    if (!timeLeft()) return;
    if (handled.has(id)) continue;
    try {
      // Reivindica antes de processar: o update só pega a reunião se ninguém mexeu nela desde a lista, e o
      // trigger renova `updated_at`, o que a tira da fila das outras rodadas pelos próximos 10 min.
      const claimed = await db
        .from("meetings")
        .update({ status: "processing" })
        .eq("id", id)
        .eq("status", "processing")
        .lt("updated_at", stale)
        .select("id");
      check(claimed.error, "reivindicar a reunião");
      if (!claimed.data?.length) continue;
      count(result, await runProcess(deps, id));
    } catch (e) {
      result.error ??= errorMessage(e);
      console.error("meet: falha ao tentar de novo a reunião", id, errorMessage(e));
    }
  }
}

/**
 * Lê as reuniões encerradas desde o cursor menos 15 min (sem cursor, ou com ele mais velho que isso, só as
 * das últimas 24 h), da mais antiga para a mais nova. O cursor avança até o maior `endTime` tratado (nunca
 * volta); se uma reunião falhar no meio, ele para antes dela e a próxima rodada lê de novo (as já gravadas são
 * puladas pelo `conference_record`).
 */
async function captureNew(
  deps: MeetDeps,
  meet: MeetClient,
  acc: AccountRow,
  result: AccountRunResult,
  internalDomains: () => Promise<Set<string>>,
): Promise<void> {
  const { db } = deps;
  const saved = acc.meeting_cursor ? Date.parse(acc.meeting_cursor) : NaN;
  const floor = deps.now().getTime() - FIRST_LOOKBACK_MS;
  const since = new Date(Number.isNaN(saved) ? floor : Math.max(saved - CURSOR_OVERLAP_MS, floor));
  const records = (await meet.listConferenceRecords(since))
    .filter((r): r is typeof r & { endTime: string } => !!r.endTime && !Number.isNaN(Date.parse(r.endTime)))
    .sort((a, b) => Date.parse(a.endTime) - Date.parse(b.endTime));

  const start = Number.isNaN(saved) ? -Infinity : saved;
  let cursor = start;
  let failure: unknown = null;
  for (const rec of records) {
    try {
      const existing = await db.from("meetings").select("id").eq("conference_record", rec.name).maybeSingle();
      check(existing.error, "procurar a reunião");
      if (!existing.data) {
        try {
          if (await insertMeeting(deps, meet, acc, rec, internalDomains)) result.created++;
        } catch (e) {
          // Erro permanente do Google numa reunião: registra como `failed` e segue, para o cursor não
          // travar nela. Passageiro (rede, 5xx, limite): para aqui e a próxima rodada tenta de novo.
          if (!isPermanentGoogleError(e)) throw e;
          console.error("meet: reunião ilegível no Google", rec.name, errorMessage(e));
          if (await insertUnreadable(db, acc, rec, errorMessage(e))) {
            result.created++;
            result.failed++;
          }
        }
      }
    } catch (e) {
      failure = e;
      break;
    }
    cursor = Math.max(cursor, Date.parse(rec.endTime));
  }

  if (cursor > start) {
    const moved = await db
      .from("email_accounts")
      .update({ meeting_cursor: new Date(cursor).toISOString() })
      .eq("id", acc.id);
    check(moved.error, "avançar o cursor da caixa");
  }
  if (failure) throw failure;
}

/** Convidados do evento (sem salas), com o organizador, sem repetidos e com a marca de interno. */
function attendeesFromEvent(ev: CalendarEvent, domains: Set<string>): Attendee[] {
  const list: { email: string; name: string }[] = [];
  const seen = new Set<string>();
  const add = (rawEmail: string | undefined, name: string | undefined) => {
    const email = rawEmail ? normalizeEmail(rawEmail) : "";
    if (!email || seen.has(email)) return;
    seen.add(email);
    list.push({ email, name: name?.trim() ?? "" });
  };
  for (const a of ev.attendees ?? []) if (!a.resource) add(a.email, a.displayName);
  add(ev.organizer?.email, undefined);
  const { internal } = splitAttendees(
    list.map((a) => a.email),
    domains,
  );
  const internalSet = new Set(internal);
  return list.map((a) => ({ ...a, internal: internalSet.has(a.email) }));
}

/**
 * Reunião instantânea (sem evento): os participantes do Meet não trazem e-mail, então não há como saber
 * quem é de fora nem casar com o CRM, e a reunião acaba ignorada.
 */
function attendeesFromParticipants(participants: Participant[]): Attendee[] {
  return participants.map((p) => ({
    email: null,
    name: p.signedinUser?.displayName || p.anonymousUser?.displayName || UNKNOWN_SPEAKER,
    internal: false,
  }));
}

/**
 * Dono pelo organizador: perfil ativo com o mesmo e-mail (sem diferenciar maiúsculas e espaços) e com
 * vínculo na empresa da reunião. `null` quando não serve (a reunião fica com o dono da caixa).
 */
async function organizerOwner(db: SupabaseClient, organizer: string, companyId: string): Promise<string | null> {
  const p = await db
    .from("profiles")
    .select("id, email")
    .ilike("email", likeLiteral(organizer))
    .eq("active", true)
    .limit(5);
  check(p.error, "procurar o organizador");
  const profile = ((p.data ?? []) as { id: string; email: string }[]).find((r) => normalizeEmail(r.email) === organizer);
  if (!profile) return null;
  const member = await db
    .from("memberships")
    .select("user_id")
    .eq("user_id", profile.id)
    .eq("company_id", companyId)
    .limit(1);
  check(member.error, "conferir o vínculo do organizador");
  return member.data?.length ? profile.id : null;
}

/** Reunião que o Google não deixa ler (erro permanente): fica `failed`, com o motivo, sem bloquear o cursor. */
async function insertUnreadable(
  db: SupabaseClient,
  acc: AccountRow,
  rec: { name: string; startTime: string; endTime: string },
  reason: string,
): Promise<boolean> {
  const { data, error } = await db
    .from("meetings")
    .upsert(
      {
        company_id: acc.company_id,
        account_id: acc.id,
        owner_id: acc.user_id,
        conference_record: rec.name,
        title: DEFAULT_TITLE,
        started_at: rec.startTime,
        ended_at: rec.endTime,
        attendees: [],
        status: "failed",
        last_error: `Não foi possível ler a reunião no Google: ${reason}`.slice(0, 500),
      },
      { onConflict: "conference_record", ignoreDuplicates: true },
    )
    .select("id");
  check(error, "gravar a reunião ilegível");
  return (data?.length ?? 0) > 0;
}

/** O que se lê do Google sobre uma reunião: evento da agenda, título, convidados e dono. */
type MeetingInfo = {
  owner_id: string;
  calendar_event_id: string | null;
  title: string;
  attendees: Attendee[];
  /** Sem convidado de fora: a reunião é ignorada, sem ler a transcrição. */
  status: "waiting_transcript" | "ignored";
};

/**
 * Código da reunião, evento da agenda (título e convidados; sem evento, os participantes do Meet) e dono (o
 * organizador, se for usuário da empresa; senão, o dono da caixa).
 */
async function readMeetingInfo(
  deps: MeetDeps,
  meet: MeetClient,
  acc: AccountRow,
  rec: { name: string; space: string; startTime: string },
  internalDomains: () => Promise<Set<string>>,
): Promise<MeetingInfo> {
  const code = await meet.getMeetingCode(rec.space);
  const ev = code ? await meet.findEventByMeetingCode(code, new Date(rec.startTime)) : null;
  const attendees = ev
    ? attendeesFromEvent(ev, await internalDomains())
    : attendeesFromParticipants(await meet.listParticipants(rec.name));
  const hasExternal = attendees.some((a) => a.email && !a.internal);

  const organizer = ev?.organizer?.email ? normalizeEmail(ev.organizer.email) : "";
  const ownerId = (organizer && (await organizerOwner(deps.db, organizer, acc.company_id))) || acc.user_id;
  return {
    owner_id: ownerId,
    calendar_event_id: ev?.id ?? null,
    title: ev?.summary?.trim() || DEFAULT_TITLE,
    attendees,
    status: hasExternal ? "waiting_transcript" : "ignored",
  };
}

/** Grava a reunião nova (`on conflict (conference_record) do nothing`). Devolve se ela foi criada agora. */
async function insertMeeting(
  deps: MeetDeps,
  meet: MeetClient,
  acc: AccountRow,
  rec: { name: string; space: string; startTime: string; endTime: string },
  internalDomains: () => Promise<Set<string>>,
): Promise<boolean> {
  const info = await readMeetingInfo(deps, meet, acc, rec, internalDomains);
  const { data, error } = await deps.db
    .from("meetings")
    .upsert(
      {
        ...info,
        company_id: acc.company_id,
        account_id: acc.id,
        conference_record: rec.name,
        started_at: rec.startTime,
        ended_at: rec.endTime,
      },
      { onConflict: "conference_record", ignoreDuplicates: true },
    )
    .select("id");
  check(error, "gravar a reunião");
  return (data?.length ?? 0) > 0;
}

/**
 * Reunião gravada como ilegível (`insertUnreadable`: sem convidados) e reaberta pelo vendedor com "Tentar de
 * novo": relê a reunião, o código, o evento, os convidados e o dono, como na primeira leitura. Sem convidado de
 * fora, vira `ignored`. Erro permanente do Google volta a reunião para `failed` com o motivo; erro passageiro
 * lança, e a próxima rodada tenta de novo.
 */
async function rereadMeeting(
  deps: MeetDeps,
  meet: MeetClient,
  acc: AccountRow,
  m: MeetingRow,
  internalDomains: () => Promise<Set<string>>,
): Promise<"waiting" | "ignored" | "failed"> {
  const { db } = deps;
  let info: MeetingInfo;
  try {
    const rec = await meet.getConferenceRecord(m.conference_record);
    info = await readMeetingInfo(deps, meet, acc, { ...rec, startTime: rec.startTime || m.started_at || "" }, internalDomains);
  } catch (e) {
    if (!isPermanentGoogleError(e)) throw e;
    console.error("meet: reunião ainda ilegível no Google", m.id, errorMessage(e));
    const { error } = await db
      .from("meetings")
      .update({ status: "failed", last_error: `Não foi possível ler a reunião no Google: ${errorMessage(e)}`.slice(0, 500) })
      .eq("id", m.id)
      .eq("status", "waiting_transcript");
    check(error, "marcar a reunião ilegível");
    return "failed";
  }
  const { error } = await db.from("meetings").update(info).eq("id", m.id).eq("status", "waiting_transcript");
  check(error, "gravar a reunião relida");
  return info.status === "ignored" ? "ignored" : "waiting";
}

type TranscriptEntryRow = { speaker: string; text: string; start: string };

type MeetingText = { source: TranscriptSource; entries: TranscriptEntryRow[]; text: string };

/** Texto corrido ("Fulano: fala"), cortado no limite; as entradas param na que estourou o limite. */
export function buildTranscript(entries: TranscriptEntryRow[]): { entries: TranscriptEntryRow[]; text: string } {
  const kept: TranscriptEntryRow[] = [];
  let text = "";
  for (const e of entries) {
    const line = `${e.speaker}: ${e.text}`;
    const next = text ? `${text}\n${line}` : line;
    kept.push(e);
    if (next.length >= MAX_TRANSCRIPT_CHARS) {
      text = next.slice(0, MAX_TRANSCRIPT_CHARS);
      break;
    }
    text = next;
  }
  return { entries: kept, text };
}

/**
 * Texto da reunião no Google. A transcrição é a fonte preferida: com alguma ainda gerando, espera por ela até o
 * prazo. Sem transcrição pronta (ou pronta e vazia), usa as anotações do Gemini (os documentos gerados, juntos),
 * com a mesma espera. `null`: nada pronto ainda (ou nada, depois do prazo).
 */
async function readMeetingText(meet: MeetClient, m: MeetingRow, late: boolean): Promise<MeetingText | null> {
  const transcripts = await meet.listTranscripts(m.conference_record);
  const ready = transcripts.filter((t) => t.state === "FILE_GENERATED");
  if (ready.length < transcripts.length && !late) return null;
  if (ready.length > 0) {
    const [lists, participants] = await Promise.all([
      Promise.all(ready.map((t) => meet.listTranscriptEntries(t.name))),
      meet.listParticipants(m.conference_record),
    ]);
    const speakers = new Map(
      participants.map((p) => [p.name, p.signedinUser?.displayName || p.anonymousUser?.displayName || UNKNOWN_SPEAKER]),
    );
    const entries = lists
      .flat()
      .sort((a, b) => Date.parse(a.startTime) - Date.parse(b.startTime))
      .map((e) => ({ speaker: speakers.get(e.participant) ?? UNKNOWN_SPEAKER, text: e.text, start: e.startTime }));
    const transcript = buildTranscript(entries);
    // Transcrição pronta mas sem fala nenhuma não serve para as notas: tenta as anotações do Gemini.
    if (transcript.text.trim()) return { source: "transcript", ...transcript };
  }

  const notes = await meet.listSmartNotes(m.conference_record);
  if (notes.some((n) => n.state !== "FILE_GENERATED") && !late) return null;
  const docs = [
    ...new Set(notes.flatMap((n) => (n.state === "FILE_GENERATED" && n.docsDestination?.document ? [n.docsDestination.document] : []))),
  ];
  if (docs.length === 0) return null;
  // Um documento que não abre (apagado, sem acesso) não descarta os outros; só falha se nenhum abrir.
  const exported = await Promise.allSettled(docs.map((d) => meet.exportDocText(d)));
  const texts = exported.flatMap((r) => (r.status === "fulfilled" ? [r.value.trim()] : [])).filter(Boolean);
  if (texts.length === 0) {
    const failed = exported.find((r): r is PromiseRejectedResult => r.status === "rejected");
    if (failed) throw failed.reason;
    return null;
  }
  return { source: "gemini_notes", entries: [], text: texts.join("\n\n").slice(0, MAX_TRANSCRIPT_CHARS) };
}

/**
 * Confere o texto de uma reunião em `waiting_transcript` (a transcrição ou, sem ela, as anotações do Gemini).
 * Pronto: grava e a reunião vai para `processing`. Ainda gerando: espera, até o prazo. Sem nenhum dos dois 2 h
 * depois do fim, ou com a leitura no Google falhando depois desse prazo: `failed`.
 */
async function fetchTranscript(deps: MeetDeps, meet: MeetClient, m: MeetingRow): Promise<"ready" | "waiting" | "failed"> {
  const { db } = deps;
  const endedAt = Date.parse(m.ended_at ?? m.started_at ?? "");
  const late = !Number.isNaN(endedAt) && deps.now().getTime() - endedAt > TRANSCRIPT_DEADLINE_MS;

  const giveUp = async (lastError: string) => {
    const { error } = await db
      .from("meetings")
      .update({ status: "failed", last_error: lastError.slice(0, 500) })
      .eq("id", m.id)
      .eq("status", "waiting_transcript");
    check(error, "marcar a reunião sem transcrição");
    return "failed" as const;
  };

  // Leitura no Google. Se falhar depois do prazo, a reunião não fica esperando para sempre: vira `failed`.
  let read: MeetingText | null;
  try {
    read = await readMeetingText(meet, m, late);
  } catch (e) {
    if (!late) throw e;
    console.error("meet: transcrição ilegível depois do prazo", m.id, errorMessage(e));
    return giveUp(`${NO_MEETING_TEXT} (${errorMessage(e)})`);
  }
  if (!read) return late ? giveUp(NO_MEETING_TEXT) : "waiting";

  const saved = await db
    .from("meeting_transcripts")
    .upsert({ meeting_id: m.id, ...read }, { onConflict: "meeting_id" });
  check(saved.error, "gravar a transcrição");
  const moved = await db
    .from("meetings")
    .update({ status: "processing" })
    .eq("id", m.id)
    .eq("status", "waiting_transcript");
  check(moved.error, "marcar a reunião em processamento");
  return "ready";
}

// ---- processamento de uma reunião ------------------------------------------------------------------------------

type RecordContext = {
  kind: string;
  name: string;
  stage?: string;
  value?: number;
  setup?: number;
  mrr?: number;
  /** Etapas ativas do funil do negócio (vazio para lead e pessoa). */
  stages: string[];
  deletedAt: string | null;
  personId: string | null;
  organizationId: string | null;
  recentNotes: string[];
};

type NotesRow = {
  summary: string;
  pains: string[];
  objections: string[];
  qualification: MeetingNotes["qualification"];
  next_steps: MeetingNotes["next_steps"];
  raw: unknown;
  pipedrive_note_id: number | null;
};

const KIND_LABEL: Record<LinkEntity, string> = {
  deals: "negócio",
  leads: "lead",
  persons: "pessoa",
  organizations: "organização",
};

const num = (v: unknown): number | undefined => (v == null || Number.isNaN(Number(v)) ? undefined : Number(v));
const positive = (v: unknown): number | undefined => {
  const n = num(v);
  return n && n > 0 ? n : undefined;
};

/** Últimas 3 anotações do registro, da mais nova para a mais antiga, em texto. */
async function recentNotes(db: SupabaseClient, entity: LinkEntity, recordId: string): Promise<string[]> {
  const { data, error } = await db
    .from("notes")
    .select("body")
    .eq("entity", entity)
    .eq("record_id", recordId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(3);
  check(error, "ler as anotações do registro");
  return ((data ?? []) as { body: string }[]).map((n) => noteText(n.body)).filter(Boolean);
}

/** Contexto do registro vinculado para o Claude (e se ele está na lixeira). `null`: o registro não existe. */
async function loadRecord(db: SupabaseClient, entity: LinkEntity, id: string): Promise<RecordContext | null> {
  const base = { kind: KIND_LABEL[entity], stages: [] as string[] };
  if (entity === "deals") {
    const { data, error } = await db
      .from("deals")
      .select("id, title, pipeline_id, stage_id, estimated_value, setup_total, mrr, person_id, organization_id, deleted_at")
      .eq("id", id)
      .maybeSingle();
    check(error, "ler o negócio");
    if (!data) return null;
    const d = data as Record<string, unknown>;
    const stages = await db
      .from("stages")
      .select("id, name, position, archived_at")
      .eq("pipeline_id", d.pipeline_id as string)
      .order("position", { ascending: true });
    check(stages.error, "ler as etapas do funil");
    const rows = (stages.data ?? []) as { id: string; name: string; archived_at: string | null }[];
    return {
      ...base,
      name: String(d.title ?? ""),
      stage: rows.find((s) => s.id === d.stage_id)?.name,
      value: num(d.estimated_value),
      setup: positive(d.setup_total),
      mrr: positive(d.mrr),
      stages: rows.filter((s) => !s.archived_at).map((s) => s.name),
      deletedAt: (d.deleted_at as string | null) ?? null,
      personId: (d.person_id as string | null) ?? null,
      organizationId: (d.organization_id as string | null) ?? null,
      recentNotes: await recentNotes(db, entity, id),
    };
  }
  const columns: Record<Exclude<LinkEntity, "deals">, string> = {
    leads: "id, title, estimated_value, person_id, organization_id, deleted_at",
    persons: "id, full_name, organization_id, deleted_at",
    organizations: "id, name, deleted_at",
  };
  const { data, error } = await db.from(entity).select(columns[entity]).eq("id", id).maybeSingle();
  check(error, `ler o registro (${entity})`);
  if (!data) return null;
  const r = data as unknown as Record<string, unknown>;
  return {
    ...base,
    name: String(r.title ?? r.full_name ?? r.name ?? ""),
    value: entity === "leads" ? num(r.estimated_value) : undefined,
    deletedAt: (r.deleted_at as string | null) ?? null,
    personId: entity === "persons" ? id : ((r.person_id as string | null) ?? null),
    organizationId: entity === "organizations" ? id : ((r.organization_id as string | null) ?? null),
    recentNotes: await recentNotes(db, entity, id),
  };
}

/** Notas guardadas, com as sugestões da resposta validada (`raw`). O texto vem das colunas. */
function notesFromRow(row: NotesRow): MeetingNotes {
  const raw = MeetingNotesSchema.safeParse(row.raw);
  return {
    summary: row.summary ?? "",
    pains: row.pains ?? [],
    objections: row.objections ?? [],
    qualification: row.qualification ?? [],
    next_steps: row.next_steps ?? [],
    suggestions: raw.success ? raw.data.suggestions : { meeting_outcome: null, next_activity: null, stage: null },
  };
}

function participantLabel(a: Attendee): string {
  const who = a.name && a.email ? `${a.name} <${a.email}>` : a.name || a.email || UNKNOWN_SPEAKER;
  return a.internal ? `${who} (interno)` : who;
}

/** Gera as notas com o Claude (da transcrição ou das anotações do Gemini) e guarda em `meeting_notes` (ainda sem `pipedrive_note_id`). */
async function generateAndStore(
  deps: MeetDeps,
  m: MeetingRow,
  ctx: RecordContext | null,
  transcript: { text: string; source: TranscriptSource },
): Promise<MeetingNotes> {
  const { db } = deps;
  const company = await db.from("companies").select("settings").eq("id", m.company_id).maybeSingle();
  check(company.error, "ler a configuração da empresa");
  const { questions } = readMeetingSettings((company.data as { settings?: unknown } | null)?.settings);
  const names = await namesLoader(deps)();

  const input: NotesInput = {
    transcript: transcript.text,
    source: transcript.source,
    questions,
    title: m.title,
    startedAt: m.started_at ?? m.ended_at ?? "",
    participants: (m.attendees ?? []).map(participantLabel),
    record: ctx
      ? {
          kind: ctx.kind,
          name: ctx.name,
          stage: ctx.stage,
          value: ctx.value,
          setup: ctx.setup,
          mrr: ctx.mrr,
          recentNotes: ctx.recentNotes,
        }
      : { kind: "sem vínculo", name: "(nenhum registro vinculado)", recentNotes: [] },
    outcomes: names.outcomes,
    activityTypes: names.activityTypes,
    stages: ctx?.stages ?? [],
  };
  const notes = await deps.notes(input);

  const { error } = await db.from("meeting_notes").insert({
    meeting_id: m.id,
    summary: notes.summary,
    pains: notes.pains,
    objections: notes.objections,
    qualification: notes.qualification,
    next_steps: notes.next_steps,
    model: NOTES_MODEL,
    raw: notes,
  });
  check(error, "guardar as notas");
  return notes;
}

/** Status `unlinked` e o aviso ao dono (um só por reunião: o índice único barra o repetido). */
async function markUnlinked(db: SupabaseClient, m: MeetingRow, lastError: string | null): Promise<void> {
  const { error } = await db.from("meetings").update({ status: "unlinked", last_error: lastError }).eq("id", m.id);
  check(error, "marcar a reunião sem vínculo");
  const notified = await db.from("notifications").insert({
    user_id: m.owner_id,
    company_id: m.company_id,
    kind: "meeting_unlinked",
    meeting_id: m.id,
    title: "Reunião sem vínculo",
    body: `"${m.title}" precisa de um registro do CRM. Sem decisão em 7 dias, ela é descartada.`,
  });
  if (notified.error && notified.error.code !== "23505") {
    console.error("meet: falha ao avisar reunião sem vínculo", m.id, notified.error.message);
  }
}

export async function pipedriveIdOf(
  db: SupabaseClient,
  companyId: string,
  entity: string,
  recordId: string | null,
): Promise<string | null> {
  if (!recordId) return null;
  const { data, error } = await db
    .from("external_ids")
    .select("external_id")
    .eq("source", "pipedrive")
    .eq("entity", entity)
    .eq("company_id", companyId)
    .eq("record_id", recordId)
    .limit(1)
    .maybeSingle();
  check(error, "ler o id do Pipedrive");
  return (data as { external_id: string } | null)?.external_id ?? null;
}

async function sinkTarget(
  db: SupabaseClient,
  m: Pick<MeetingRow, "company_id">,
  entity: SinkTarget["entity"],
  recordId: string,
  ctx: RecordContext,
): Promise<SinkTarget> {
  const pipedriveId = await pipedriveIdOf(db, m.company_id, entity, recordId);
  if (!pipedriveId) throw new Error("O registro vinculado não tem id no Pipedrive.");
  return {
    entity,
    pipedriveId,
    personPipedriveId: entity === "persons" ? null : await pipedriveIdOf(db, m.company_id, "persons", ctx.personId),
    orgPipedriveId: await pipedriveIdOf(db, m.company_id, "organizations", ctx.organizationId),
  };
}

/**
 * Destino da gravação no Pipedrive para um registro vivo da empresa (ações do vendedor).
 * Lança em português se o registro não existe, está na lixeira ou ainda não tem id no Pipedrive.
 */
export async function resolveSinkTarget(
  db: SupabaseClient,
  companyId: string,
  entity: SinkTarget["entity"],
  recordId: string,
): Promise<SinkTarget> {
  const ctx = await loadRecord(db, entity, recordId);
  if (!ctx || ctx.deletedAt) throw new Error("O registro não existe ou está na lixeira.");
  return sinkTarget(db, { company_id: companyId }, entity, recordId, ctx);
}

/**
 * Sugestões não nulas em `pending`. Uma por tipo (índice único `meeting_id, kind`): tipos que já têm sugestão
 * (tentativa anterior, chamada concorrente, ou decidida antes de um novo vínculo) não são recriados nem alterados.
 */
async function createSuggestions(
  db: SupabaseClient,
  meetingId: string,
  entity: LinkEntity,
  s: MeetingNotes["suggestions"],
): Promise<void> {
  const rows: SuggestionPayload[] = [];
  if (s.meeting_outcome) rows.push({ kind: "meeting_outcome", payload: { outcome: s.meeting_outcome } });
  if (s.next_activity) rows.push({ kind: "next_activity", payload: s.next_activity });
  // Etapa só existe em negócio.
  if (s.stage && entity === "deals") rows.push({ kind: "stage", payload: { stage: s.stage } });
  if (rows.length === 0) return;
  const { error } = await db
    .from("meeting_suggestions")
    .upsert(
      rows.map((r) => ({ meeting_id: meetingId, kind: r.kind, payload: r.payload, status: "pending" })),
      { onConflict: "meeting_id,kind", ignoreDuplicates: true },
    );
  check(error, "criar as sugestões");
}

/** Vínculo, notas e gravação. Lança em caso de erro (quem chama conta a tentativa). */
async function advance(deps: MeetDeps, m: MeetingRow): Promise<MeetingStatus> {
  const { db } = deps;

  // 0. Notas guardadas (tentativa anterior) ou a transcrição para gerar as novas. Sem nenhuma das duas não há
  //    o que fazer, e o vínculo nem é procurado.
  const stored = await db
    .from("meeting_notes")
    .select("summary, pains, objections, qualification, next_steps, raw, pipedrive_note_id")
    .eq("meeting_id", m.id)
    .maybeSingle();
  check(stored.error, "ler as notas guardadas");
  const notesRow = stored.data as NotesRow | null;
  let transcript: { text: string; source: TranscriptSource } = { text: "", source: "transcript" };
  if (!notesRow) {
    const t = await db.from("meeting_transcripts").select("text, source").eq("meeting_id", m.id).maybeSingle();
    check(t.error, "ler a transcrição");
    if (!t.data) throw new Error(NO_TRANSCRIPT);
    const row = t.data as { text: string; source?: string | null };
    transcript = { text: row.text, source: row.source === "gemini_notes" ? "gemini_notes" : "transcript" };
  }

  // 1. Vínculo: o já gravado (casado antes ou escolhido pelo vendedor) ou o casador.
  let link: { entity: LinkEntity; recordId: string } | null =
    m.entity && m.record_id ? { entity: m.entity, recordId: m.record_id } : null;
  if (!link) {
    const external = (m.attendees ?? []).filter((a) => a.email && !a.internal).map((a) => a.email as string);
    const candidates = await loadCandidates(db, m.company_id, external);
    const picked = pickRecord(candidates, new Date(m.started_at ?? m.ended_at ?? deps.now()));
    if (picked) {
      const { error } = await db
        .from("meetings")
        .update({ entity: picked.entity, record_id: picked.recordId, anchor_activity_id: picked.anchorActivityId })
        .eq("id", m.id);
      check(error, "gravar o vínculo da reunião");
      link = { entity: picked.entity, recordId: picked.recordId };
    }
  }

  // 2. Notas: as guardadas (tentativa anterior) ou novas, do Claude.
  const ctx = link ? await loadRecord(db, link.entity, link.recordId) : null;
  const notes = notesRow ? notesFromRow(notesRow) : await generateAndStore(deps, m, ctx, transcript);

  // 3. Destino: sem vínculo ou registro na lixeira ficam em "Sem vínculo", sem gravar no Pipedrive.
  if (!link) {
    await markUnlinked(db, m, null);
    return "unlinked";
  }
  if (!ctx || ctx.deletedAt) {
    await markUnlinked(db, m, RECORD_DELETED);
    return "unlinked";
  }
  if (link.entity === "organizations") throw new Error("Reunião vinculada a organização não é gravada no Pipedrive.");

  // 4. Anotação, uma vez só: o id do Pipedrive é guardado logo depois da gravação.
  if (notesRow?.pipedrive_note_id == null) {
    const target = await sinkTarget(db, m, link.entity, link.recordId, ctx);
    const userId = await pipedriveUserFor(db, m.owner_id);
    const owner = await db.from("profiles").select("full_name").eq("id", m.owner_id).maybeSingle();
    check(owner.error, "ler o vendedor");
    const html = renderNoteHtml(notes, {
      startedAt: m.started_at ?? m.ended_at ?? deps.now().toISOString(),
      ownerName: (owner.data as { full_name?: string } | null)?.full_name || "vendedor",
      mappedUser: userId != null,
    });
    let noteId: number;
    try {
      ({ noteId } = await deps.sink.writeNote(target, html, userId));
    } catch (e) {
      // Registro apagado no Pipedrive e ainda não trazido pela sincronização: igual ao registro na lixeira
      // (spec, "Erros"). Volta para Sem vínculo, sem gastar tentativa.
      if (isRecordGone(e)) {
        await markUnlinked(db, m, RECORD_DELETED);
        return "unlinked";
      }
      throw e;
    }
    const saved = await db
      .from("meeting_notes")
      .update({ pipedrive_note_id: noteId, written_at: deps.now().toISOString() })
      .eq("meeting_id", m.id)
      .is("pipedrive_note_id", null);
    if (saved.error) {
      // Raro e grave: a próxima tentativa gravaria a anotação de novo no Pipedrive.
      console.error("meet: anotação gravada no Pipedrive sem registrar o id", m.id, noteId, saved.error.message);
      throw new Error(`A anotação ${noteId} foi gravada no Pipedrive, mas o id não foi guardado: ${saved.error.message}`);
    }
  }

  // 5. Sugestões e conclusão.
  await createSuggestions(db, m.id, link.entity, notes.suggestions);
  const { error } = await db.from("meetings").update({ status: "done", last_error: null }).eq("id", m.id);
  check(error, "concluir a reunião");
  // Se ela passou por Sem vínculo, o aviso do sino já foi resolvido.
  await markUnlinkedNoticesRead(db, [m.id], deps.now());
  return "done";
}

/** 404 ou 410 do Pipedrive ao gravar a anotação: o registro foi apagado lá. */
const isRecordGone = (e: unknown) => e instanceof SinkError && (e.status === 404 || e.status === 410);

/** Processa uma reunião e conta a tentativa em caso de erro. Devolve o status final (ou `skipped`). */
async function runProcess(deps: MeetDeps, meetingId: string): Promise<MeetingStatus | "skipped"> {
  const { db } = deps;
  const { data, error } = await db.from("meetings").select(MEETING_COLUMNS).eq("id", meetingId).maybeSingle();
  check(error, "ler a reunião");
  const m = data as MeetingRow | null;
  // Só a reunião em `processing`: quem chama já a reivindicou (a rodada ao ler a transcrição ou na
  // retentativa; as ações ao vincular ou tentar de novo).
  if (!m || m.status !== "processing") return "skipped";
  try {
    return await advance(deps, m);
  } catch (e) {
    const msg = errorMessage(e).slice(0, 500);
    const attempts = (m.attempts ?? 0) + 1;
    const status: MeetingStatus = attempts >= MAX_ATTEMPTS ? "failed" : "processing";
    console.error("meet: falha ao processar a reunião", m.id, msg);
    // Condicional: se outra chamada já concluiu a reunião (ou ela saiu de `processing`), o erro desta não
    // a traz de volta.
    const saved = await db
      .from("meetings")
      .update({ attempts, last_error: msg, status })
      .eq("id", m.id)
      .eq("status", "processing");
    if (saved.error) console.error("meet: falha ao registrar a tentativa", m.id, saved.error.message);
    return status;
  }
}

/**
 * Vínculo (casador ou o já gravado), notas (as guardadas ou novas, do Claude), anotação no Pipedrive e
 * sugestões. Erro conta tentativa (`attempts`, `last_error`); na terceira, `failed`.
 */
export async function processMeeting(deps: MeetDeps, meetingId: string): Promise<void> {
  await runProcess(deps, meetingId);
}
