import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { GmailApiError, GmailAuthError, GmailNetworkError, GmailRateLimitError } from "@/lib/gmail/client";
import { hasCalendarScope } from "@/lib/gmail/connect";
import { recordHref, type RecordEntity } from "@/lib/records/types";
import type { CalendarClient, CalendarEvent } from "./google";
import {
  activityToEvent,
  calendarEventId,
  DEFAULT_MINUTES,
  eventGuests,
  FROM_CALENDAR,
  meetingLink,
  outboundOp,
  primaryEmail,
  wantsInvite,
  type ActivityForCalendar,
} from "./mapping";
import { readCalendarSettings } from "./settings";

/**
 * Saída da sincronização com a Agenda do Google (CRM → Agenda): envia uma atividade e grava de volta o estado do
 * evento. A volta passa pela função `calendar_mark_synced`, que liga a marca de sessão `oxyn.calendar_inbound`: assim
 * o gatilho `activities_calendar_pending` não marca a atividade como pendente de novo.
 */

export type CalendarDeps = { db: SupabaseClient; clientFor(accountId: string): CalendarClient; now(): Date; appUrl: string };

/** Tentativas seguidas com erro antes de a atividade ficar só no "Tentar de novo" (o cron para de reenviar). */
export const MAX_CALENDAR_ATTEMPTS = 3;

/** Limite do texto de erro gravado (como o `last_error` das caixas). */
const MAX_ERROR = 500;
const MINUTE_MS = 60_000;

type AccountRow = {
  id: string;
  email: string;
  company_id: string;
  status: string;
  scopes: string[] | null;
  calendar_since: string | null;
};

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
  source: string;
  meet_url: string | null;
  calendar_invited_email: string | null;
  calendar_generation: number;
  calendar_is_organizer: boolean | null;
};

const ACTIVITY_COLUMNS =
  "id, company_id, owner_id, type_id, person_id, deal_id, lead_id, organization_id, subject, description, due_at, " +
  "duration_minutes, done, meeting_outcome, deleted_at, updated_at, calendar_account_id, calendar_event_id, " +
  "calendar_state, calendar_attempts, source, meet_url, calendar_invited_email, calendar_generation, calendar_is_organizer";

/** Colunas que `calendar_mark_synced` grava (chave ausente mantém o valor). */
type CalendarFields = {
  calendar_account_id?: string | null;
  calendar_event_id?: string | null;
  calendar_etag?: string | null;
  calendar_state?: "pending" | "synced" | "error";
  calendar_error?: string | null;
  calendar_attempts?: number;
  meet_url?: string | null;
  calendar_invited_email?: string | null;
  calendar_generation?: number;
};

const IN_SYNC: CalendarFields = { calendar_state: "synced", calendar_error: null, calendar_attempts: 0 };
/** Vínculo desfeito: a atividade fica sem evento (o próximo envio, se houver, cria outro). */
const UNLINKED: CalendarFields = {
  calendar_account_id: null,
  calendar_event_id: null,
  calendar_etag: null,
  meet_url: null,
  calendar_invited_email: null,
};

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
/** Já existe evento com o id enviado na criação. */
const isConflict = (e: unknown) => e instanceof GmailApiError && e.status === 409;
const sameEmail = (a: string | null | undefined, b: string | null | undefined) =>
  !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();

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

/**
 * E-mail de quem a reunião convida: a pessoa da atividade; sem pessoa, a do negócio, senão a do lead. Vale para o
 * convite, para o aviso de cancelamento e para o aviso do formulário (mesma regra).
 */
async function inviteeEmail(db: SupabaseClient, r: ActivityRow): Promise<string | null> {
  let personId = r.person_id;
  for (const [table, id] of [
    ["deals", r.deal_id],
    ["leads", r.lead_id],
  ] as const) {
    if (personId || !id) continue;
    const { data, error } = await db.from(table).select("person_id").eq("id", id).maybeSingle();
    check(error, table === "deals" ? "ler a pessoa do negócio" : "ler a pessoa do lead");
    personId = (data as { person_id: string | null } | null)?.person_id ?? null;
  }
  return personEmail(db, personId);
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
 *
 * `ready` é falso enquanto a caixa não fez a primeira rodada (`calendar_since` nulo): até lá só a primeira rodada envia,
 * porque ela adota os eventos que o Pipedrive deixou e decide quem convida (não pode haver convite duplicado).
 */
export async function calendarAccountFor(
  db: SupabaseClient,
  ownerId: string,
  companyId: string,
): Promise<{ id: string; email: string; ready: boolean } | null> {
  const { data, error } = await db
    .from("email_accounts")
    .select("id, email, company_id, status, scopes, calendar_since")
    .eq("user_id", ownerId)
    .order("created_at", { ascending: true });
  check(error, "ler as caixas do dono da atividade");
  const rows = (data ?? []) as AccountRow[];
  const chosen = rows.find((r) => r.company_id === companyId) ?? rows[0];
  if (!chosen || chosen.status !== "active" || !hasCalendarScope(chosen.scopes)) return null;
  return { id: chosen.id, email: chosen.email, ready: chosen.calendar_since != null };
}

/**
 * Envia uma atividade pendente. Devolve o estado final. Nunca lança por erro do Google (grava `error`).
 *
 * - `skipped`: nada a enviar, e a atividade fica como estava. Vale para empresa com a Agenda desligada, atividade que
 *   não existe ou já em dia (`synced`), dono sem caixa utilizável e caixa que ainda não fez a primeira rodada
 *   (`calendar_since` nulo): só o envio da primeira rodada (`invite: false`, ou `firstRun`) passa por ela. Assim, entre
 *   ligar a Agenda e a primeira rodada, uma gravação na hora não manda convite que o Pipedrive já mandou; é a primeira
 *   rodada que decide quem convida (`firstRun` sem `invite: false`: a reunião criada depois de ligar a Agenda).
 * - `deferred`: o envio ficou para depois, e a atividade continua pendente sem contar tentativa. Vale para limite de
 *   uso do Google (o cron para a rodada da caixa), falha de rede e token recusado (a caixa vai para "reconectar").
 * - `synced`: o evento ficou igual à atividade. Ele foi criado, atualizado ou apagado, ou não havia nada a fazer, como
 *   na atividade concluída.
 * - `error`: o Google recusou. Grava a mensagem e conta a tentativa (o cron reenvia até `MAX_CALENDAR_ATTEMPTS`).
 *
 * Convidados e Meet entram na criação e, na atualização, só quando a reunião passa a convidar alguém que o evento
 * ainda não convidou (pessoa escolhida depois, tipo trocado para reunião): o cliente entra nos convidados que o evento
 * já tem, sem tirar ninguém. Convite e avisos ao cliente (`sendUpdates: "all"`) só valem para reunião que ainda não
 * terminou, e nunca com `invite: false` (primeira rodada). Evento com convidado leva só o título (`activityToEvent`).
 * A criação manda o id do evento (`calendarEventId`): repetida, responde 409 e o evento que já existe é religado.
 * Evento apagado de vez no Google (404/410 no `patch`) é criado de novo, com a geração seguinte do id, porque a
 * atividade continua aberta. Evento que nasceu na Agenda nunca é apagado nem criado: a lixeira e a conclusão só
 * desfazem o vínculo (`outboundOp`). Lança só por erro do banco. Se a gravação de volta falhar depois de criar o
 * evento, ele fica na Agenda sem vínculo (leva `oxynActivityId` e o id determinístico: o próximo envio o religa).
 */
export async function pushActivity(
  deps: CalendarDeps,
  activityId: string,
  opts?: { invite?: boolean; firstRun?: boolean },
): Promise<"synced" | "error" | "skipped" | "deferred"> {
  const { db } = deps;
  const found = await db.from("activities").select(ACTIVITY_COLUMNS).eq("id", activityId).maybeSingle();
  check(found.error, "ler a atividade");
  const r = found.data as ActivityRow | null;
  if (!r) return "skipped";

  const company = await db.from("companies").select("slug, settings").eq("id", r.company_id).maybeSingle();
  check(company.error, "ler a empresa da atividade");
  const co = company.data as { slug: string; settings: unknown } | null;
  if (!co || !readCalendarSettings(co.settings).enabled) return "skipped";
  // Já em dia: a gravação não mudou nada que aparece no evento (o gatilho não a marcou como pendente).
  if (r.calendar_state === "synced") return "skipped";

  const [isMeeting, email] = await Promise.all([isMeetingType(db, r.type_id), inviteeEmail(db, r)]);
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
    source: r.source,
    isOrganizer: r.calendar_is_organizer === true,
    invitedEmail: r.calendar_invited_email,
  };

  const now = deps.now();
  const op = outboundOp(a, now);
  if (op.op === "none") {
    await markSynced(db, a.id, IN_SYNC);
    return "synced";
  }
  // Evento que nasceu na Agenda é do vendedor: a lixeira e a conclusão só desfazem o vínculo, sem chamar o Google.
  if (op.op === "unlink") {
    await markSynced(db, a.id, { ...IN_SYNC, ...UNLINKED });
    return "synced";
  }

  // Reunião que já terminou (registro de reunião passada) não convida nem avisa o cliente.
  const minutes = a.durationMinutes > 0 ? a.durationMinutes : DEFAULT_MINUTES;
  const upcoming = Date.parse(a.dueAt) + minutes * MINUTE_MS > now.getTime();
  const notifyClient = opts?.invite !== false && upcoming;

  // A apagada (lixeira, cancelada) não escolhe caixa nova nem convida: só desfaz o evento que já existe, então não
  // espera a primeira rodada.
  let target: { id: string; email: string } | null = null;
  if (op.op !== "delete") {
    const account = await calendarAccountFor(db, a.ownerId, a.companyId);
    if (!account) return "skipped";
    // Caixa da primeira rodada ainda por fazer: a atividade espera, pendente, sem chamar o Google.
    if (!account.ready && opts?.invite !== false && !opts?.firstRun) return "skipped";
    target = account;
  }

  // Dono trocado (o evento está noutra caixa). O evento que nasceu na Agenda fica onde está, ligado à atividade.
  const moving = op.op === "update" && a.calendarAccountId !== target!.id;
  if (moving && a.source === FROM_CALENDAR) {
    await markSynced(db, a.id, IN_SYNC);
    return "synced";
  }
  // Caixa onde está o evento, quando é preciso apagá-lo lá (lixeira, cancelada ou dono trocado). Sem a linha (caixa
  // desconectada), o evento ficou fora de alcance e só o vínculo é desfeito.
  const leaving = op.op === "delete" || moving;
  const eventAccount =
    leaving && a.calendarAccountId && (await accountExists(db, a.calendarAccountId)) ? a.calendarAccountId : null;
  // Geração do id do evento: um evento novo para a atividade (depois de apagar o anterior) usa a seguinte, porque o
  // Google não reaproveita o id de um evento apagado.
  let generation = r.calendar_generation ?? 0;

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
      fields = { ...IN_SYNC, ...UNLINKED, calendar_generation: generation + 1 };
    } else {
      const invite = notifyClient && wantsInvite(a);
      const sendUpdates = invite ? "all" : "none";
      let patched: CalendarFields | null = null;
      if (op.op === "update" && !moving) {
        try {
          patched = await updateEvent(calendar(target!.id), a, r.meet_url, { invite, sendUpdates, selfEmail: target!.email });
        } catch (e) {
          // Evento apagado de vez no Google: a atividade continua aberta, então o evento nasce de novo abaixo.
          if (!isGone(e)) throw e;
          generation += 1;
        }
      } else if (moving) {
        // Dono trocado: o vínculo é desfeito antes de apagar o evento na caixa antiga. Assim a entrada dela nunca trata
        // o evento apagado como reunião cancelada; se a exclusão falhar, o evento fica sem vínculo na Agenda antiga.
        generation += 1;
        await markSynced(db, a.id, { ...UNLINKED, calendar_generation: generation });
        if (eventAccount) await calendar(eventAccount).deleteEvent(a.calendarEventId!, { sendUpdates });
      }
      fields =
        patched ?? (await createEvent(calendar(target!.id), a, { invite, sendUpdates, generation, accountId: target!.id }));
    }
  } catch (e) {
    if (e instanceof CalendarDbError) throw e;
    return recordFailure(db, r, using, e);
  }

  await markSynced(db, a.id, fields);
  return "synced";
}

/**
 * Atualiza o evento ligado. Convidados e Meet ficam como estão, a não ser que a reunião passe a convidar alguém que o
 * evento ainda não convidou: aí o evento é lido, o cliente entra nos convidados que ele já tem (sem tirar ninguém),
 * o Meet é pedido se ainda não houver, e a descrição interna que o CRM pôs no evento sem convidados sai.
 */
async function updateEvent(
  cal: CalendarClient,
  a: ActivityForCalendar,
  meetUrl: string | null,
  o: { invite: boolean; sendUpdates: "all" | "none"; selfEmail: string },
): Promise<CalendarFields> {
  const email = a.personEmail?.trim() ?? "";
  if (o.invite && a.source !== FROM_CALENDAR && email && !sameEmail(email, a.invitedEmail)) {
    const current = await cal.getEvent(a.calendarEventId!);
    const changes = activityToEvent(a, { invite: false, guests: true });
    const attendees = current.attendees ?? [];
    if (!attendees.some((g) => sameEmail(g.email, email))) changes.attendees = [...attendees, { email }];
    if (eventGuests(current, o.selfEmail).length === 0) changes.description = "";
    const link = meetingLink(current);
    const patched = await cal.patchEvent(a.calendarEventId!, changes, { sendUpdates: "all", withMeet: !meetUrl && !link });
    const fields: CalendarFields = { ...IN_SYNC, calendar_etag: patched.etag ?? null, calendar_invited_email: email };
    const newLink = patched.hangoutLink ?? (meetUrl ? null : link);
    if (newLink) fields.meet_url = newLink;
    return fields;
  }
  // Sem `attendees` e sem `conferenceData`, o `patch` mantém os do evento. Os convidados que já existem são avisados.
  const patched = await cal.patchEvent(a.calendarEventId!, activityToEvent(a, { invite: false }), {
    sendUpdates: o.sendUpdates,
  });
  const fields: CalendarFields = { ...IN_SYNC, calendar_etag: patched.etag ?? null };
  // Sem link no retorno, o que já estava gravado continua.
  if (patched.hangoutLink) fields.meet_url = patched.hangoutLink;
  return fields;
}

/**
 * Cria o evento com o id da atividade e da geração. 409 (o id já existe: envio anterior cuja volta se perdeu, ou dois
 * envios ao mesmo tempo) lê o evento e o trata como criado; se ele foi apagado, cria com a geração seguinte.
 */
async function createEvent(
  cal: CalendarClient,
  a: ActivityForCalendar,
  o: { invite: boolean; sendUpdates: "all" | "none"; generation: number; accountId: string },
): Promise<CalendarFields> {
  let generation = o.generation;
  const insert = () =>
    cal.insertEvent(
      { ...activityToEvent(a, { invite: o.invite }), id: calendarEventId(a.id, generation) },
      { sendUpdates: o.sendUpdates, withMeet: o.invite },
    );
  let created: CalendarEvent;
  let invited = o.invite ? a.personEmail!.trim() : null;
  try {
    created = await insert();
  } catch (e) {
    if (!isConflict(e)) throw e;
    created = await cal.getEvent(calendarEventId(a.id, generation));
    if (created.status === "cancelled") {
      generation += 1;
      created = await insert();
    } else {
      // Criado antes por outro envio: convidado é só quem o evento já tem.
      invited = (created.attendees ?? []).find((g) => sameEmail(g.email, a.personEmail))?.email.trim() ?? null;
    }
  }
  return {
    ...IN_SYNC,
    calendar_account_id: o.accountId,
    calendar_event_id: created.id,
    calendar_etag: created.etag ?? null,
    meet_url: created.hangoutLink ?? null,
    calendar_invited_email: invited,
    calendar_generation: generation,
  };
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
