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
});
