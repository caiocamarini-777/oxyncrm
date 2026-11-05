import { describe, expect, it } from "vitest";
import {
  DEFAULT_QUESTIONS,
  MAX_QUESTION_LENGTH,
  MAX_QUESTIONS,
  readMeetingSettings,
  validateMeetingSettings,
  withMeetingSettings,
} from "./settings";

describe("readMeetingSettings", () => {
  it("sem configuração devolve o padrão (desligado, roteiro padrão)", () => {
    expect(readMeetingSettings(null)).toEqual({ enabled: false, questions: DEFAULT_QUESTIONS });
    expect(readMeetingSettings(undefined)).toEqual({ enabled: false, questions: DEFAULT_QUESTIONS });
    expect(readMeetingSettings({})).toEqual({ enabled: false, questions: DEFAULT_QUESTIONS });
    expect(readMeetingSettings("x")).toEqual({ enabled: false, questions: DEFAULT_QUESTIONS });
  });

  it("roteiro padrão é o da spec", () => {
    expect(DEFAULT_QUESTIONS).toEqual(["Dor principal", "Orçamento", "Decisor", "Prazo", "Concorrentes", "Próximo passo"]);
  });

  it("lê o liga/desliga e o roteiro gravados", () => {
    expect(readMeetingSettings({ meeting_assistant: { enabled: true, questions: ["X"] } })).toEqual({
      enabled: true,
      questions: ["X"],
    });
  });

  it("ligado sem roteiro usa o padrão", () => {
    expect(readMeetingSettings({ meeting_assistant: { enabled: true } })).toEqual({
      enabled: true,
      questions: DEFAULT_QUESTIONS,
    });
    expect(readMeetingSettings({ meeting_assistant: { enabled: true, questions: [] } }).questions).toEqual(
      DEFAULT_QUESTIONS,
    );
  });

  it("ignora valores fora do formato (enabled que não é true, perguntas vazias ou não texto)", () => {
    expect(readMeetingSettings({ meeting_assistant: { enabled: "true" } }).enabled).toBe(false);
    expect(
      readMeetingSettings({ meeting_assistant: { enabled: true, questions: ["  Dor ", "", 3, null, "Prazo"] } }).questions,
    ).toEqual(["Dor", "Prazo"]);
  });

  it("não devolve a mesma lista do padrão (mutação não vaza)", () => {
    const s = readMeetingSettings(null);
    s.questions.push("Outra");
    expect(DEFAULT_QUESTIONS).toHaveLength(6);
  });
});

describe("validateMeetingSettings", () => {
  it("aceita de 1 a 15 perguntas e apara os espaços", () => {
    expect(validateMeetingSettings({ enabled: true, questions: ["  Dor principal ", "Prazo"] })).toEqual({
      ok: true,
      value: { enabled: true, questions: ["Dor principal", "Prazo"] },
    });
    const um = validateMeetingSettings({ enabled: false, questions: ["X"] });
    expect(um).toEqual({ ok: true, value: { enabled: false, questions: ["X"] } });
    const quinze = Array.from({ length: MAX_QUESTIONS }, (_, i) => `Pergunta ${i + 1}`);
    expect(validateMeetingSettings({ enabled: true, questions: quinze }).ok).toBe(true);
  });

  it("recusa 0 perguntas", () => {
    const r = validateMeetingSettings({ enabled: true, questions: [] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/pelo menos uma pergunta/i);
  });

  it("recusa 16 perguntas", () => {
    const r = validateMeetingSettings({
      enabled: true,
      questions: Array.from({ length: MAX_QUESTIONS + 1 }, (_, i) => `Pergunta ${i + 1}`),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/15/);
  });

  it("recusa pergunta vazia ou só com espaços", () => {
    for (const questions of [[""], ["Dor", "   "], ["Dor", "", "Prazo"]]) {
      const r = validateMeetingSettings({ enabled: true, questions });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/vazia/i);
    }
  });

  it("limita cada pergunta a 200 caracteres (depois de aparar)", () => {
    expect(validateMeetingSettings({ enabled: true, questions: ["a".repeat(MAX_QUESTION_LENGTH)] }).ok).toBe(true);
    expect(validateMeetingSettings({ enabled: true, questions: [` ${"a".repeat(MAX_QUESTION_LENGTH)} `] }).ok).toBe(true);
    const r = validateMeetingSettings({ enabled: true, questions: ["a".repeat(MAX_QUESTION_LENGTH + 1)] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/200/);
  });

  it("recusa formato inválido (enabled que não é booleano, perguntas que não são texto)", () => {
    expect(validateMeetingSettings(null).ok).toBe(false);
    expect(validateMeetingSettings({ enabled: "true", questions: ["X"] }).ok).toBe(false);
    expect(validateMeetingSettings({ enabled: true, questions: "X" }).ok).toBe(false);
    expect(validateMeetingSettings({ enabled: true, questions: [3] }).ok).toBe(false);
    expect(validateMeetingSettings({ enabled: true }).ok).toBe(false);
  });
});

describe("withMeetingSettings", () => {
  it("troca só meeting_assistant e preserva o resto do JSON", () => {
    const antes = { email_sent_as_activity: true, meeting_assistant: { enabled: false, questions: ["Velha"] }, outra: { a: 1 } };
    expect(withMeetingSettings(antes, { enabled: true, questions: ["Nova"] })).toEqual({
      email_sent_as_activity: true,
      meeting_assistant: { enabled: true, questions: ["Nova"] },
      outra: { a: 1 },
    });
    expect(antes.meeting_assistant.enabled).toBe(false);
  });

  it("settings vazio ou fora do formato vira só meeting_assistant", () => {
    for (const s of [null, undefined, "x", [1, 2]]) {
      expect(withMeetingSettings(s, { enabled: false, questions: ["X"] })).toEqual({
        meeting_assistant: { enabled: false, questions: ["X"] },
      });
    }
  });
});
