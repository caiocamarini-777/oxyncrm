/**
 * Conversões puras entre a atividade do CRM e o evento da Agenda do Google (sem I/O). A sincronização
 * (`sync.ts`) usa estas funções para decidir o que enviar, o que importar e o que ignorar.
 */
import type { CalendarEvent } from "./google";

/** Duração de um evento sem duração (atividade de 0 minutos, ou evento sem fim). */
export const DEFAULT_MINUTES = 15;
/** Ocorrências de eventos recorrentes só entram quando faltam até este número de dias. */
export const RECURRING_WINDOW_DAYS = 7;
/** Assunto dos eventos marcados como particulares na Agenda. */
export const BUSY_SUBJECT = "Ocupado";
/** Assunto de evento sem título. */
const UNTITLED_SUBJECT = "(sem título)";
/** Fuso dos horários enviados ao Google (o CRM guarda instantes; o evento mostra o horário de Brasília). */
export const CALENDAR_TIME_ZONE = "America/Sao_Paulo";
/** Tipos de evento que não viram atividade (ausência, foco, local de trabalho e aniversário). */
export const SKIPPED_EVENT_TYPES: readonly string[] = ["outOfOffice", "focusTime", "workingLocation", "birthday"];

/** Limites das colunas de `activities`. */
const MAX_SUBJECT = 200;
const MAX_DESCRIPTION = 5000;
const MAX_DURATION = 1440;
const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

export type ActivityForCalendar = {
  id: string;
  companyId: string;
  ownerId: string;
  subject: string;
  description: string | null;
  dueAt: string;
  durationMinutes: number;
  done: boolean;
  meetingOutcome: string | null;
  deletedAt: string | null;
  isMeeting: boolean;
  personEmail: string | null;
  recordUrl: string | null;
  calendarEventId: string | null;
  calendarAccountId: string | null;
  updatedAt: string;
  /** Origem: `google_calendar` é o evento que nasceu na Agenda (o CRM não apaga nem cria evento para ele). */
  source: string;
  /** O vendedor organiza o evento que veio da Agenda: só assim o CRM muda o horário e o título dele. */
  isOrganizer: boolean;
  /** Convidado que o evento já tem: evento com convidado não leva a descrição interna nem o link do CRM. */
  invitedEmail: string | null;
};

/** Atividade criada a partir de um evento que nasceu na Agenda do Google. */
export const FROM_CALENDAR = "google_calendar";

/** Corta em `max` caracteres (pontos de código, para não partir um par substituto ao meio). */
function truncate(text: string, max: number): string {
  return text.length <= max ? text : Array.from(text).slice(0, max).join("");
}

/** E-mail da pessoa: o marcado como principal, senão o primeiro da lista (`[{ value, label?, primary? }]`). */
export function primaryEmail(emails: unknown): string | null {
  if (!Array.isArray(emails)) return null;
  const items = emails as { value?: unknown; primary?: unknown }[];
  const item = items.find((e) => e?.primary === true) ?? items[0];
  return typeof item?.value === "string" && item.value.trim() ? item.value.trim() : null;
}

const hasEmail = (a: ActivityForCalendar): boolean => !!a.personEmail?.trim();

/** Reunião aberta (não concluída, fora da lixeira) com pessoa que tem e-mail: o cliente é convidado. */
export function wantsInvite(a: ActivityForCalendar): boolean {
  return a.isMeeting && hasEmail(a) && !a.done && !a.deletedAt;
}

/**
 * Evento da atividade, no formato para criar ou atualizar (`insert`/`patch`). `invite` decide se o cliente entra como
 * convidado: sem ele, o campo `attendees` nem é enviado (o `patch` não mexe nos convidados que o evento já tem).
 *
 * O convite é visto pelo cliente: evento com convidado (o convite de agora, `guests`, ou um convidado que o evento já
 * tem, `invitedEmail`) leva só o título, sem a descrição interna nem o link do CRM. O evento que nasceu na Agenda
 * nunca tem a descrição trocada, e o título "Ocupado" (evento particular) não volta para ele.
 */
export function activityToEvent(
  a: ActivityForCalendar,
  opts: { invite: boolean; guests?: boolean },
): Partial<CalendarEvent> {
  const startMs = Date.parse(a.dueAt);
  const minutes = a.durationMinutes > 0 ? a.durationMinutes : DEFAULT_MINUTES;
  const invite = opts.invite && hasEmail(a);
  const fromCalendar = a.source === FROM_CALENDAR;
  const ev: Partial<CalendarEvent> = {};
  if (!(fromCalendar && a.subject === BUSY_SUBJECT)) ev.summary = a.subject;
  if (!fromCalendar && !invite && !opts.guests && !a.invitedEmail) {
    // Sempre enviada: no `patch`, omitir a descrição manteria a antiga depois de apagada no CRM.
    ev.description = [a.description?.trim() ? a.description : null, a.recordUrl ? `No CRM: ${a.recordUrl}` : null]
      .filter((part) => part !== null)
      .join("\n\n");
  }
  ev.start = { dateTime: a.dueAt, timeZone: CALENDAR_TIME_ZONE };
  ev.end = { dateTime: new Date(startMs + minutes * MINUTE_MS).toISOString(), timeZone: CALENDAR_TIME_ZONE };
  ev.extendedProperties = { private: { oxynActivityId: a.id } };
  if (invite) ev.attendees = [{ email: a.personEmail!.trim() }];
  return ev;
}

/**
 * Id do evento que o CRM cria para a atividade: o uuid sem hífens (hexadecimal, que o Google aceita) mais `g` e a
 * geração. Repetir a criação (resposta perdida, dois envios ao mesmo tempo) devolve 409 em vez de um segundo evento.
 */
export function calendarEventId(activityId: string, generation: number): string {
  return `${activityId.replace(/-/g, "").toLowerCase()}g${generation}`;
}

export type Outbound =
  | { op: "create" }
  | { op: "update" }
  | { op: "delete"; notify: boolean }
  | { op: "unlink" }
  | { op: "none" };

/**
 * O que fazer na Agenda com a atividade:
 * - na lixeira, ou reunião concluída como cancelada: apaga o evento, se existir (avisando o cliente quando ele foi convidado);
 * - reunião concluída como remarcada antes de o evento terminar: apaga também, como a cancelada (a nova reunião,
 *   criada pela conclusão, gera o evento novo com o convite). Depois do horário, o evento fica como histórico;
 * - concluída com outro resultado: o evento fica como histórico;
 * - aberta: cria o evento, ou atualiza o que já existe.
 *
 * Evento que nasceu na Agenda (`google_calendar`) é do vendedor: o CRM nunca o apaga (lixeira e conclusão só desfazem
 * o vínculo), nunca cria outro para a atividade e só o atualiza quando o vendedor é o organizador.
 */
export function outboundOp(a: ActivityForCalendar, now: Date): Outbound {
  const minutes = a.durationMinutes > 0 ? a.durationMinutes : DEFAULT_MINUTES;
  const ended = Date.parse(a.dueAt) + minutes * MINUTE_MS <= now.getTime();
  const gone =
    !!a.deletedAt || (a.done && (a.meetingOutcome === "canceled" || (a.meetingOutcome === "rescheduled" && !ended)));
  if (a.source === FROM_CALENDAR) {
    if (!a.calendarEventId) return { op: "none" };
    if (a.deletedAt || a.done) return { op: "unlink" };
    return a.isOrganizer ? { op: "update" } : { op: "none" };
  }
  if (gone) return a.calendarEventId ? { op: "delete", notify: a.isMeeting && hasEmail(a) } : { op: "none" };
  if (a.done) return { op: "none" };
  return a.calendarEventId ? { op: "update" } : { op: "create" };
}

export type Inbound =
  | { kind: "skip"; reason: "declined" | "all_day" | "event_type" | "before_since" | "recurring_far" | "cancelled_unknown" }
  | { kind: "linked"; activityId: string }
  | { kind: "cancelled"; activityId: string }
  | { kind: "new" };

/**
 * Início e duração do evento (duração limitada ao que a coluna aceita; sem fim, 15 min). `null` para evento de dia
 * inteiro (só tem `start.date`) ou com horário ilegível: o CRM não tem atividade sem horário.
 */
export function eventTimes(ev: CalendarEvent): { dueAt: string; durationMinutes: number } | null {
  const startMs = ev.start?.dateTime ? Date.parse(ev.start.dateTime) : NaN;
  if (Number.isNaN(startMs)) return null;
  const endMs = ev.end?.dateTime ? Date.parse(ev.end.dateTime) : NaN;
  const minutes = Number.isNaN(endMs) ? DEFAULT_MINUTES : Math.round((endMs - startMs) / MINUTE_MS);
  return { dueAt: new Date(startMs).toISOString(), durationMinutes: Math.min(MAX_DURATION, Math.max(0, minutes)) };
}

/**
 * Classifica o evento que veio da Agenda. Evento já ligado a uma atividade nunca é pulado: ou foi cancelado
 * (`cancelled`), ou vira `linked`, mesmo recusado, antes de `since` ou de dia inteiro (quem aplica o `linked` vê que
 * `eventTimes` é `null` e deixa o horário como está). As regras de pular valem só para evento desconhecido, nesta
 * ordem: cancelado (um evento apagado nem traz horário), dia inteiro, tipo, recusado, antes de `since`, recorrente longe.
 */
export function classifyInbound(
  ev: CalendarEvent,
  ctx: { knownActivityId: string | null; since: Date; now: Date },
): Inbound {
  if (ctx.knownActivityId) {
    return ev.status === "cancelled"
      ? { kind: "cancelled", activityId: ctx.knownActivityId }
      : { kind: "linked", activityId: ctx.knownActivityId };
  }
  if (ev.status === "cancelled") return { kind: "skip", reason: "cancelled_unknown" };
  const times = eventTimes(ev);
  if (!times) return { kind: "skip", reason: "all_day" };
  if (ev.eventType && SKIPPED_EVENT_TYPES.includes(ev.eventType)) return { kind: "skip", reason: "event_type" };
  if (ev.attendees?.some((p) => p.self && p.responseStatus === "declined")) return { kind: "skip", reason: "declined" };
  const startMs = Date.parse(times.dueAt);
  if (startMs < ctx.since.getTime()) return { kind: "skip", reason: "before_since" };
  if (ev.recurringEventId && startMs > ctx.now.getTime() + RECURRING_WINDOW_DAYS * DAY_MS) {
    return { kind: "skip", reason: "recurring_far" };
  }
  return { kind: "new" };
}

/** Link da videochamada do evento (Meet ou outro), se houver. */
export function meetingLink(ev: CalendarEvent): string | null {
  if (ev.hangoutLink) return ev.hangoutLink;
  const points = ev.conferenceData?.entryPoints ?? [];
  return (points.find((p) => p.entryPointType === "video" && p.uri) ?? points.find((p) => p.uri))?.uri ?? null;
}

/** Convidados do evento além do próprio vendedor e das salas, em minúsculas e sem repetir. */
export function eventGuests(ev: CalendarEvent, selfEmail: string): string[] {
  const self = selfEmail.trim().toLowerCase();
  return [
    ...new Set(
      (ev.attendees ?? [])
        .filter((p) => !p.self && !p.resource && p.email.trim().toLowerCase() !== self)
        .map((p) => p.email.trim().toLowerCase()),
    ),
  ];
}

/**
 * Evento criado pela sincronização do Pipedrive com a Agenda: a descrição, a origem (`source`) ou as propriedades
 * citam o Pipedrive. Na primeira rodada, o que não foi adotado não vira atividade (seria a mesma reunião duas vezes).
 */
export function isPipedriveEvent(ev: CalendarEvent): boolean {
  const text = [ev.description, ev.source?.title, ev.source?.url, JSON.stringify(ev.extendedProperties ?? {})];
  return text.some((t) => !!t && /pipedrive/i.test(t));
}

/**
 * Campos da atividade criada a partir de um evento novo da Agenda. Precisa de um evento que passou por
 * `classifyInbound` (com horário). Evento particular entra como "Ocupado", sem descrição, convidados nem link.
 */
export function newActivityFields(
  ev: CalendarEvent,
  ctx: { selfEmail: string },
): {
  subject: string;
  description: string | null;
  dueAt: string;
  durationMinutes: number;
  kind: "meeting" | "task";
  channel: "video" | "in_person" | "unknown";
  attendeeEmails: string[];
  meetUrl: string | null;
} {
  const times = eventTimes(ev);
  if (!times) throw new Error("Evento sem horário não vira atividade");

  const guests = eventGuests(ev, ctx.selfEmail);
  const hasConference = !!ev.hangoutLink || !!ev.conferenceData;
  const isPrivate = ev.visibility === "private" || ev.visibility === "confidential";

  const title = ev.summary?.trim();
  const description = ev.description?.trim() ? truncate(ev.description, MAX_DESCRIPTION) : null;
  return {
    subject: isPrivate ? BUSY_SUBJECT : truncate(title || UNTITLED_SUBJECT, MAX_SUBJECT),
    description: isPrivate ? null : description,
    ...times,
    kind: guests.length > 0 || hasConference ? "meeting" : "task",
    channel: hasConference ? "video" : ev.location?.trim() ? "in_person" : "unknown",
    attendeeEmails: isPrivate ? [] : guests,
    meetUrl: isPrivate ? null : meetingLink(ev),
  };
}

/**
 * Qual lado mudou por último (para o conflito: valem os dados do mais recente). O lado do CRM é a hora da última
 * mudança que aparece no evento (`calendar_local_changed_at`), nunca o `updated_at`, que muda por qualquer gravação
 * (lembrete enviado, volta do envio). Empate, ou evento sem `updated`, fica com o CRM; sem a hora do CRM, com a Agenda.
 */
export function newerSide(localChangedAt: string | null, eventUpdated: string | undefined): "crm" | "google" {
  if (!eventUpdated) return "crm";
  if (!localChangedAt) return "google";
  return Date.parse(eventUpdated) > Date.parse(localChangedAt) ? "google" : "crm";
}
