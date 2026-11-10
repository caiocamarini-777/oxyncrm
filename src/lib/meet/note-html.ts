/**
 * HTML da anotação gravada no Pipedrive (que aceita um subconjunto de HTML nas notas):
 * seções em negrito, listas `<ul><li>` e rodapé em itálico. Todo texto vem do Claude ou do Gemini, então passa por escape.
 */
import { formatShortDate, formatTime } from "@/lib/activities/time";
import type { MeetingNotes } from "./notes";

export type NoteMeta = {
  /** Início da reunião (ISO). */
  startedAt: string;
  ownerName: string;
  /** Falso quando o vendedor não tem usuário mapeado no Pipedrive: o rodapé cita o nome dele. */
  mappedUser: boolean;
};

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** Lista de itens já em HTML; vazia vira string vazia (a seção some). */
const list = (items: string[]) => (items.length ? `<ul>${items.map((i) => `<li>${i}</li>`).join("")}</ul>` : "");

const section = (title: string, body: string) => (body ? `<b>${title}</b>${body}` : "");

export function renderNoteHtml(n: MeetingNotes, meta: NoteMeta): string {
  // Parágrafos separados por linha em branco; quebra simples vira <br> (o resumo do Gemini vem em várias linhas).
  const summary = n.summary
    .trim()
    .split(/\n{2,}/)
    .filter((p) => p.trim())
    .map((p) => `<p>${escapeHtml(p.trim()).replace(/\n/g, "<br>")}</p>`)
    .join("");
  const qualification = n.qualification.map((q) => `<b>${escapeHtml(q.question)}:</b> ${escapeHtml(q.answer)}`);
  const steps = n.next_steps.map((s) => {
    const owner = s.owner.trim();
    const due = s.due?.trim();
    const extra = [owner, due ? `até ${due}` : ""].filter(Boolean).join(", ");
    return `${escapeHtml(s.what)}${extra ? ` (${escapeHtml(extra)})` : ""}`;
  });

  const sections = [
    section("Resumo", summary),
    section("Dores", list(n.pains.map(escapeHtml))),
    section("Objeções", list(n.objections.map(escapeHtml))),
    section("Qualificação", list(qualification)),
    section("Próximos passos", list(steps)),
  ].filter(Boolean);

  // data e hora no horário de São Paulo: "05/11 14:30"
  const when = `${formatShortDate(meta.startedAt)} ${formatTime(meta.startedAt)}`;
  const owner = meta.mappedUser ? "" : ` (vendedor: ${escapeHtml(meta.ownerName)})`;
  sections.push(`<i>Gerada pelo assistente a partir da reunião de ${when}${owner}</i>`);

  return sections.join("");
}
