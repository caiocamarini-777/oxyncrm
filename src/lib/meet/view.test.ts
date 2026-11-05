import { describe, expect, it } from "vitest";
import { validateEdited } from "./decisions";
import { describeNextStep, describeSuggestion, FORM_FIELDS, formatIsoDate, formValuesFor, payloadFromForm, SUGGESTION_LABELS } from "./view";

describe("formatIsoDate", () => {
  it("AAAA-MM-DD vira DD/MM/AAAA", () => {
    expect(formatIsoDate("2026-11-12")).toBe("12/11/2026");
  });
  it("texto fora do formato fica como está", () => {
    expect(formatIsoDate("amanhã")).toBe("amanhã");
  });
});

describe("describeSuggestion", () => {
  it("resultado da reunião", () => {
    expect(describeSuggestion("meeting_outcome", { outcome: "Realizada" })).toBe('Concluir a reunião com o resultado "Realizada"');
  });
  it("próxima atividade com e sem horário", () => {
    const base = { type: "Ligação", subject: "Retornar a proposta", due_date: "2026-11-12" };
    expect(describeSuggestion("next_activity", { ...base, due_time: "14:30" })).toBe(
      "Agendar Ligação: Retornar a proposta, 12/11/2026 às 14:30",
    );
    expect(describeSuggestion("next_activity", { ...base, due_time: null })).toBe(
      "Agendar Ligação: Retornar a proposta, 12/11/2026",
    );
  });
  it("etapa", () => {
    expect(describeSuggestion("stage", { stage: "Proposta" })).toBe('Mover o negócio para a etapa "Proposta"');
  });
  it("conteúdo inválido não quebra", () => {
    expect(describeSuggestion("stage", {})).toBe("Conteúdo da sugestão inválido.");
    expect(describeSuggestion("next_activity", null)).toBe("Conteúdo da sugestão inválido.");
  });
});

describe("campos do formulário de edição", () => {
  it("cada tipo tem seus campos, e os rótulos existem", () => {
    expect(FORM_FIELDS.meeting_outcome.map((f) => f.name)).toEqual(["outcome"]);
    expect(FORM_FIELDS.stage.map((f) => f.name)).toEqual(["stage"]);
    expect(FORM_FIELDS.next_activity.map((f) => f.name)).toEqual(["type", "subject", "due_date", "due_time"]);
    expect(Object.keys(SUGGESTION_LABELS).sort()).toEqual(["meeting_outcome", "next_activity", "stage"]);
  });

  it("formValuesFor preenche com o conteúdo sugerido; hora nula vira vazio", () => {
    expect(
      formValuesFor("next_activity", { type: "Ligação", subject: "Retornar", due_date: "2026-11-12", due_time: null }),
    ).toEqual({ type: "Ligação", subject: "Retornar", due_date: "2026-11-12", due_time: "" });
    expect(formValuesFor("stage", { stage: "Proposta" })).toEqual({ stage: "Proposta" });
  });

  it("formValuesFor tolera JSON estranho: campos viram vazio", () => {
    expect(formValuesFor("meeting_outcome", null)).toEqual({ outcome: "" });
    expect(formValuesFor("next_activity", { type: 3, subject: ["x"] })).toEqual({
      type: "",
      subject: "",
      due_date: "",
      due_time: "",
    });
  });

  it("payloadFromForm monta o conteúdo que o servidor valida; hora vazia vira nula", () => {
    const values = { type: "Ligação", subject: " Retornar ", due_date: "2026-11-12", due_time: "" };
    expect(payloadFromForm("next_activity", values)).toEqual({
      type: "Ligação",
      subject: " Retornar ",
      due_date: "2026-11-12",
      due_time: null,
    });
    expect(validateEdited("next_activity", payloadFromForm("next_activity", values))).toEqual({
      ok: true,
      payload: { type: "Ligação", subject: "Retornar", due_date: "2026-11-12", due_time: null },
    });
    expect(payloadFromForm("next_activity", { ...values, due_time: "09:15" })).toMatchObject({ due_time: "09:15" });
    expect(payloadFromForm("meeting_outcome", { outcome: "Realizada" })).toEqual({ outcome: "Realizada" });
    expect(payloadFromForm("stage", { stage: "Proposta" })).toEqual({ stage: "Proposta" });
  });

  it("campo obrigatório vazio é recusado pela validação existente", () => {
    expect(validateEdited("stage", payloadFromForm("stage", { stage: "  " }))).toMatchObject({ ok: false });
  });
});

describe("describeNextStep", () => {
  it("o que fazer, com responsável e prazo", () => {
    expect(describeNextStep({ what: "Enviar proposta", owner: "Caio", due: "2026-11-10" })).toBe(
      "Enviar proposta (Caio, até 10/11/2026)",
    );
  });
  it("só responsável, só prazo ou nenhum", () => {
    expect(describeNextStep({ what: "Enviar proposta", owner: "Caio", due: null })).toBe("Enviar proposta (Caio)");
    expect(describeNextStep({ what: "Enviar proposta", owner: " ", due: "2026-11-10" })).toBe(
      "Enviar proposta (até 10/11/2026)",
    );
    expect(describeNextStep({ what: " Enviar proposta ", owner: "", due: null })).toBe("Enviar proposta");
  });
  it("prazo fora do formato AAAA-MM-DD é mostrado como veio", () => {
    expect(describeNextStep({ what: "Ligar", owner: "", due: "semana que vem" })).toBe("Ligar (até semana que vem)");
  });
});
