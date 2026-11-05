import { describe, expect, it } from "vitest";
import { DEFAULT_QUESTIONS, readMeetingSettings } from "./settings";

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
