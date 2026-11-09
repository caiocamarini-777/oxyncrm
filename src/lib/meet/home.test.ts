import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { ActivityRow } from "@/lib/activities/rows";
import { scheduledSituation, successRate, summaryExcerpt, todayRange, toHeldToday, toScheduledMeeting } from "./home";
import type { EndedMeeting } from "./queries";
import { meetingAnchor } from "./view";

describe("todayRange", () => {
  it("às 02h UTC ainda é o dia 4 em São Paulo: o dia começa em 04/11 às 03h UTC", () => {
    expect(todayRange(new Date("2026-11-05T02:00:00Z"))).toEqual({
      start: "2026-11-04T03:00:00.000Z",
      end: "2026-11-05T03:00:00.000Z",
    });
  });

  it("à tarde, o dia é o mesmo da data UTC", () => {
    expect(todayRange(new Date("2026-11-05T15:00:00Z"))).toEqual({
      start: "2026-11-05T03:00:00.000Z",
      end: "2026-11-06T03:00:00.000Z",
    });
  });

  it("meia-noite de São Paulo (03h UTC) já é o dia novo", () => {
    expect(todayRange(new Date("2026-11-05T03:00:00Z")).start).toBe("2026-11-05T03:00:00.000Z");
    expect(todayRange(new Date("2026-11-05T02:59:59Z")).start).toBe("2026-11-04T03:00:00.000Z");
  });
});

describe("scheduledSituation", () => {
  const now = new Date("2026-11-05T15:00:00Z");
  const open = { done: false, meetingOutcome: null, hasMeet: false };

  it("realizada: tem reunião do Meet ligada, mesmo sem concluir e com o horário bem passado", () => {
    expect(scheduledSituation({ ...open, dueAt: "2026-11-05T11:00:00Z", hasMeet: true }, now)).toBe("realizada");
  });

  it("realizada: concluída com o resultado 'held'", () => {
    expect(scheduledSituation({ ...open, dueAt: "2026-11-05T11:00:00Z", done: true, meetingOutcome: "held" }, now)).toBe("realizada");
  });

  it("a fazer: o horário é daqui a pouco ou já começou há menos de 1 h", () => {
    expect(scheduledSituation({ ...open, dueAt: "2026-11-05T18:00:00Z" }, now)).toBe("a_fazer");
    expect(scheduledSituation({ ...open, dueAt: "2026-11-05T14:30:00Z" }, now)).toBe("a_fazer");
  });

  it("fronteira: exatamente 1 h depois do horário ainda é a fazer; 1 s a mais já é não realizada", () => {
    expect(scheduledSituation({ ...open, dueAt: "2026-11-05T14:00:00Z" }, now)).toBe("a_fazer");
    expect(scheduledSituation({ ...open, dueAt: "2026-11-05T13:59:59Z" }, now)).toBe("nao_realizada");
  });

  it("não realizada: passou mais de 1 h, sem Meet e sem conclusão", () => {
    expect(scheduledSituation({ ...open, dueAt: "2026-11-05T12:00:00Z" }, now)).toBe("nao_realizada");
  });

  it("não realizada: concluída com outro resultado (não compareceu, cancelada, remarcada) ou sem resultado", () => {
    for (const meetingOutcome of ["no_show", "canceled", "rescheduled", null]) {
      expect(scheduledSituation({ ...open, dueAt: "2026-11-05T12:00:00Z", done: true, meetingOutcome }, now)).toBe("nao_realizada");
    }
  });

  it("concluída sem 'held' nunca é a fazer, nem dentro da hora de tolerância", () => {
    expect(scheduledSituation({ ...open, dueAt: "2026-11-05T14:30:00Z", done: true, meetingOutcome: "canceled" }, now)).toBe("nao_realizada");
    expect(scheduledSituation({ ...open, dueAt: "2026-11-05T18:00:00Z", done: true, meetingOutcome: "no_show" }, now)).toBe("nao_realizada");
  });
});

describe("successRate", () => {
  const items = (...s: ("realizada" | "a_fazer" | "nao_realizada")[]) => s.map((situation) => ({ situation }));

  it("3 de 5 dá 60%", () => {
    expect(successRate(items("realizada", "realizada", "realizada", "a_fazer", "nao_realizada"))).toEqual({ done: 3, total: 5, pct: 60 });
  });

  it("lista vazia dá pct nulo, para a tela mostrar 'nenhuma reunião marcada'", () => {
    expect(successRate([])).toEqual({ done: 0, total: 0, pct: null });
  });

  it("arredonda para o inteiro mais próximo", () => {
    expect(successRate(items("realizada", "a_fazer", "a_fazer"))).toMatchObject({ pct: 33 });
    expect(successRate(items("realizada", "realizada", "a_fazer"))).toMatchObject({ pct: 67 });
  });

  it("nenhuma realizada dá 0%, e todas dão 100%", () => {
    expect(successRate(items("a_fazer", "nao_realizada"))).toEqual({ done: 0, total: 2, pct: 0 });
    expect(successRate(items("realizada"))).toEqual({ done: 1, total: 1, pct: 100 });
  });
});

describe("summaryExcerpt", () => {
  it("devolve as duas primeiras linhas com texto, sem as vazias", () => {
    expect(summaryExcerpt("Primeira linha\n\n  Segunda linha  \nTerceira")).toBe("Primeira linha\nSegunda linha");
  });

  it("aceita quebra de linha do Windows e resumo de uma linha só", () => {
    expect(summaryExcerpt("A\r\nB\r\nC")).toBe("A\nB");
    expect(summaryExcerpt("Só uma")).toBe("Só uma");
  });

  it("resumo vazio ou só com espaços dá texto vazio", () => {
    expect(summaryExcerpt("")).toBe("");
    expect(summaryExcerpt(" \n  \n")).toBe("");
  });

  it("corta linha muito longa com reticências", () => {
    const out = summaryExcerpt("x".repeat(500));
    expect(out).toHaveLength(241);
    expect(out.endsWith("…")).toBe(true);
  });
});

describe("toScheduledMeeting", () => {
  const now = new Date("2026-11-05T15:00:00Z");
  const base: ActivityRow = {
    id: "a1",
    companyId: "c1",
    companySlug: "volt",
    companyName: "Volt",
    type: { id: "t1", name: "Reunião", isMeeting: true },
    channel: { id: "ch1", name: "Meet" },
    subject: "Demo com a Ana",
    description: null,
    dueAt: "2026-11-05T17:00:00Z",
    durationMinutes: 30,
    reminderMinutes: null,
    done: false,
    completedAt: null,
    outcome: null,
    meetingOutcome: null,
    completionNote: null,
    ownerId: "u1",
    ownerName: "Caio",
    leadId: null,
    dealId: null,
    personId: null,
    organizationId: null,
    lead: null,
    deal: null,
    person: null,
    organization: null,
    personHasEmail: false,
    bookedByActivityId: null,
    legacy: false,
    status: "today",
    meetUrl: null,
    calendarState: "none",
    calendarError: null,
  };

  it("monta assunto, horário, situação e o card com link da empresa do próprio registro", () => {
    const row = { ...base, dealId: "d1", deal: { id: "d1", name: "Negócio Ana" } };
    expect(toScheduledMeeting(row, false, now)).toEqual({
      id: "a1",
      subject: "Demo com a Ana",
      dueAt: "2026-11-05T17:00:00Z",
      situation: "a_fazer",
      companyName: "Volt",
      record: { entity: "deals", id: "d1", title: "Negócio Ana", href: "/volt/negocios/d1" },
    });
  });

  it("o card escolhido segue a ordem negócio, lead, pessoa, organização", () => {
    const all = {
      ...base,
      lead: { id: "l1", name: "Lead" },
      person: { id: "p1", name: "Pessoa" },
      organization: { id: "o1", name: "Org" },
    };
    expect(toScheduledMeeting(all, false, now).record).toMatchObject({ entity: "leads", id: "l1", href: "/volt/leads/l1" });
    expect(toScheduledMeeting({ ...all, lead: null }, false, now).record).toMatchObject({
      entity: "persons",
      href: "/volt/contatos/pessoas/p1",
    });
    expect(toScheduledMeeting({ ...all, lead: null, person: null }, false, now).record).toMatchObject({
      entity: "organizations",
      href: "/volt/contatos/organizacoes/o1",
    });
  });

  it("vínculo na lixeira ou ilegível (nulo na linha) não vira link: sem card", () => {
    expect(toScheduledMeeting({ ...base, dealId: "d-lixeira" }, false, now).record).toBeNull();
  });

  it("a reunião do Meet ligada vira realizada", () => {
    expect(toScheduledMeeting(base, true, now).situation).toBe("realizada");
  });
});

describe("toHeldToday", () => {
  const ended = (over: Partial<EndedMeeting>): EndedMeeting => ({
    id: "m1",
    title: "Reunião com a Ana",
    endedAt: "2026-11-05T17:45:00Z",
    status: "done",
    summary: "Linha 1\nLinha 2\nLinha 3",
    companyName: "Volt",
    record: { entity: "deals", id: "d1", title: "Negócio Ana", href: "/volt/negocios/d1" },
    ...over,
  });

  it("leva ao bloco da reunião no card e traz só as duas primeiras linhas do resumo", () => {
    expect(toHeldToday([ended({})])).toEqual([
      {
        id: "m1",
        title: "Reunião com a Ana",
        endedAt: "2026-11-05T17:45:00Z",
        processing: false,
        excerpt: "Linha 1\nLinha 2",
        companyName: "Volt",
        record: { entity: "deals", id: "d1", title: "Negócio Ana", href: "/volt/negocios/d1" },
        href: `/volt/negocios/d1#${meetingAnchor("m1")}`,
      },
    ]);
  });

  it("em processamento ainda não tem resumo", () => {
    const [m] = toHeldToday([ended({ status: "processing", summary: "" })]);
    expect(m).toMatchObject({ processing: true, excerpt: "" });
  });
});

describe("meetingAnchor", () => {
  it("é o id do bloco da reunião no histórico do card", () => {
    expect(meetingAnchor("abc")).toBe("reuniao-abc");
  });
});
