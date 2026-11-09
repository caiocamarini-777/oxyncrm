import { describe, expect, it } from "vitest";
import { toActivityRow, type RawRow } from "./rows";

const raw = (o: Partial<RawRow> = {}): RawRow => ({
  id: "a1",
  company_id: "c1",
  lead_id: "l1",
  deal_id: "d1",
  person_id: "p1",
  organization_id: "o1",
  subject: "Ligar",
  description: null,
  due_at: "2026-10-23T15:00:00Z",
  duration_minutes: 30,
  reminder_minutes: null,
  done: false,
  completed_at: null,
  meeting_outcome: null,
  completion_note: null,
  owner_id: "u1",
  booked_by_activity_id: null,
  legacy: false,
  meet_url: null,
  calendar_state: "none",
  calendar_error: null,
  company: { name: "Oxyn", slug: "oxyn" },
  type: { id: "t1", name: "Ligação", is_meeting: false },
  channel: { id: "ch1", name: "Telefone" },
  outcome: null,
  owner: { full_name: "Ana" },
  lead: { id: "l1", title: "Lead", deleted_at: null },
  deal: { id: "d1", title: "Neg", deleted_at: "2026-10-01T00:00:00Z" },
  person: null,
  organization: [{ id: "o1", name: "Org", deleted_at: null }],
  ...o,
});

describe("toActivityRow", () => {
  const now = new Date("2026-10-22T15:00:00Z");
  it("esconde vínculo na lixeira ou ilegível, mas mantém o id cru", () => {
    const r = toActivityRow(raw(), now);
    expect(r.lead).toEqual({ id: "l1", name: "Lead" });
    expect(r.deal).toBeNull();
    expect(r.person).toBeNull();
    expect(r.organization).toEqual({ id: "o1", name: "Org" });
    expect([r.leadId, r.dealId, r.personId, r.organizationId]).toEqual(["l1", "d1", "p1", "o1"]);
  });
  it("status e dados básicos", () => {
    const r = toActivityRow(raw(), now);
    expect(r.status).toBe("upcoming");
    expect(r.type).toEqual({ id: "t1", name: "Ligação", isMeeting: false });
    expect(toActivityRow(raw({ done: true, completed_at: "2026-10-22T10:00:00Z" }), now).status).toBe("done");
  });
  it("traz o link do Meet e a situação da Agenda", () => {
    expect(toActivityRow(raw(), now)).toMatchObject({ meetUrl: null, calendarState: "none", calendarError: null });
    const r = toActivityRow(
      raw({ meet_url: "https://meet.google.com/abc-defg-hij", calendar_state: "error", calendar_error: "Sem permissão." }),
      now,
    );
    expect(r).toMatchObject({
      meetUrl: "https://meet.google.com/abc-defg-hij",
      calendarState: "error",
      calendarError: "Sem permissão.",
    });
  });
  it("a pessoa tem e-mail só quando está visível, fora da lixeira e com e-mail preenchido", () => {
    const person = (o: object) => ({ id: "p1", full_name: "Ana", deleted_at: null, emails: [{ label: "work", value: "ana@acme.com" }], ...o });
    expect(toActivityRow(raw({ person: person({}) }), now).personHasEmail).toBe(true);
    expect(toActivityRow(raw({ person: [person({})] }), now).personHasEmail).toBe(true);
    expect(toActivityRow(raw({ person: person({ emails: [] }) }), now).personHasEmail).toBe(false);
    expect(toActivityRow(raw({ person: person({ emails: [{ label: "work", value: "  " }] }) }), now).personHasEmail).toBe(false);
    expect(toActivityRow(raw({ person: person({ deleted_at: "2026-10-01T00:00:00Z" }) }), now).personHasEmail).toBe(false);
    expect(toActivityRow(raw({ person: null }), now).personHasEmail).toBe(false);
  });
  it("sem pessoa na atividade, vale a pessoa do negócio, senão a do lead (quem a reunião convida)", () => {
    const withEmail = { emails: [{ value: "cliente@acme.com" }], deleted_at: null };
    const noEmail = { emails: [], deleted_at: null };
    const deal = (person: unknown) => ({ id: "d1", title: "Neg", deleted_at: null, person }) as RawRow["deal"];
    const lead = (person: unknown) => ({ id: "l1", title: "Lead", deleted_at: null, person }) as RawRow["lead"];
    const row = (o: Partial<RawRow>) => toActivityRow(raw({ person_id: null, ...o }), now).recordPersonHasEmail;
    expect(row({ deal: deal(withEmail), lead: lead(null) })).toBe(true);
    expect(row({ deal: deal([withEmail]), lead: lead(null) })).toBe(true);
    expect(row({ deal: deal(null), lead: lead(withEmail) })).toBe(true);
    // A pessoa do negócio vem primeiro, mesmo sem e-mail.
    expect(row({ deal: deal(noEmail), lead: lead(withEmail) })).toBe(false);
    expect(row({ deal: deal({ ...withEmail, deleted_at: "2026-10-01T00:00:00Z" }), lead: lead(null) })).toBe(false);
    // Com pessoa na atividade, não há reserva: vale a dela.
    expect(toActivityRow(raw({ person_id: "p1", deal: deal(withEmail) }), now).recordPersonHasEmail).toBe(false);
  });
});
