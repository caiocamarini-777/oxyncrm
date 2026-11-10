/**
 * Notas da reunião direto das anotações do Gemini, sem o Claude ("modo Gemini"). É o caminho quando não há
 * `ANTHROPIC_API_KEY`: o texto do Google Doc vira o resumo, e a seção de próximas etapas vira a lista de próximos
 * passos. Sem roteiro de qualificação, dores, objeções nem sugestões de funil (isso só o Claude faz).
 */
import type { MeetingNotes } from "./notes";

export type NotesEngine = "claude" | "gemini";

/** Com a chave da Anthropic, o Claude escreve as notas; sem ela, valem as anotações do Gemini. */
export function notesEngineFromEnv(env: Record<string, string | undefined> = process.env): NotesEngine {
  return env.ANTHROPIC_API_KEY?.trim() ? "claude" : "gemini";
}

/** Valor de `meeting_notes.model` para as notas vindas do Gemini. */
export const GEMINI_NOTES_MODEL = "gemini-notes";

/** Reunião só com transcrição no modo Gemini: não há o que resumir sem o Claude. */
export const NO_GEMINI_NOTES =
  'Reunião sem anotações do Gemini: ligue "Fazer anotações com o Gemini" nas próximas reuniões. Para resumir a transcrição, cadastre a chave da Anthropic e tente de novo.';

/** Teto do resumo (a anotação no CRM aceita até 10.000 caracteres, com a moldura do HTML). */
export const MAX_SUMMARY_CHARS = 8000;

const STEPS_HEADING = /^(pr[oó]xim[ao]s?\s+(etapas|passos)(\s+sugerid[ao]s)?|suggested\s+next\s+steps|next\s+steps|action\s+items|itens\s+de\s+a[cç][aã]o)\s*:?\s*$/i;
/** Marcadores de lista do texto exportado do Google Docs (e de listas de tarefas). */
const BULLET = /^\s*(?:[-*•○●▪◦]|\d+[.)]|\[\s?[xX]?\s?\]|☐|☑)\s+/;
const OWNER = /^\[([^\]]{1,80})\]\s*(.+)$/;

/** Uma linha de próxima etapa: sem marcador; "[Fulano] Ação" vira responsável + ação. */
function stepFrom(line: string): MeetingNotes["next_steps"][number] | null {
  let text = line.replace(BULLET, "").trim();
  // Lista de tarefas exportada às vezes repete a caixinha depois do marcador.
  text = text.replace(/^\[\s?[xX]?\s?\]\s*/, "").trim();
  if (!text) return null;
  const m = OWNER.exec(text);
  if (m) return { what: m[2].trim(), owner: m[1].trim(), due: null };
  return { what: text, owner: "", due: null };
}

/** Converte o texto das anotações do Gemini (Google Doc exportado como texto) em notas da reunião. */
export function notesFromGemini(text: string): MeetingNotes {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const at = lines.findIndex((l) => STEPS_HEADING.test(l.trim()));
  const summaryLines = at === -1 ? lines : lines.slice(0, at);
  const next_steps: MeetingNotes["next_steps"] = [];
  if (at !== -1) {
    for (const line of lines.slice(at + 1)) {
      if (!line.trim()) continue;
      // Etapas vêm em lista: depois da primeira, uma linha sem marcador é outra seção (ex.: o aviso do Gemini).
      if (!BULLET.test(line) && next_steps.length > 0) break;
      const step = stepFrom(line);
      if (step) next_steps.push(step);
    }
  }
  const summary = summaryLines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, MAX_SUMMARY_CHARS);
  return {
    summary,
    pains: [],
    objections: [],
    qualification: [],
    next_steps,
    suggestions: { meeting_outcome: null, next_activity: null, stage: null },
  };
}
