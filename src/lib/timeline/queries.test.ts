import { describe, expect, it } from "vitest";
import { describeEvent, joinList, linkify } from "./describe";

const names = { u1: "Ana", u2: "Bruno", r1: "Sem orçamento" };

describe("describeEvent", () => {
  const ev = (kind: string, data: Record<string, unknown> = {}, entity = "organizations") => ({
    kind,
    entity,
    data,
  });
  it("eventos simples", () => {
    expect(describeEvent(ev("created"), names)).toBe("Criou o registro");
    expect(describeEvent(ev("trashed"), names)).toBe("Moveu para a lixeira");
    expect(describeEvent(ev("restored"), names)).toBe("Restaurou da lixeira");
    expect(describeEvent(ev("note_added", { note_id: "x" }), names)).toBe("");
  });
  it("responsável", () => {
    expect(describeEvent(ev("owner_changed", { from: "u1", to: "u2" }), names)).toBe(
      "Trocou o responsável de Ana para Bruno",
    );
    expect(describeEvent(ev("owner_changed", { from: "zz", to: "u2" }), names)).toBe(
      "Trocou o responsável de alguém para Bruno",
    );
  });
  it("status com e sem motivo", () => {
    expect(
      describeEvent(ev("status_changed", { from: "open", to: "disqualified", reason_id: "r1" }, "leads"), names),
    ).toBe("Mudou o status para Desqualificado (Sem orçamento)");
    expect(describeEvent(ev("status_changed", { from: "open", to: "archived", reason_id: null }, "leads"), names)).toBe(
      "Mudou o status para Arquivado",
    );
  });
  it("etiquetas", () => {
    expect(describeEvent(ev("label_added", { name: "Quente" }), names)).toBe("Adicionou a etiqueta Quente");
    expect(describeEvent(ev("label_removed", { name: "Quente" }), names)).toBe("Removeu a etiqueta Quente");
  });
  it("updated usa o mapa da entidade", () => {
    expect(describeEvent(ev("updated", { fields: ["name", "segment"] }), names)).toBe("Editou nome e segmento");
    expect(describeEvent(ev("updated", { fields: ["full_name", "job_title", "emails"] }, "persons"), names)).toBe(
      "Editou nome, cargo e e-mails",
    );
    expect(describeEvent(ev("updated", { fields: ["estimated_value"] }, "leads"), names)).toBe(
      "Editou valor estimado",
    );
    expect(describeEvent(ev("updated", { fields: ["mystery"] }), names)).toBe("Editou o registro");
  });
});

describe("joinList", () => {
  it("junta em português", () => {
    expect(joinList(["a"])).toBe("a");
    expect(joinList(["a", "b"])).toBe("a e b");
    expect(joinList(["a", "b", "c"])).toBe("a, b e c");
  });
});

describe("linkify", () => {
  it("só http(s) vira link", () => {
    expect(linkify("veja https://ex.com/a?b=1, ok javascript:alert(1) <script>")).toEqual([
      { type: "text", value: "veja " },
      { type: "link", value: "https://ex.com/a?b=1" },
      { type: "text", value: ", ok javascript:alert(1) <script>" },
    ]);
    expect(linkify("sem link")).toEqual([{ type: "text", value: "sem link" }]);
  });
});

describe("describeEvent com nomes de atividade (como monta timeline/queries)", () => {
  const nm = { a1: "Falar com a Ana", "type:a1": "Ligação" };
  it("agendada usa o tipo do evento e o assunto carregado", () => {
    expect(
      describeEvent({ kind: "activity_scheduled", entity: "leads", data: { activity_id: "a1", type: "Ligação", due_at: "2026-10-24T02:30:00Z" } }, nm),
    ).toBe("Agendou Ligação: Falar com a Ana para 23/10, 23:30");
  });
  it("concluída usa o tipo carregado e o resultado", () => {
    expect(
      describeEvent({ kind: "activity_completed", entity: "deals", data: { activity_id: "a1", outcome: "Sem resposta" } }, nm),
    ).toBe("Concluiu Ligação: Falar com a Ana (Sem resposta)");
  });
  it("sem acesso à atividade cai no texto genérico", () => {
    expect(describeEvent({ kind: "activity_completed", entity: "deals", data: { activity_id: "zz" } }, {})).toBe(
      "Concluiu atividade: atividade",
    );
  });
});
