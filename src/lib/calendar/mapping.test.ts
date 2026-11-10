import { describe, expect, it } from "vitest";
import type { CalendarEvent } from "./google";
import {
  BUSY_SUBJECT,
  DEFAULT_MINUTES,
  RECURRING_WINDOW_DAYS,
  SKIPPED_EVENT_TYPES,
  activityToEvent,
  calendarEventId,
  classifyInbound,
  eventGuests,
  eventTimes,
  isPipedriveEvent,
  newActivityFields,
  newerSide,
  outboundOp,
  primaryEmail,
  wantsInvite,
  type ActivityForCalendar,
} from "./mapping";

const activity = (over: Partial<ActivityForCalendar> = {}): ActivityForCalendar => ({
  id: "act-1",
  companyId: "co-1",
  ownerId: "user-1",
  subject: "Demo com a Acme",
  description: "Levar a proposta",
  dueAt: "2026-11-10T17:00:00+00:00",
  durationMinutes: 45,
  done: false,
  meetingOutcome: null,
  deletedAt: null,
  isMeeting: true,
  personEmail: "cliente@acme.com",
  recordUrl: "https://oxyn.app/acme/negocios/d1",
  calendarEventId: null,
  calendarAccountId: null,
  updatedAt: "2026-11-09T12:00:00Z",
  source: "crm",
  isOrganizer: true,
  invitedEmail: null,
  ...over,
});

const event = (over: Partial<CalendarEvent> = {}): CalendarEvent => ({
  id: "ev-1",
  status: "confirmed",
  summary: "Reunião de alinhamento",
  start: { dateTime: "2026-11-10T14:00:00-03:00" },
  end: { dateTime: "2026-11-10T15:00:00-03:00" },
  ...over,
});

const NOW = new Date("2026-11-09T15:00:00Z");
const SINCE = new Date("2026-11-01T00:00:00Z");
const ctx = (knownActivityId: string | null = null) => ({ knownActivityId, since: SINCE, now: NOW });

describe("constantes", () => {
  it("têm os valores da spec", () => {
    expect(DEFAULT_MINUTES).toBe(15);
    expect(RECURRING_WINDOW_DAYS).toBe(7);
    expect(BUSY_SUBJECT).toBe("Ocupado");
    expect(SKIPPED_EVENT_TYPES).toEqual(["outOfOffice", "focusTime", "workingLocation", "birthday"]);
  });
});

describe("activityToEvent", () => {
  it("usa o assunto como título", () => {
    expect(activityToEvent(activity(), { invite: false }).summary).toBe("Demo com a Acme");
  });

  it("descrição é a da atividade mais o link do registro no CRM", () => {
    expect(activityToEvent(activity(), { invite: false }).description).toBe(
      "Levar a proposta\n\nNo CRM: https://oxyn.app/acme/negocios/d1",
    );
  });

  it("sem link do registro, a descrição não leva o trecho do CRM", () => {
    expect(activityToEvent(activity({ recordUrl: null }), { invite: false }).description).toBe("Levar a proposta");
  });

  it("sem descrição, só o link; sem nada, descrição vazia (para o patch limpar a antiga)", () => {
    expect(activityToEvent(activity({ description: null }), { invite: false }).description).toBe(
      "No CRM: https://oxyn.app/acme/negocios/d1",
    );
    expect(activityToEvent(activity({ description: null, recordUrl: null }), { invite: false }).description).toBe("");
  });

  it("início é o dueAt com o fuso de São Paulo, e o fim é o início mais a duração", () => {
    const ev = activityToEvent(activity(), { invite: false });
    expect(ev.start).toEqual({ dateTime: "2026-11-10T17:00:00+00:00", timeZone: "America/Sao_Paulo" });
    expect(ev.end).toEqual({ dateTime: "2026-11-10T17:45:00.000Z", timeZone: "America/Sao_Paulo" });
  });

  it("duração 0 vira 15 minutos", () => {
    const ev = activityToEvent(activity({ durationMinutes: 0 }), { invite: false });
    expect(ev.end?.dateTime).toBe("2026-11-10T17:15:00.000Z");
  });

  it("grava o id da atividade nas propriedades privadas", () => {
    expect(activityToEvent(activity(), { invite: false }).extendedProperties).toEqual({
      private: { oxynActivityId: "act-1" },
    });
  });

  it("com invite leva o e-mail da pessoa como convidado", () => {
    expect(activityToEvent(activity(), { invite: true }).attendees).toEqual([{ email: "cliente@acme.com" }]);
  });

  it("sem invite não leva o campo attendees", () => {
    expect(activityToEvent(activity(), { invite: false })).not.toHaveProperty("attendees");
  });

  it("com invite mas sem e-mail, não leva convidados", () => {
    expect(activityToEvent(activity({ personEmail: null }), { invite: true })).not.toHaveProperty("attendees");
  });

  describe("conteúdo que o cliente vê", () => {
    it("evento com convite: só o título, sem a descrição interna nem o link do CRM", () => {
      const ev = activityToEvent(activity(), { invite: true });
      expect(ev.summary).toBe("Demo com a Acme");
      expect(ev).not.toHaveProperty("description");
      expect(JSON.stringify(ev)).not.toContain("oxyn.app/acme");
    });

    it("evento que já tem convidado (ou que vai ter): a atualização também não leva a descrição", () => {
      expect(activityToEvent(activity({ invitedEmail: "cliente@acme.com" }), { invite: false })).not.toHaveProperty("description");
      expect(activityToEvent(activity(), { invite: false, guests: true })).not.toHaveProperty("description");
    });

    it("evento sem convidados: descrição e link do CRM", () => {
      expect(activityToEvent(activity({ isMeeting: false }), { invite: false }).description).toBe(
        "Levar a proposta\n\nNo CRM: https://oxyn.app/acme/negocios/d1",
      );
    });

    it("evento que nasceu na Agenda: nunca leva descrição; o título Ocupado não volta para ele", () => {
      const fromCalendar = activity({ source: "google_calendar", invitedEmail: null });
      expect(activityToEvent(fromCalendar, { invite: false })).not.toHaveProperty("description");
      expect(activityToEvent(fromCalendar, { invite: false }).summary).toBe("Demo com a Acme");
      const busy = activityToEvent(activity({ source: "google_calendar", subject: "Ocupado" }), { invite: false });
      expect(busy).not.toHaveProperty("summary");
      expect(busy.start?.dateTime).toBe("2026-11-10T17:00:00+00:00");
    });
  });
});

describe("calendarEventId", () => {
  it("é o uuid sem hífens mais a geração (só letras e números que o Google aceita)", () => {
    const id = calendarEventId("AAAAAAAA-0000-4000-8000-00000000000F", 0);
    expect(id).toBe("aaaaaaaa00004000800000000000000fg0");
    expect(id).toMatch(/^[0-9a-v]{5,1024}$/);
    expect(calendarEventId("aaaaaaaa-0000-4000-8000-00000000000f", 2)).toBe("aaaaaaaa00004000800000000000000fg2");
  });
});

describe("wantsInvite", () => {
  it("é verdadeiro para reunião aberta com e-mail da pessoa", () => {
    expect(wantsInvite(activity())).toBe(true);
  });

  it.each([
    ["não é reunião", { isMeeting: false }],
    ["sem e-mail", { personEmail: null }],
    ["e-mail vazio", { personEmail: "  " }],
    ["concluída", { done: true }],
    ["na lixeira", { deletedAt: "2026-11-09T10:00:00Z" }],
  ] as const)("é falso quando %s", (_nome, over) => {
    expect(wantsInvite(activity(over))).toBe(false);
  });
});

describe("outboundOp", () => {
  it("na lixeira e com evento: apaga, avisando se é reunião com e-mail", () => {
    const deletedAt = "2026-11-09T10:00:00Z";
    expect(outboundOp(activity({ deletedAt, calendarEventId: "ev-1" }), NOW)).toEqual({ op: "delete", notify: true });
    expect(outboundOp(activity({ deletedAt, calendarEventId: "ev-1", isMeeting: false }), NOW)).toEqual({
      op: "delete",
      notify: false,
    });
    expect(outboundOp(activity({ deletedAt, calendarEventId: "ev-1", personEmail: null }), NOW)).toEqual({
      op: "delete",
      notify: false,
    });
  });

  it("concluída como cancelada e com evento: apaga, com o mesmo critério de aviso", () => {
    const base = { done: true, meetingOutcome: "canceled", calendarEventId: "ev-1" };
    expect(outboundOp(activity(base), NOW)).toEqual({ op: "delete", notify: true });
    expect(outboundOp(activity({ ...base, personEmail: null }), NOW)).toEqual({ op: "delete", notify: false });
  });

  it("na lixeira e sem evento: nada", () => {
    expect(outboundOp(activity({ deletedAt: "2026-11-09T10:00:00Z" }), NOW)).toEqual({ op: "none" });
  });

  it("cancelada e sem evento: nada", () => {
    expect(outboundOp(activity({ done: true, meetingOutcome: "canceled" }), NOW)).toEqual({ op: "none" });
  });

  it("concluída com outro resultado: nada (o evento fica como histórico)", () => {
    for (const meetingOutcome of ["held", "no_show", null]) {
      expect(outboundOp(activity({ done: true, meetingOutcome, calendarEventId: "ev-1" }), NOW)).toEqual({ op: "none" });
    }
  });

  it("remarcada antes de o evento terminar: apaga avisando, como a cancelada", () => {
    const base = { done: true, meetingOutcome: "rescheduled", calendarEventId: "ev-1" };
    expect(outboundOp(activity(base), NOW)).toEqual({ op: "delete", notify: true });
    // Em andamento (começou às 14:30, 45 min): ainda não terminou.
    expect(outboundOp(activity({ ...base, dueAt: "2026-11-09T14:30:00Z" }), NOW)).toEqual({ op: "delete", notify: true });
    expect(outboundOp(activity({ ...base, calendarEventId: null }), NOW)).toEqual({ op: "none" });
  });

  it("remarcada depois do horário: o evento fica como histórico", () => {
    const past = { done: true, meetingOutcome: "rescheduled", calendarEventId: "ev-1", dueAt: "2026-11-09T14:00:00Z" };
    expect(outboundOp(activity(past), NOW)).toEqual({ op: "none" });
  });

  describe("evento que nasceu na Agenda (google_calendar)", () => {
    const fromCalendar = (over: Partial<ActivityForCalendar> = {}) =>
      activity({ source: "google_calendar", calendarEventId: "ev-g", ...over });

    it("lixeira, cancelada ou concluída: só desfaz o vínculo, nunca apaga o evento", () => {
      expect(outboundOp(fromCalendar({ deletedAt: "2026-11-09T10:00:00Z" }), NOW)).toEqual({ op: "unlink" });
      expect(outboundOp(fromCalendar({ done: true, meetingOutcome: "canceled" }), NOW)).toEqual({ op: "unlink" });
      expect(outboundOp(fromCalendar({ done: true, meetingOutcome: "rescheduled" }), NOW)).toEqual({ op: "unlink" });
      expect(outboundOp(fromCalendar({ done: true, meetingOutcome: "held" }), NOW)).toEqual({ op: "unlink" });
    });

    it("aberta: atualiza só quando o vendedor é o organizador", () => {
      expect(outboundOp(fromCalendar(), NOW)).toEqual({ op: "update" });
      expect(outboundOp(fromCalendar({ isOrganizer: false }), NOW)).toEqual({ op: "none" });
    });

    it("sem vínculo (já desfeito): nunca cria outro evento", () => {
      expect(outboundOp(fromCalendar({ calendarEventId: null }), NOW)).toEqual({ op: "none" });
      expect(outboundOp(fromCalendar({ calendarEventId: null, deletedAt: "2026-11-09T10:00:00Z" }), NOW)).toEqual({ op: "none" });
    });
  });

  it("aberta sem evento cria; aberta com evento atualiza", () => {
    expect(outboundOp(activity(), NOW)).toEqual({ op: "create" });
    expect(outboundOp(activity({ calendarEventId: "ev-1" }), NOW)).toEqual({ op: "update" });
  });
});

describe("eventTimes", () => {
  it("devolve o início em UTC e a duração em minutos", () => {
    expect(eventTimes(event())).toEqual({ dueAt: "2026-11-10T17:00:00.000Z", durationMinutes: 60 });
  });

  it("sem fim, a duração é 15 minutos", () => {
    expect(eventTimes(event({ end: undefined }))).toEqual({ dueAt: "2026-11-10T17:00:00.000Z", durationMinutes: 15 });
  });

  it("dia inteiro ou ilegível devolve null", () => {
    expect(eventTimes(event({ start: { date: "2026-11-10" }, end: { date: "2026-11-11" } }))).toBeNull();
    expect(eventTimes(event({ start: { dateTime: "ontem" } }))).toBeNull();
    expect(eventTimes(event({ start: undefined }))).toBeNull();
  });

  it("limita a duração a 0..1440 (fim antes do início vira 0)", () => {
    expect(eventTimes(event({ end: { dateTime: "2026-11-12T14:00:00-03:00" } }))?.durationMinutes).toBe(1440);
    expect(eventTimes(event({ end: { dateTime: "2026-11-10T13:00:00-03:00" } }))?.durationMinutes).toBe(0);
  });
});

describe("classifyInbound", () => {
  it("cancelado com atividade conhecida: cancelled", () => {
    expect(classifyInbound(event({ status: "cancelled" }), ctx("act-9"))).toEqual({
      kind: "cancelled",
      activityId: "act-9",
    });
  });

  it("cancelado desconhecido (sem sequer horário): ignorado", () => {
    expect(classifyInbound({ id: "ev-2", status: "cancelled" }, ctx())).toEqual({
      kind: "skip",
      reason: "cancelled_unknown",
    });
  });

  it("dia inteiro é ignorado", () => {
    const allDay = event({ start: { date: "2026-11-10" }, end: { date: "2026-11-11" } });
    expect(classifyInbound(allDay, ctx())).toEqual({ kind: "skip", reason: "all_day" });
  });

  it.each(SKIPPED_EVENT_TYPES)("tipo %s é ignorado", (eventType) => {
    expect(classifyInbound(event({ eventType }), ctx())).toEqual({ kind: "skip", reason: "event_type" });
  });

  it("tipo default não é ignorado", () => {
    expect(classifyInbound(event({ eventType: "default" }), ctx())).toEqual({ kind: "new" });
  });

  it("recusado pelo próprio vendedor é ignorado; recusado por outro convidado não", () => {
    const attendees = (self: string, other: string) => [
      { email: "eu@oxyn.com", self: true, responseStatus: self },
      { email: "cliente@acme.com", responseStatus: other },
    ];
    expect(classifyInbound(event({ attendees: attendees("declined", "accepted") }), ctx())).toEqual({
      kind: "skip",
      reason: "declined",
    });
    expect(classifyInbound(event({ attendees: attendees("accepted", "declined") }), ctx())).toEqual({ kind: "new" });
  });

  it("início antes da data de partida é ignorado", () => {
    const old = event({ start: { dateTime: "2026-10-31T10:00:00-03:00" }, end: { dateTime: "2026-10-31T11:00:00-03:00" } });
    expect(classifyInbound(old, ctx())).toEqual({ kind: "skip", reason: "before_since" });
  });

  it("recorrente só entra quando falta até 7 dias", () => {
    const at = (iso: string) => event({ recurringEventId: "rec-1", start: { dateTime: iso }, end: undefined });
    // NOW + 7 dias = 2026-11-16T15:00:00Z
    expect(classifyInbound(at("2026-11-16T15:00:00Z"), ctx())).toEqual({ kind: "new" });
    expect(classifyInbound(at("2026-11-16T15:00:01Z"), ctx())).toEqual({ kind: "skip", reason: "recurring_far" });
  });

  it("evento longe no futuro, mas não recorrente, entra", () => {
    const far = event({ start: { dateTime: "2027-03-01T10:00:00-03:00" }, end: undefined });
    expect(classifyInbound(far, ctx())).toEqual({ kind: "new" });
  });

  it("atividade conhecida: linked; senão new", () => {
    expect(classifyInbound(event(), ctx("act-9"))).toEqual({ kind: "linked", activityId: "act-9" });
    expect(classifyInbound(event(), ctx())).toEqual({ kind: "new" });
  });

  describe("evento já ligado a uma atividade nunca é pulado", () => {
    const linked = { kind: "linked", activityId: "act-9" };

    it("recusado pelo vendedor: linked", () => {
      const declined = event({ attendees: [{ email: "eu@oxyn.com", self: true, responseStatus: "declined" }] });
      expect(classifyInbound(declined, ctx("act-9"))).toEqual(linked);
    });

    it("início antes da data de partida: linked", () => {
      const old = event({
        start: { dateTime: "2026-10-31T10:00:00-03:00" },
        end: { dateTime: "2026-10-31T11:00:00-03:00" },
      });
      expect(classifyInbound(old, ctx("act-9"))).toEqual(linked);
    });

    it("dia inteiro: linked (quem aplica vê eventTimes nulo e deixa o horário)", () => {
      const allDay = event({ start: { date: "2026-11-10" }, end: { date: "2026-11-11" } });
      expect(classifyInbound(allDay, ctx("act-9"))).toEqual(linked);
    });

    it("recorrente além de 7 dias e tipo especial: linked", () => {
      const far = event({ recurringEventId: "rec-1", start: { dateTime: "2027-03-01T10:00:00-03:00" } });
      expect(classifyInbound(far, ctx("act-9"))).toEqual(linked);
      expect(classifyInbound(event({ eventType: "focusTime" }), ctx("act-9"))).toEqual(linked);
    });

    it("cancelado continua sendo cancelled, mesmo sem horário", () => {
      expect(classifyInbound({ id: "ev-2", status: "cancelled" }, ctx("act-9"))).toEqual({
        kind: "cancelled",
        activityId: "act-9",
      });
    });
  });
});

describe("newActivityFields", () => {
  const self = { selfEmail: "eu@oxyn.com" };

  it("evento simples vira tarefa, sem canal, com horário e duração", () => {
    expect(newActivityFields(event({ description: "Pauta" }), self)).toEqual({
      subject: "Reunião de alinhamento",
      description: "Pauta",
      dueAt: "2026-11-10T17:00:00.000Z",
      durationMinutes: 60,
      kind: "task",
      channel: "unknown",
      attendeeEmails: [],
      meetUrl: null,
    });
  });

  it.each(["private", "confidential"] as const)("visibilidade %s entra como Ocupado, sem descrição nem convidados", (visibility) => {
    const r = newActivityFields(
      event({
        visibility,
        summary: "Consulta médica",
        description: "Detalhes",
        attendees: [{ email: "outro@x.com" }],
        hangoutLink: "https://meet.google.com/abc-defg-hij",
      }),
      self,
    );
    expect(r.subject).toBe("Ocupado");
    expect(r.description).toBeNull();
    expect(r.attendeeEmails).toEqual([]);
    expect(r.meetUrl).toBeNull();
  });

  it("vira reunião quando há convidado que não é o próprio vendedor nem sala", () => {
    const base = [{ email: "eu@oxyn.com", self: true }, { email: "sala@oxyn.com", resource: true }];
    expect(newActivityFields(event({ attendees: base }), self).kind).toBe("task");
    const withGuest = event({ attendees: [...base, { email: "Cliente@Acme.com" }] });
    const r = newActivityFields(withGuest, self);
    expect(r.kind).toBe("meeting");
    expect(r.attendeeEmails).toEqual(["cliente@acme.com"]);
  });

  it("o e-mail do vendedor não conta como convidado mesmo sem a marca self", () => {
    const r = newActivityFields(event({ attendees: [{ email: "EU@oxyn.com" }] }), self);
    expect(r.kind).toBe("task");
    expect(r.attendeeEmails).toEqual([]);
  });

  it("vira reunião com link do Meet ou dados de conferência", () => {
    expect(newActivityFields(event({ hangoutLink: "https://meet.google.com/abc" }), self).kind).toBe("meeting");
    expect(newActivityFields(event({ conferenceData: { conferenceId: "abc" } }), self).kind).toBe("meeting");
  });

  it("canal: video com link, in_person com local e sem link, senão unknown", () => {
    const video = newActivityFields(event({ hangoutLink: "https://meet.google.com/abc", location: "Sala 2" }), self);
    expect(video.channel).toBe("video");
    expect(video.meetUrl).toBe("https://meet.google.com/abc");
    const viaEntryPoint = newActivityFields(
      event({
        conferenceData: {
          entryPoints: [
            { entryPointType: "phone", uri: "tel:+551100000000" },
            { entryPointType: "video", uri: "https://zoom.us/j/1" },
          ],
        },
      }),
      self,
    );
    expect(viaEntryPoint.channel).toBe("video");
    expect(viaEntryPoint.meetUrl).toBe("https://zoom.us/j/1");
    expect(newActivityFields(event({ location: "Av. Paulista, 1000" }), self).channel).toBe("in_person");
    expect(newActivityFields(event(), self).channel).toBe("unknown");
  });

  it("assunto vazio vira (sem título); assunto longo é cortado em 200", () => {
    expect(newActivityFields(event({ summary: undefined }), self).subject).toBe("(sem título)");
    expect(newActivityFields(event({ summary: "   " }), self).subject).toBe("(sem título)");
    expect(newActivityFields(event({ summary: "a".repeat(300) }), self).subject).toHaveLength(200);
  });

  it("o corte não parte um caractere de dois códigos ao meio", () => {
    const subject = newActivityFields(event({ summary: "😀".repeat(250) }), self).subject;
    expect(Array.from(subject)).toHaveLength(200);
    expect(subject).toBe("😀".repeat(200));
  });

  it("descrição é cortada em 5000; descrição em branco vira null", () => {
    expect(newActivityFields(event({ description: "d".repeat(6000) }), self).description).toHaveLength(5000);
    expect(newActivityFields(event({ description: "  \n " }), self).description).toBeNull();
  });

  it("duração limitada a 0..1440", () => {
    const long = event({ end: { dateTime: "2026-11-12T14:00:00-03:00" } });
    expect(newActivityFields(long, self).durationMinutes).toBe(1440);
    const backwards = event({ end: { dateTime: "2026-11-10T13:00:00-03:00" } });
    expect(newActivityFields(backwards, self).durationMinutes).toBe(0);
  });

  it("evento sem horário não vira atividade", () => {
    expect(() => newActivityFields(event({ start: { date: "2026-11-10" } }), self)).toThrow();
  });
});

describe("newerSide", () => {
  it("o lado com a mudança mais recente vence", () => {
    expect(newerSide("2026-11-09T12:00:00Z", "2026-11-09T12:00:01Z")).toBe("google");
    expect(newerSide("2026-11-09T12:00:01Z", "2026-11-09T12:00:00Z")).toBe("crm");
  });

  it("sem a hora da mudança no CRM, a Agenda vence", () => {
    expect(newerSide(null, "2026-11-09T12:00:00Z")).toBe("google");
    expect(newerSide(null, undefined)).toBe("crm");
  });

  it("compara instantes, não textos (fusos diferentes)", () => {
    expect(newerSide("2026-11-09T12:00:00+00:00", "2026-11-09T10:00:00-03:00")).toBe("google");
    expect(newerSide("2026-11-09T12:00:00+00:00", "2026-11-09T08:00:00-03:00")).toBe("crm");
  });

  it("empate ou evento sem updated: CRM", () => {
    expect(newerSide("2026-11-09T12:00:00Z", "2026-11-09T12:00:00Z")).toBe("crm");
    expect(newerSide("2026-11-09T12:00:00Z", undefined)).toBe("crm");
  });
});

describe("eventGuests", () => {
  it("convidados sem o vendedor (pela marca ou pelo e-mail) e sem salas, em minúsculas e sem repetir", () => {
    const ev = event({
      attendees: [
        { email: "caio@oxyn.com.br", self: true },
        { email: " Cliente@Acme.com " },
        { email: "cliente@acme.com" },
        { email: "Caio@Oxyn.com.br" },
        { email: "sala@resource.calendar.google.com", resource: true },
      ],
    });
    expect(eventGuests(ev, "caio@oxyn.com.br")).toEqual(["cliente@acme.com"]);
    expect(eventGuests(event(), "caio@oxyn.com.br")).toEqual([]);
  });
});

describe("isPipedriveEvent", () => {
  it.each([
    ["descrição", { description: "Atividade criada no Pipedrive: https://acme.pipedrive.com/activities/1" }],
    ["origem", { source: { title: "Pipedrive", url: "https://acme.pipedrive.com" } }],
    ["propriedades privadas", { extendedProperties: { private: { pipedriveActivityId: "123" } } }],
    ["propriedades compartilhadas", { extendedProperties: { shared: { origin: "PIPEDRIVE" } } }],
  ])("reconhece pela %s, sem diferenciar maiúsculas", (_, over) => {
    expect(isPipedriveEvent(event(over as Partial<CalendarEvent>))).toBe(true);
  });

  it("evento comum não é do Pipedrive", () => {
    expect(isPipedriveEvent(event({ description: "Pauta da reunião" }))).toBe(false);
    expect(isPipedriveEvent(event())).toBe(false);
  });
});

describe("primaryEmail", () => {
  it("prefere o e-mail marcado como principal, senão o primeiro da lista", () => {
    expect(primaryEmail([{ value: "a@acme.com" }, { value: " b@acme.com ", primary: true }])).toBe("b@acme.com");
    expect(primaryEmail([{ value: " a@acme.com " }, { value: "b@acme.com" }])).toBe("a@acme.com");
  });

  it("lista vazia, valor em branco ou formato estranho não dão e-mail", () => {
    expect(primaryEmail([])).toBeNull();
    expect(primaryEmail([{ value: "  " }])).toBeNull();
    expect(primaryEmail([{ value: 3 }])).toBeNull();
    expect(primaryEmail(null)).toBeNull();
    expect(primaryEmail("a@acme.com")).toBeNull();
  });
});
