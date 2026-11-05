import { describe, expect, it } from "vitest";
import { notificationPath, reminderPath } from "./link";

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

describe("notificationPath", () => {
  it("lembrete de atividade segue o vínculo da atividade", () => {
    expect(notificationPath("activity_reminder", "oxyn", { ...none, deal_id: "d" })).toBe("/oxyn/negocios/d");
    expect(notificationPath("activity_reminder", "oxyn", null)).toBe("/oxyn/atividades");
  });
  it("reunião sem vínculo leva à aba Sem vínculo da empresa", () => {
    expect(notificationPath("meeting_unlinked", "oxyn", null)).toBe("/oxyn/reunioes?aba=sem-vinculo");
  });
  it("sem empresa, vai para a raiz, qualquer que seja o tipo", () => {
    expect(notificationPath("meeting_unlinked", null, null)).toBe("/");
    expect(notificationPath("activity_reminder", null, null)).toBe("/");
  });
  it("tipo desconhecido cai no destino do lembrete", () => {
    expect(notificationPath("outro", "oxyn", null)).toBe("/oxyn/atividades");
  });
});
