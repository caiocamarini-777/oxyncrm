import { describe, expect, it } from "vitest";
import {
  canDecide,
  canDiscard,
  canLink,
  canRetry,
  isLinkEntity,
  isOwnerOrAdmin,
  outcomeIdFor,
  outcomeMap,
  stagePipedriveIdFor,
  typeKeyFor,
  validateEdited,
} from "./decisions";

const activity = { type: "Ligação", subject: "Enviar proposta", due_date: "2026-11-12", due_time: "09:30" };

describe("validateEdited", () => {
  it("aceita a próxima atividade com data AAAA-MM-DD e hora HH:MM", () => {
    const r = validateEdited("next_activity", activity);
    expect(r).toEqual({ ok: true, payload: activity });
  });

  it("aceita hora nula e apara os textos", () => {
    const r = validateEdited("next_activity", { ...activity, subject: "  Enviar proposta  ", due_time: null });
    expect(r).toEqual({ ok: true, payload: { ...activity, due_time: null } });
  });

  it("recusa data fora do formato AAAA-MM-DD", () => {
    const r = validateEdited("next_activity", { ...activity, due_date: "12/11/2026" });
    expect(r.ok).toBe(false);
  });

  it("recusa data inexistente", () => {
    expect(validateEdited("next_activity", { ...activity, due_date: "2026-02-30" }).ok).toBe(false);
    expect(validateEdited("next_activity", { ...activity, due_date: "2026-13-01" }).ok).toBe(false);
  });

  it("recusa hora fora de HH:MM de 24 h", () => {
    for (const due_time of ["9:30", "24:00", "09:60", "09:30:00", "9h", ""]) {
      expect(validateEdited("next_activity", { ...activity, due_time }).ok, due_time).toBe(false);
    }
  });

  it("recusa assunto vazio ou com mais de 200 caracteres", () => {
    expect(validateEdited("next_activity", { ...activity, subject: "   " }).ok).toBe(false);
    expect(validateEdited("next_activity", { ...activity, subject: "x".repeat(201) }).ok).toBe(false);
    expect(validateEdited("next_activity", { ...activity, subject: "x".repeat(200) }).ok).toBe(true);
  });

  it("recusa tipo vazio e entrada que não é objeto", () => {
    expect(validateEdited("next_activity", { ...activity, type: "" }).ok).toBe(false);
    expect(validateEdited("next_activity", null).ok).toBe(false);
    expect(validateEdited("next_activity", "texto").ok).toBe(false);
  });

  it("valida o resultado e a etapa", () => {
    expect(validateEdited("meeting_outcome", { outcome: " Concluída qualificada " })).toEqual({
      ok: true,
      payload: { outcome: "Concluída qualificada" },
    });
    expect(validateEdited("meeting_outcome", { outcome: "" }).ok).toBe(false);
    expect(validateEdited("stage", { stage: "Proposta" })).toEqual({ ok: true, payload: { stage: "Proposta" } });
    expect(validateEdited("stage", {}).ok).toBe(false);
  });

  it("ignora campos extras", () => {
    const r = validateEdited("stage", { stage: "Proposta", extra: 1 });
    expect(r).toEqual({ ok: true, payload: { stage: "Proposta" } });
  });
});

describe("outcomeIdFor", () => {
  const map = outcomeMap([
    { id: 1, label: "Concluída qualificada" },
    { id: "2", label: " Sem interesse " },
    { id: "x", label: "Inválida" },
  ]);

  it("devolve o id do resultado pelo nome", () => {
    expect(outcomeIdFor("Concluída qualificada", map)).toBe(1);
    expect(outcomeIdFor("Sem interesse", map)).toBe(2);
  });

  it("ignora caixa e espaços", () => {
    expect(outcomeIdFor("  concluída QUALIFICADA ", map)).toBe(1);
  });

  it("devolve null para nome desconhecido ou opção sem id numérico", () => {
    expect(outcomeIdFor("Outro", map)).toBeNull();
    expect(outcomeIdFor("Inválida", map)).toBeNull();
  });
});

describe("typeKeyFor", () => {
  const types = [
    { name: "Ligação", key_string: "call" },
    { name: "Reunião", key_string: "meeting" },
  ];
  it("devolve a chave do tipo pelo nome", () => {
    expect(typeKeyFor("Ligação", types)).toBe("call");
    expect(typeKeyFor(" reunião ", types)).toBe("meeting");
  });
  it("cai em task quando o tipo não existe", () => {
    expect(typeKeyFor("Visita", types)).toBe("task");
  });
});

describe("stagePipedriveIdFor", () => {
  const pipelines = {
    "1": { stages: { "10": "crm-a", "11": "crm-b", "12": null } },
    "2": { stages: { "20": "crm-c" } },
  };
  it("inverte o mapa das etapas", () => {
    expect(stagePipedriveIdFor("crm-b", pipelines)).toBe(11);
    expect(stagePipedriveIdFor("crm-c", pipelines)).toBe(20);
  });
  it("usa o cache do funil criado pela importação quando o mapeamento não tem a etapa", () => {
    const cached = { "3": { stages: { "30": "crm-d" } } };
    expect(stagePipedriveIdFor("crm-d", pipelines, cached)).toBe(30);
    expect(stagePipedriveIdFor("crm-d", pipelines)).toBeNull();
  });
  it("o mapeamento vale antes do cache", () => {
    const cached = { "9": { stages: { "99": "crm-a" } } };
    expect(stagePipedriveIdFor("crm-a", pipelines, cached)).toBe(10);
  });
  it("devolve null quando a etapa não foi importada", () => {
    expect(stagePipedriveIdFor("crm-z", pipelines)).toBeNull();
    expect(stagePipedriveIdFor("crm-a", undefined)).toBeNull();
  });
});

describe("canLink", () => {
  const meeting = { owner_id: "u1", status: "unlinked" as const };
  it("vale só para reunião sem vínculo do dono", () => {
    expect(canLink(meeting, "u1", false)).toBe(true);
    expect(canLink(meeting, "u2", false)).toBe(false);
  });
  it("vale para o admin geral", () => {
    expect(canLink(meeting, "u2", true)).toBe(true);
  });
  it("não vale para outros status", () => {
    for (const status of ["waiting_transcript", "processing", "done", "failed", "ignored"] as const) {
      expect(canLink({ owner_id: "u1", status }, "u1", true), status).toBe(false);
    }
  });
  it("vale para reunião concluída com o registro na lixeira (sem vínculo calculado)", () => {
    const done = { owner_id: "u1", status: "done" as const };
    expect(canLink(done, "u1", false, true)).toBe(true);
    expect(canLink(done, "u2", true, true)).toBe(true);
    expect(canLink(done, "u2", false, true)).toBe(false);
    expect(canLink(done, "u1", false, false)).toBe(false);
    // a lixeira só conta para reunião concluída
    expect(canLink({ owner_id: "u1", status: "failed" }, "u1", false, true)).toBe(false);
  });
});

describe("isLinkEntity", () => {
  it("aceita só negócio, lead e pessoa", () => {
    expect(isLinkEntity("deals")).toBe(true);
    expect(isLinkEntity("leads")).toBe(true);
    expect(isLinkEntity("persons")).toBe(true);
    expect(isLinkEntity("organizations")).toBe(false);
    expect(isLinkEntity("notes")).toBe(false);
    expect(isLinkEntity(undefined)).toBe(false);
  });
});

describe("canDiscard e canRetry", () => {
  it("descartar vale para sem vínculo e com falha", () => {
    expect(canDiscard("unlinked")).toBe(true);
    expect(canDiscard("failed")).toBe(true);
    expect(canDiscard("done")).toBe(false);
    expect(canDiscard("processing")).toBe(false);
  });
  it("descartar vale para concluída só com o registro na lixeira", () => {
    expect(canDiscard("done", true)).toBe(true);
    expect(canDiscard("done", false)).toBe(false);
    expect(canDiscard("ignored", true)).toBe(false);
  });
  it("tentar de novo vale só para falha", () => {
    expect(canRetry("failed")).toBe(true);
    expect(canRetry("unlinked")).toBe(false);
  });
});

describe("isOwnerOrAdmin", () => {
  it("descartar e tentar de novo: só o dono da reunião ou o admin geral", () => {
    const m = { owner_id: "u1" };
    expect(isOwnerOrAdmin(m, "u1", false)).toBe(true);
    expect(isOwnerOrAdmin(m, "u2", true)).toBe(true);
    // gestor que edita o registro vinculado, mas não é o dono
    expect(isOwnerOrAdmin(m, "u2", false)).toBe(false);
  });
});

describe("canDecide", () => {
  it("confirmar ou descartar vale para pendente e com falha", () => {
    expect(canDecide("pending")).toBe(true);
    expect(canDecide("failed")).toBe(true);
    expect(canDecide("confirmed")).toBe(false);
    expect(canDecide("dismissed")).toBe(false);
  });
});
