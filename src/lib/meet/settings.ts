/**
 * Configuração do assistente de reuniões por empresa, guardada em `companies.settings.meeting_assistant`
 * (`{enabled, questions}`). Desligado por padrão; ao ligar, vale o roteiro padrão até a empresa editar.
 */

/** Roteiro de qualificação padrão (spec, "Decisões do usuário"). */
export const DEFAULT_QUESTIONS: readonly string[] = Object.freeze([
  "Dor principal",
  "Orçamento",
  "Decisor",
  "Prazo",
  "Concorrentes",
  "Próximo passo",
]);

export type MeetingSettings = { enabled: boolean; questions: string[] };

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Lê a configuração do JSON inteiro de `companies.settings`. Tolerante: valor fora do formato vale o padrão,
 * `enabled` só é verdadeiro com `true` e perguntas que não são texto (ou vazias) são descartadas.
 */
export function readMeetingSettings(settings: unknown): MeetingSettings {
  const raw = isObject(settings) && isObject(settings.meeting_assistant) ? settings.meeting_assistant : {};
  const questions = Array.isArray(raw.questions)
    ? raw.questions.filter((q): q is string => typeof q === "string").map((q) => q.trim()).filter(Boolean)
    : [];
  return {
    enabled: raw.enabled === true,
    questions: questions.length > 0 ? questions : [...DEFAULT_QUESTIONS],
  };
}
