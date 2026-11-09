import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { GmailApiError, GmailAuthError, GmailNetworkError, GmailRateLimitError } from "@/lib/gmail/client";
import { recordHref, type RecordEntity } from "@/lib/records/types";
import type { CalendarClient, CalendarEvent } from "./google";
import { activityToEvent, DEFAULT_MINUTES, outboundOp, wantsInvite, type ActivityForCalendar } from "./mapping";

/**
 * Saída da sincronização com a Agenda do Google (CRM → Agenda): envia uma atividade e grava de volta o estado do
 * evento. A volta passa pela função `calendar_mark_synced`, que liga a marca de sessão `oxyn.calendar_inbound`: assim
 * o gatilho `activities_calendar_pending` não marca a atividade como pendente de novo.
 */

export type CalendarDeps = { db: SupabaseClient; clientFor(accountId: string): CalendarClient; now(): Date; appUrl: string };

/** Tentativas seguidas com erro antes de a atividade ficar só no "Tentar de novo" (o cron para de reenviar). */
export const MAX_CALENDAR_ATTEMPTS = 3;

/** Escopo de leitura e escrita de eventos que a caixa precisa ter concedido. */
export const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.events";
/** Limite do texto de erro gravado (como o `last_error` das caixas). */
const MAX_ERROR = 500;
const MINUTE_MS = 60_000;

type AccountRow = { id: string; email: string; company_id: string; status: string; scopes: string[] | null };

type ActivityRow = {
  id: string;
  company_id: string;
  owner_id: string;
  type_id: string;
  person_id: string | null;
  deal_id: string | null;
  lead_id: string | null;
  organization_id: string | null;
  subject: string;
  description: string | null;
  due_at: string;
  duration_minutes: number;
  done: boolean;
  meeting_outcome: string | null;
  deleted_at: string | null;
  updated_at: string;
  calendar_account_id: string | null;
  calendar_event_id: string | null;
  calendar_state: string;
  calendar_attempts: number;
};

const ACTIVITY_COLUMNS =
  "id, company_id, owner_id, type_id, person_id, deal_id, lead_id, organization_id, subject, description, due_at, " +
  "duration_minutes, done, meeting_outcome, deleted_at, updated_at, calendar_account_id, calendar_event_id, " +
  "calendar_state, calendar_attempts";

/** Colunas que `calendar_mark_synced` grava (chave ausente mantém o valor). */
type CalendarFields = {
  calendar_account_id?: string | null;
  calendar_event_id?: string | null;
  calendar_etag?: string | null;
  calendar_state?: "pending" | "synced" | "error";
  calendar_error?: string | null;
  calendar_attempts?: number;
  meet_url?: string | null;
};

const IN_SYNC: CalendarFields = { calendar_state: "synced", calendar_error: null, calendar_attempts: 0 };

/** Erro do banco: sobe para quem chamou (não é falha do Google, não vira `calendar_state = 'error'`). */
class CalendarDbError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CalendarDbError";
  }
}

function check(error: { message: string } | null, what: string): void {
  if (error) throw new CalendarDbError(`Falha ao ${what}: ${error.message}`);
}

/** O evento não existe mais no Google (apagado de vez): o `patch` responde 404 ou 410. */
const isGone = (e: unknown) => e instanceof GmailApiError && (e.status === 404 || e.status === 410);

/** Só o booleano `true` liga a Agenda na empresa (como `calendar_sync_enabled` no banco). */
export function calendarEnabled(settings: unknown): boolean {
  const sync = (settings as { calendar_sync?: { enabled?: unknown } } | null)?.calendar_sync;
  return sync?.enabled === true;
}

/** E-mail da pessoa: o marcado como principal, senão o primeiro da lista (`[{ value, label?, primary? }]`). */
function primaryEmail(emails: unknown): string | null {
  if (!Array.isArray(emails)) return null;
  const items = emails as { value?: unknown; primary?: unknown }[];
  const item = items.find((e) => e?.primary === true) ?? items[0];
  return typeof item?.value === "string" && item.value.trim() ? item.value.trim() : null;
}

/** URL do registro da atividade no CRM, pelo vínculo de maior precedência (negócio, lead, pessoa, organização). */
function recordUrl(appUrl: string, slug: string | null, r: ActivityRow): string | null {
  const base = appUrl.trim().replace(/\/+$/, "");
  if (!base || !slug) return null;
  const links: [RecordEntity, string | null][] = [
    ["deals", r.deal_id],
    ["leads", r.lead_id],
    ["persons", r.person_id],
    ["organizations", r.organization_id],
  ];
  const link = links.find(([, id]) => id);
  return link ? `${base}${recordHref(link[0], slug, link[1]!)}` : null;
}

async function personEmail(db: SupabaseClient, personId: string | null): Promise<string | null> {
  if (!personId) return null;
  const { data, error } = await db.from("persons").select("emails, deleted_at").eq("id", personId).maybeSingle();
  check(error, "ler a pessoa da atividade");
  const person = data as { emails: unknown; deleted_at: string | null } | null;
  // Pessoa na lixeira não recebe convite.
  return person && !person.deleted_at ? primaryEmail(person.emails) : null;
}

async function isMeetingType(db: SupabaseClient, typeId: string): Promise<boolean> {
  const { data, error } = await db.from("activity_types").select("is_meeting").eq("id", typeId).maybeSingle();
  check(error, "ler o tipo da atividade");
  return (data as { is_meeting: boolean } | null)?.is_meeting === true;
}

/** A caixa ainda existe? (Desconectada, a linha é apagada e o evento que ficou na Agenda dela sai do alcance.) */
async function accountExists(db: SupabaseClient, accountId: string): Promise<boolean> {
  const { data, error } = await db.from("email_accounts").select("id").eq("id", accountId).maybeSingle();
  check(error, "ler a caixa do evento");
  return !!data;
}

/** Grava as colunas da Agenda com a marca de sessão (o gatilho de pendente não dispara). */
async function markSynced(db: SupabaseClient, activityId: string, fields: CalendarFields): Promise<void> {
  const { error } = await db.rpc("calendar_mark_synced", { p_activity: activityId, p_fields: fields });
  check(error, "gravar o estado da Agenda na atividade");
}

/** Token recusado mesmo depois de renovar: a caixa vai para "reconectar", como na sincronização do Gmail. */
export async function markReconnect(db: SupabaseClient, accountId: string, msg: string): Promise<void> {
  const { error } = await db
    .from("email_accounts")
    .update({ status: "reconnect", last_error: msg.slice(0, MAX_ERROR) })
    .eq("id", accountId)
    .eq("status", "active");
  if (error) console.error("agenda: falha ao marcar reconexão:", error.message);
}

/**
 * Caixa que recebe a atividade: do dono na empresa da atividade; senão a mais antiga do dono; ativa e com o escopo da
 * Agenda. A escolha vem antes da conferência: se a caixa escolhida está em "reconectar" ou sem o escopo, devolve
 * `null` (a atividade espera a reconexão) em vez de passar o evento para outra caixa do dono.
 */
export async function calendarAccountFor(
  db: SupabaseClient,
  ownerId: string,
  companyId: string,
): Promise<{ id: string; email: string } | null> {
  const { data, error } = await db
    .from("email_accounts")
    .select("id, email, company_id, status, scopes")
    .eq("user_id", ownerId)
    .order("created_at", { ascending: true });
  check(error, "ler as caixas do dono da atividade");
  const rows = (data ?? []) as AccountRow[];
  const chosen = rows.find((r) => r.company_id === companyId) ?? rows[0];
  if (!chosen || chosen.status !== "active" || !(chosen.scopes ?? []).includes(CALENDAR_SCOPE)) return null;
  return { id: chosen.id, email: chosen.email };
}

/**
 * Envia uma atividade pendente. Devolve o estado final. Nunca lança por erro do Google (grava `error`).
 *
 * - `skipped`: nada a enviar, e a atividade fica como estava. Vale para empresa com a Agenda desligada, atividade que
 *   não existe ou já em dia (`synced`), e dono sem caixa utilizável.
 * - `deferred`: o envio ficou para depois, e a atividade continua pendente sem contar tentativa. Vale para limite de
 *   uso do Google (o cron para a rodada da caixa), falha de rede e token recusado (a caixa vai para "reconectar").
 * - `synced`: o evento ficou igual à atividade. Ele foi criado, atualizado ou apagado, ou não havia nada a fazer, como
 *   na atividade concluída.
 * - `error`: o Google recusou. Grava a mensagem e conta a tentativa (o cron reenvia até `MAX_CALENDAR_ATTEMPTS`).
 *
 * Convidados e Meet só entram na criação; a atualização não mexe neles. Convite e avisos ao cliente
 * (`sendUpdates: "all"`) só valem para reunião que ainda não terminou, e nunca com `invite: false` (primeira rodada).
 * Evento apagado de vez no Google (404/410 no `patch`) é criado de novo, porque a atividade continua aberta.
 * Lança só por erro do banco. Se a gravação de volta falhar depois de criar o evento, ele fica na Agenda sem vínculo
 * (leva `oxynActivityId` nas propriedades privadas).
 */
export async function pushActivity(
  deps: CalendarDeps,
  activityId: string,
  opts?: { invite?: boolean },
): Promise<"synced" | "error" | "skipped" | "deferred"> {
  const { db } = deps;
  const found = await db.from("activities").select(ACTIVITY_COLUMNS).eq("id", activityId).maybeSingle();
  check(found.error, "ler a atividade");
  const r = found.data as ActivityRow | null;
  if (!r) return "skipped";

  const company = await db.from("companies").select("slug, settings").eq("id", r.company_id).maybeSingle();
  check(company.error, "ler a empresa da atividade");
  const co = company.data as { slug: string; settings: unknown } | null;
  if (!co || !calendarEnabled(co.settings)) return "skipped";
  // Já em dia: a gravação não mudou nada que aparece no evento (o gatilho não a marcou como pendente).
  if (r.calendar_state === "synced") return "skipped";

  const [isMeeting, email] = await Promise.all([isMeetingType(db, r.type_id), personEmail(db, r.person_id)]);
  const a: ActivityForCalendar = {
    id: r.id,
    companyId: r.company_id,
    ownerId: r.owner_id,
    subject: r.subject,
    description: r.description,
    dueAt: r.due_at,
    durationMinutes: r.duration_minutes,
    done: r.done,
    meetingOutcome: r.meeting_outcome,
    deletedAt: r.deleted_at,
    isMeeting,
    personEmail: email,
    recordUrl: recordUrl(deps.appUrl, co.slug, r),
    calendarEventId: r.calendar_event_id,
    calendarAccountId: r.calendar_account_id,
    updatedAt: r.updated_at,
  };

  const op = outboundOp(a);
  if (op.op === "none") {
    await markSynced(db, a.id, IN_SYNC);
    return "synced";
  }

  // Reunião que já terminou (registro de reunião passada) não convida nem avisa o cliente.
  const minutes = a.durationMinutes > 0 ? a.durationMinutes : DEFAULT_MINUTES;
  const upcoming = Date.parse(a.dueAt) + minutes * MINUTE_MS > deps.now().getTime();
  const notifyClient = opts?.invite !== false && upcoming;

  let target: { id: string; email: string } | null = null;
  if (op.op !== "delete") {
    target = await calendarAccountFor(db, a.ownerId, a.companyId);
    if (!target) return "skipped";
  }

  // Caixa onde está o evento, quando é preciso apagá-lo lá (lixeira, cancelada ou dono trocado). Sem a linha (caixa
  // desconectada), o evento ficou fora de alcance e só o vínculo é desfeito.
  const leaving = op.op === "delete" || (op.op === "update" && a.calendarAccountId !== target!.id);
  const eventAccount =
    leaving && a.calendarAccountId && (await accountExists(db, a.calendarAccountId)) ? a.calendarAccountId : null;
  const unlinked: CalendarFields = { calendar_account_id: null, calendar_event_id: null, calendar_etag: null, meet_url: null };

  let using: string | null = null;
  const calendar = (accountId: string): CalendarClient => {
    using = accountId;
    return deps.clientFor(accountId);
  };

  let fields: CalendarFields;
  try {
    if (op.op === "delete") {
      const sendUpdates = op.notify && notifyClient ? "all" : "none";
      if (eventAccount) await calendar(eventAccount).deleteEvent(a.calendarEventId!, { sendUpdates });
      fields = { ...IN_SYNC, ...unlinked };
    } else {
      const invite = notifyClient && wantsInvite(a);
      const sendUpdates = invite ? "all" : "none";
      let patched: CalendarEvent | null = null;
      if (op.op === "update" && !leaving) {
        // Atualizar nunca mexe nos convidados nem no Meet (os dois só entram na criação): sem `attendees` e sem
        // `conferenceData`, o `patch` mantém os do evento. Os convidados que já existem são avisados da mudança.
        const changes = activityToEvent(a, { invite: false });
        delete changes.attendees;
        delete changes.conferenceData;
        try {
          patched = await calendar(target!.id).patchEvent(a.calendarEventId!, changes, { sendUpdates });
        } catch (e) {
          // Evento apagado de vez no Google: a atividade continua aberta, então o evento nasce de novo abaixo.
          if (!isGone(e)) throw e;
        }
      } else if (op.op === "update" && eventAccount) {
        // Dono trocado: o evento sai da Agenda da caixa antiga antes de nascer na nova. O vínculo é desfeito já,
        // para a entrada da caixa antiga não tratar o evento apagado como reunião cancelada se a criação falhar.
        await calendar(eventAccount).deleteEvent(a.calendarEventId!, { sendUpdates });
        await markSynced(db, a.id, unlinked);
      }
      if (patched) {
        fields = { ...IN_SYNC, calendar_etag: patched.etag ?? null };
        // Sem link no retorno, o que já estava gravado continua.
        if (patched.hangoutLink) fields.meet_url = patched.hangoutLink;
      } else {
        const created = await calendar(target!.id).insertEvent(activityToEvent(a, { invite }), {
          sendUpdates,
          withMeet: invite,
        });
        fields = {
          ...IN_SYNC,
          calendar_account_id: target!.id,
          calendar_event_id: created.id,
          calendar_etag: created.etag ?? null,
          meet_url: created.hangoutLink ?? null,
        };
      }
    }
  } catch (e) {
    if (e instanceof CalendarDbError) throw e;
    return recordFailure(db, r, using, e);
  }

  await markSynced(db, a.id, fields);
  return "synced";
}

/**
 * Erro ao falar com o Google. Limite de uso e falha de rede são passageiros: a atividade fica como estava e o cron
 * tenta de novo, sem contar tentativa. Token recusado também não conta: a caixa vai para "reconectar" (o
 * `loadAccountToken` já faz isso no `invalid_grant`; aqui cobre o token recusado depois de renovado). O resto grava
 * `error` com a mensagem e conta a tentativa.
 */
async function recordFailure(
  db: SupabaseClient,
  r: ActivityRow,
  accountId: string | null,
  e: unknown,
): Promise<"error" | "deferred"> {
  const msg = (e instanceof Error ? e.message : String(e)) || "Falha ao atualizar a Agenda";
  if (e instanceof GmailRateLimitError || e instanceof GmailNetworkError) return "deferred";
  if (e instanceof GmailAuthError) {
    if (accountId) await markReconnect(db, accountId, msg);
    return "deferred";
  }
  await markSynced(db, r.id, {
    calendar_state: "error",
    calendar_error: msg.slice(0, MAX_ERROR),
    calendar_attempts: r.calendar_attempts + 1,
  });
  return "error";
}
