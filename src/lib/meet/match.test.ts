import { describe, expect, it } from "vitest";
import { type Candidate, normalizeEmail, pickRecord, splitAttendees } from "./match";

const MEETING_AT = new Date("2026-11-05T15:00:00Z");

function cand(partial: Partial<Candidate> & { personId?: string; orgId?: string | null } = {}): Candidate {
  return {
    person: { id: partial.personId ?? "p1", organizationId: partial.orgId === undefined ? "o1" : partial.orgId },
    deals: partial.deals ?? [],
    leads: partial.leads ?? [],
    meetingActivities: partial.meetingActivities ?? [],
  };
}

const deal = (id: string, lastActivityAt: string | null = null) => ({
  id,
  personId: "p1",
  organizationId: "o1",
  lastActivityAt,
});

const meeting = (id: string, dealId: string | null, dueAt: string, extra: { leadId?: string; personId?: string } = {}) => ({
  id,
  dealId,
  leadId: extra.leadId ?? null,
  personId: extra.personId ?? null,
  dueAt,
  pipedriveId: `pd-${id}`,
});

describe("normalizeEmail", () => {
  it("apara e põe em minúsculas", () => {
    expect(normalizeEmail("  Ana@Cliente.COM ")).toBe("ana@cliente.com");
  });
});

describe("splitAttendees", () => {
  it("separa externos de internos pelo domínio, normalizando", () => {
    expect(splitAttendees(["Ana@Cliente.com ", "caio@oxyngroup.com.br"], new Set(["oxyngroup.com.br"]))).toEqual({
      external: ["ana@cliente.com"],
      internal: ["caio@oxyngroup.com.br"],
    });
  });

  it("ignora vazios e repetidos", () => {
    expect(splitAttendees(["a@x.com", "A@x.com", " ", ""], new Set())).toEqual({ external: ["a@x.com"], internal: [] });
  });
});

describe("pickRecord", () => {
  it("lista vazia dá null", () => {
    expect(pickRecord([], MEETING_AT)).toBeNull();
  });

  it("um negócio aberto dá deals", () => {
    const r = pickRecord([cand({ deals: [deal("d1")] })], MEETING_AT);
    expect(r).toEqual({ entity: "deals", recordId: "d1", anchorActivityId: null });
  });

  it("um negócio com reunião dentro de ±1 dia já traz a âncora", () => {
    const r = pickRecord(
      [cand({ deals: [deal("d1")], meetingActivities: [meeting("a1", "d1", "2026-11-05T14:00:00Z")] })],
      MEETING_AT,
    );
    expect(r).toEqual({ entity: "deals", recordId: "d1", anchorActivityId: "a1" });
  });

  it("reunião a mais de 1 dia não vira âncora", () => {
    const r = pickRecord(
      [cand({ deals: [deal("d1")], meetingActivities: [meeting("a1", "d1", "2026-11-07T15:00:00Z")] })],
      MEETING_AT,
    );
    expect(r?.anchorActivityId).toBeNull();
  });

  it("dois negócios: ganha o que tem reunião a 2 h do horário, com âncora", () => {
    const r = pickRecord(
      [
        cand({
          deals: [deal("d1", "2026-11-04T10:00:00Z"), deal("d2")],
          meetingActivities: [
            meeting("a-longe", "d1", "2026-11-06T09:00:00Z"),
            meeting("a-perto", "d2", "2026-11-05T17:00:00Z"),
          ],
        }),
      ],
      MEETING_AT,
    );
    expect(r).toEqual({ entity: "deals", recordId: "d2", anchorActivityId: "a-perto" });
  });

  it("dois negócios sem reunião: desempata pela atividade mais recente", () => {
    const r = pickRecord(
      [cand({ deals: [deal("d1", "2026-10-01T10:00:00Z"), deal("d2", "2026-11-01T10:00:00Z")] })],
      MEETING_AT,
    );
    expect(r).toEqual({ entity: "deals", recordId: "d2", anchorActivityId: null });
  });

  it("dois negócios empatados sem nenhum critério dá null", () => {
    expect(pickRecord([cand({ deals: [deal("d1"), deal("d2")] })], MEETING_AT)).toBeNull();
  });

  it("o mesmo negócio visto por duas pessoas da mesma organização não é empate", () => {
    const r = pickRecord(
      [cand({ personId: "p1", deals: [deal("d1")] }), cand({ personId: "p2", deals: [deal("d1")] })],
      MEETING_AT,
    );
    expect(r).toEqual({ entity: "deals", recordId: "d1", anchorActivityId: null });
  });

  it("sem negócio e com lead dá leads", () => {
    const r = pickRecord(
      [cand({ leads: [{ id: "l1", personId: "p1", organizationId: "o1" }] })],
      MEETING_AT,
    );
    expect(r).toEqual({ entity: "leads", recordId: "l1", anchorActivityId: null });
  });

  it("lead com reunião agendada próxima leva a âncora", () => {
    const r = pickRecord(
      [
        cand({
          leads: [{ id: "l1", personId: "p1", organizationId: "o1" }],
          meetingActivities: [meeting("a1", null, "2026-11-05T15:30:00Z", { leadId: "l1" })],
        }),
      ],
      MEETING_AT,
    );
    expect(r).toEqual({ entity: "leads", recordId: "l1", anchorActivityId: "a1" });
  });

  it("dois leads: desempata pela reunião mais perto", () => {
    const r = pickRecord(
      [
        cand({
          leads: [
            { id: "l1", personId: "p1", organizationId: "o1" },
            { id: "l2", personId: "p1", organizationId: "o1" },
          ],
          meetingActivities: [meeting("a2", null, "2026-11-05T16:00:00Z", { leadId: "l2" })],
        }),
      ],
      MEETING_AT,
    );
    expect(r).toEqual({ entity: "leads", recordId: "l2", anchorActivityId: "a2" });
  });

  it("dois leads sem critério dá null", () => {
    const r = pickRecord(
      [
        cand({
          leads: [
            { id: "l1", personId: "p1", organizationId: "o1" },
            { id: "l2", personId: "p1", organizationId: "o1" },
          ],
        }),
      ],
      MEETING_AT,
    );
    expect(r).toBeNull();
  });

  it("só a pessoa dá persons", () => {
    const r = pickRecord([cand()], MEETING_AT);
    expect(r).toEqual({ entity: "persons", recordId: "p1", anchorActivityId: null });
  });

  it("pessoa com reunião avulsa (sem negócio nem lead) próxima leva a âncora", () => {
    const r = pickRecord(
      [cand({ meetingActivities: [meeting("a1", null, "2026-11-05T13:00:00Z", { personId: "p1" })] })],
      MEETING_AT,
    );
    expect(r).toEqual({ entity: "persons", recordId: "p1", anchorActivityId: "a1" });
  });

  it("duas pessoas de organizações diferentes, cada uma com seu negócio e sem desempate, dá null", () => {
    const r = pickRecord(
      [
        cand({ personId: "p1", orgId: "o1", deals: [deal("d1")] }),
        cand({ personId: "p2", orgId: "o2", deals: [{ id: "d2", personId: "p2", organizationId: "o2", lastActivityAt: null }] }),
      ],
      MEETING_AT,
    );
    expect(r).toBeNull();
  });

  it("duas pessoas diferentes, só pessoas, dá null", () => {
    const r = pickRecord([cand({ personId: "p1" }), cand({ personId: "p2", orgId: "o2" })], MEETING_AT);
    expect(r).toBeNull();
  });

  it("duas pessoas, mas só uma tem negócio: o negócio ganha", () => {
    const r = pickRecord(
      [cand({ personId: "p1", deals: [deal("d1")] }), cand({ personId: "p2", orgId: "o2" })],
      MEETING_AT,
    );
    expect(r).toEqual({ entity: "deals", recordId: "d1", anchorActivityId: null });
  });

  it("negócio vence lead", () => {
    const r = pickRecord(
      [cand({ deals: [deal("d1")], leads: [{ id: "l1", personId: "p1", organizationId: "o1" }] })],
      MEETING_AT,
    );
    expect(r?.entity).toBe("deals");
  });
});
