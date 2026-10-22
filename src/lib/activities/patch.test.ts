import { describe, expect, it } from "vitest";
import { buildActivityPatch, type CurrentActivity } from "./patch";
import { activityEditSchema, MSG_LINK } from "./schema";

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const raw = { typeId: U(1), channelId: U(2), subject: "Ligar", dueAt: "2026-10-23T10:00" };
const cur = (o: Partial<CurrentActivity> = {}): CurrentActivity => ({
  done: false,
  lead_id: null,
  deal_id: null,
  person_id: null,
  organization_id: null,
  ...o,
});
const run = (input: Record<string, unknown>, current: CurrentActivity) => {
  const full = { ...raw, ...input };
  return buildActivityPatch(activityEditSchema.parse(full), full, current);
};

describe("buildActivityPatch", () => {
  it("vínculo ausente no input é preservado (não vai no patch)", () => {
    const r = run({}, cur({ deal_id: U(5), person_id: U(6) }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.patch).not.toHaveProperty("deal_id");
      expect(r.patch).not.toHaveProperty("person_id");
      expect(r.patch).not.toHaveProperty("lead_id");
      expect(r.patch.subject).toBe("Ligar");
    }
  });
  it("null explícito remove só aquele vínculo", () => {
    const r = run({ personId: null }, cur({ deal_id: U(5), person_id: U(6) }));
    expect(r.ok && r.patch.person_id).toBeNull();
    expect(r.ok && "deal_id" in r.patch).toBe(false);
  });
  it("trocar vínculo envia o novo id", () => {
    const r = run({ dealId: U(7) }, cur({ deal_id: U(5) }));
    expect(r.ok && r.patch.deal_id).toBe(U(7));
  });
  it("remover o único vínculo é recusado", () => {
    const r = run({ personId: null }, cur({ person_id: U(6) }));
    expect(r).toEqual({ ok: false, error: MSG_LINK });
  });
  it("vínculo oculto conta como existente", () => {
    expect(run({ personId: null }, cur({ person_id: U(6), lead_id: U(8) })).ok).toBe(true);
  });
  it("tipo não muda em atividade concluída", () => {
    const r = run({}, cur({ done: true, lead_id: U(8) }));
    expect(r.ok && "type_id" in r.patch).toBe(false);
  });
});
