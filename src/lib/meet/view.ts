/**
 * Textos e formulário das sugestões do assistente no card (puro, sem banco nem rede: roda no navegador).
 * A validação de verdade é a de `decisions.ts`, a mesma que o servidor aplica ao confirmar.
 */
import { validateEdited, type MeetingStatus, type SuggestionKind } from "./decisions";

export const SUGGESTION_LABELS: Record<SuggestionKind, string> = {
  meeting_outcome: "Resultado da reunião",
  next_activity: "Próxima atividade",
  stage: "Etapa do funil",
};

/** `AAAA-MM-DD` -> `DD/MM/AAAA`. Texto fora do formato fica como está. */
export function formatIsoDate(s: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : s;
}

/** Próximo passo combinado na reunião: "Enviar proposta (Caio, até 10/11/2026)". */
export function describeNextStep(step: { what: string; owner: string; due: string | null }): string {
  const due = step.due?.trim();
  const extra = [step.owner.trim(), due ? `até ${formatIsoDate(due)}` : ""].filter(Boolean).join(", ");
  return `${step.what.trim()}${extra ? ` (${extra})` : ""}`;
}

/** Uma linha que diz o que a sugestão faz quando confirmada. */
export function describeSuggestion(kind: SuggestionKind, payload: unknown): string {
  const v = validateEdited(kind, payload);
  if (!v.ok) return "Conteúdo da sugestão inválido.";
  const p = v.payload;
  if ("outcome" in p) return `Concluir a reunião com o resultado "${p.outcome}"`;
  if ("stage" in p) return `Mover o negócio para a etapa "${p.stage}"`;
  const when = `${formatIsoDate(p.due_date)}${p.due_time ? ` às ${p.due_time}` : ""}`;
  return `Agendar ${p.type}: ${p.subject}, ${when}`;
}

export type FormField = {
  name: string;
  label: string;
  type: "text" | "date" | "time";
  required: boolean;
  maxLength?: number;
};

/** Campos do formulário de edição, por tipo de sugestão (os mesmos nomes do conteúdo guardado). */
export const FORM_FIELDS: Record<SuggestionKind, FormField[]> = {
  meeting_outcome: [{ name: "outcome", label: "Resultado", type: "text", required: true, maxLength: 100 }],
  stage: [{ name: "stage", label: "Etapa", type: "text", required: true, maxLength: 100 }],
  next_activity: [
    { name: "type", label: "Tipo", type: "text", required: true, maxLength: 100 },
    { name: "subject", label: "Assunto", type: "text", required: true, maxLength: 200 },
    { name: "due_date", label: "Data", type: "date", required: true },
    { name: "due_time", label: "Hora (opcional)", type: "time", required: false },
  ],
};

export type FormValues = Record<string, string>;

/** Valores iniciais do formulário a partir do conteúdo guardado; campo ausente ou fora do formato fica vazio. */
export function formValuesFor(kind: SuggestionKind, payload: unknown): FormValues {
  const raw = typeof payload === "object" && payload !== null && !Array.isArray(payload) ? (payload as Record<string, unknown>) : {};
  const values: FormValues = {};
  for (const f of FORM_FIELDS[kind]) {
    const v = raw[f.name];
    values[f.name] = typeof v === "string" ? v : "";
  }
  return values;
}

/** Conteúdo para `validateEdited` / `confirmSuggestion` a partir do formulário (hora vazia vira `null`). */
export function payloadFromForm(kind: SuggestionKind, values: FormValues): unknown {
  if (kind === "meeting_outcome") return { outcome: values.outcome ?? "" };
  if (kind === "stage") return { stage: values.stage ?? "" };
  return {
    type: values.type ?? "",
    subject: values.subject ?? "",
    due_date: values.due_date ?? "",
    due_time: values.due_time?.trim() ? values.due_time.trim() : null,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Página Reuniões
// ---------------------------------------------------------------------------------------------------------------

/** Abas calculadas da página Reuniões (ver `meetingTab` em `queries.ts`). */
export type MeetingTabKey = "pendentes" | "sem-vinculo" | "com-erro";
export type MeetingListTab = MeetingTabKey | "todas";

export const MEETING_TABS: { key: MeetingListTab; label: string }[] = [
  { key: "pendentes", label: "Pendentes" },
  { key: "sem-vinculo", label: "Sem vínculo" },
  { key: "com-erro", label: "Com erro" },
  { key: "todas", label: "Todas" },
];

/** Aba pedida na URL (`?aba=`); ausente ou desconhecida abre Pendentes. */
export function parseMeetingTab(v: string | null | undefined): MeetingListTab {
  return MEETING_TABS.find((t) => t.key === v)?.key ?? "pendentes";
}

/** Sugestão sem resposta há mais disso aparece em destaque para a gestão. */
export const PENDING_OVERDUE_MS = 24 * 3600_000;

/** Pendente há mais de 24 h (exatamente 24 h ainda não). Data inválida não destaca. */
export function isPendingOverdue(since: string, nowMs: number): boolean {
  const t = Date.parse(since);
  return Number.isFinite(t) && nowMs - t > PENDING_OVERDUE_MS;
}

const STATUS_LABELS: Record<MeetingStatus, string> = {
  waiting_transcript: "Aguardando transcrição",
  processing: "Processando",
  unlinked: "Sem vínculo",
  done: "Concluída",
  failed: "Com erro",
  ignored: "Descartada",
};

/** Situação mostrada na lista: a aba calculada (sem vínculo, pendente, erro) vale mais que o status gravado. */
export function meetingSituation(status: MeetingStatus, tab: MeetingTabKey | null): string {
  if (tab === "sem-vinculo") return "Sem vínculo";
  if (tab === "pendentes") return "Sugestões pendentes";
  if (tab === "com-erro") return "Com erro";
  return STATUS_LABELS[status];
}
