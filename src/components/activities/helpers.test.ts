import { describe, expect, it } from "vitest";
import type { FormValues } from "./activity-form";
import { defaultDue, toCreateInput, toEditInput } from "./helpers";

const base: FormValues = {
  typeId: "t",
  channelId: "c",
  subject: "Ligação",
  description: "",
  dueAt: "2031-03-10T14:30",
  durationMinutes: 30,
  reminderMinutes: null,
};

describe("toEditInput", () => {
  it("deixa os vínculos como undefined quando não foram tocados", () => {
    const i = toEditInput(base);
    expect(i.personId).toBeUndefined();
    expect(i.organizationId).toBeUndefined();
    expect("leadId" in i).toBe(false);
    expect("dealId" in i).toBe(false);
  });

  it("manda null ao remover e o id ao trocar", () => {
    expect(toEditInput({ ...base, person: null }).personId).toBeNull();
    expect(toEditInput({ ...base, organization: { id: "o", name: "Org" } }).organizationId).toBe("o");
  });
});

describe("toCreateInput", () => {
  it("usa os vínculos do registro e completa com pessoa e organização escolhidas", () => {
    const links = { leadId: "l", dealId: null, personId: null, organizationId: null };
    const i = toCreateInput({ ...base, person: { id: "p", name: "Ana" } }, links);
    expect(i).toMatchObject({ leadId: "l", dealId: null, personId: "p", organizationId: null });
  });
});

describe("defaultDue", () => {
  it("arredonda para a próxima hora cheia de São Paulo", () => {
    expect(defaultDue("2031-03-10T17:20:00.000Z")).toBe("2031-03-10T15:00");
    expect(defaultDue("2031-03-10T17:20:00.000Z", 1)).toBe("2031-03-11T15:00");
  });
});
