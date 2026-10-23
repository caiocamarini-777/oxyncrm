import { describe, expect, it } from "vitest";
import { reminderPath } from "./link";

const none = { deal_id: null, lead_id: null, person_id: null, organization_id: null };

describe("reminderPath", () => {
  it("prefere negócio, depois lead, pessoa e organização", () => {
    expect(reminderPath("oxyn", { ...none, deal_id: "d", lead_id: "l" })).toBe("/oxyn/negocios/d");
    expect(reminderPath("oxyn", { ...none, lead_id: "l", person_id: "p" })).toBe("/oxyn/leads/l");
    expect(reminderPath("oxyn", { ...none, person_id: "p", organization_id: "o" })).toBe("/oxyn/contatos/pessoas/p");
    expect(reminderPath("oxyn", { ...none, organization_id: "o" })).toBe("/oxyn/contatos/organizacoes/o");
  });
  it("sem vínculo, cai na lista de atividades", () => {
    expect(reminderPath("oxyn", none)).toBe("/oxyn/atividades");
    expect(reminderPath("oxyn", null)).toBe("/oxyn/atividades");
  });
  it("sem empresa, vai para a raiz", () => {
    expect(reminderPath(null, none)).toBe("/");
  });
});
