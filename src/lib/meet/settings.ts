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

/** Limites do roteiro (a tela e a gravação usam os mesmos valores). */
export const MAX_QUESTIONS = 15;
export const MAX_QUESTION_LENGTH = 200;

export type MeetingSettingsResult = { ok: true; value: MeetingSettings } | { ok: false; error: string };

/**
 * Valida o que a tela envia: `enabled` booleano e de 1 a 15 perguntas, cada uma com texto (depois de aparar os
 * espaços) de 1 a 200 caracteres. Não descarta perguntas vazias em silêncio: recusa, para o vendedor ver o erro.
 */
export function validateMeetingSettings(input: unknown): MeetingSettingsResult {
  if (!isObject(input) || typeof input.enabled !== "boolean" || !Array.isArray(input.questions)) {
    return { ok: false, error: "Dados inválidos." };
  }
  if (input.questions.some((q) => typeof q !== "string")) return { ok: false, error: "Dados inválidos." };
  const questions = (input.questions as string[]).map((q) => q.trim());
  if (questions.length === 0) return { ok: false, error: "Informe pelo menos uma pergunta." };
  if (questions.length > MAX_QUESTIONS) return { ok: false, error: `Use no máximo ${MAX_QUESTIONS} perguntas.` };
  if (questions.some((q) => q === "")) return { ok: false, error: "Há uma pergunta vazia. Preencha ou remova." };
  if (questions.some((q) => q.length > MAX_QUESTION_LENGTH)) {
    return { ok: false, error: `Cada pergunta pode ter no máximo ${MAX_QUESTION_LENGTH} caracteres.` };
  }
  return { ok: true, value: { enabled: input.enabled, questions } };
}

/** Devolve o JSON de `companies.settings` com `meeting_assistant` trocado e as outras chaves intactas. */
export function withMeetingSettings(settings: unknown, value: MeetingSettings): Record<string, unknown> {
  const base = isObject(settings) ? settings : {};
  return { ...base, meeting_assistant: { enabled: value.enabled, questions: value.questions } };
}
