/**
 * Notas da reunião com o Claude: monta o pedido (prompt estável + dados da reunião),
 * chama a API com saída estruturada e valida o resultado. Regras na spec, "Gerar as notas".
 * O cliente é injetável para os testes; o padrão só é criado quando a função roda, então
 * importar este módulo sem `ANTHROPIC_API_KEY` não quebra.
 */
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";

const MODEL = "claude-opus-5-5";
const MAX_TOKENS = 16000;

/** Limite da transcrição enviada, em caracteres (~150 mil tokens): cabe folgado no contexto. */
const MAX_TRANSCRIPT_CHARS = 450_000;

export const MeetingNotesSchema = z.object({
  summary: z.string(),
  pains: z.array(z.string()),
  objections: z.array(z.string()),
  qualification: z.array(z.object({ question: z.string(), answer: z.string() })),
  next_steps: z.array(z.object({ what: z.string(), owner: z.string(), due: z.string().nullable() })),
  suggestions: z.object({
    meeting_outcome: z.string().nullable(),
    next_activity: z
      .object({
        type: z.string(),
        subject: z.string(),
        due_date: z.string(),
        due_time: z.string().nullable(),
      })
      .nullable(),
    stage: z.string().nullable(),
  }),
});

export type MeetingNotes = z.infer<typeof MeetingNotesSchema>;

export type NotesInput = {
  transcript: string;
  /** Roteiro de qualificação da empresa, na ordem. */
  questions: string[];
  title: string;
  /** Início da reunião (ISO). */
  startedAt: string;
  participants: string[];
  record: {
    kind: string;
    name: string;
    stage?: string;
    value?: number;
    setup?: number;
    mrr?: number;
    recentNotes: string[];
  };
  /** Nomes dos resultados de reunião da empresa. */
  outcomes: string[];
  activityTypes: string[];
  stages: string[];
};

/** Falha ao gerar as notas (recusa, resposta inválida ou erro da chamada). */
export class NotesError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "NotesError";
  }
}

// Fixo de propósito: nada de data, empresa ou reunião aqui, para o prompt poder ser cacheado.
const SYSTEM_PROMPT = `Você é o assistente de vendas do Oxyn CRM. Recebe a transcrição de uma reunião comercial pelo Google Meet e o contexto do registro (negócio, lead ou pessoa) e devolve as notas da reunião em JSON, em português do Brasil.

Regras:
- Use só o que está na transcrição e no contexto. Não invente fatos, números, nomes nem datas.
- "summary": resumo objetivo da reunião, em poucas frases.
- "pains": dores e necessidades que o cliente expressou. "objections": objeções e resistências. Listas vazias quando não houver.
- "qualification": devolva exatamente uma entrada por pergunta do roteiro, na mesma ordem e com o texto da pergunta idêntico ao do roteiro. Se a transcrição não trouxer a resposta, use "Não mencionado" em "answer".
- "next_steps": combinados da reunião, com o que fazer ("what"), o responsável ("owner") e o prazo ("due", no formato AAAA-MM-DD, ou nulo quando não houver prazo claro).
- "suggestions.meeting_outcome": o resultado da reunião, escolhido só entre os resultados permitidos informados, ou nulo se nenhum servir.
- "suggestions.next_activity": a próxima atividade a agendar, com "type" escolhido só entre os tipos de atividade permitidos, "subject" curto, "due_date" (AAAA-MM-DD) e "due_time" (HH:MM, ou nulo se não houver horário). Nulo se a conversa não definir um próximo passo agendável.
- "suggestions.stage": a etapa do funil, escolhida só entre as etapas informadas, e somente quando a conversa deixa claro que o negócio avançou. Na dúvida, nulo.
- Todas as datas e horários seguem o fuso de São Paulo (America/Sao_Paulo). Resolva datas relativas ("amanhã", "sexta") a partir da data da reunião.
- O texto das notas fica em português do Brasil, mesmo que a conversa tenha trechos em outro idioma.`;

/** Lista com marcador, ou "(nenhum)" quando vazia. */
function bullets(items: string[]): string {
  return items.length ? items.map((i) => `- ${i}`).join("\n") : "(nenhum)";
}

/** Corta a transcrição no limite, mantendo o começo e o fim (onde ficam combinados e próximos passos). */
function clipTranscript(text: string): string {
  if (text.length <= MAX_TRANSCRIPT_CHARS) return text;
  const half = Math.floor(MAX_TRANSCRIPT_CHARS / 2);
  return `${text.slice(0, half)}\n\n[... trecho do meio omitido por tamanho ...]\n\n${text.slice(text.length - half)}`;
}

/** Monta o pedido: `system` fixo e `user` com os dados da reunião. */
export function buildNotesRequest(input: NotesInput): { system: string; user: string } {
  const r = input.record;
  const money = [
    r.value != null ? `Valor: ${r.value}` : null,
    r.setup != null ? `Setup: ${r.setup}` : null,
    r.mrr != null ? `MRR: ${r.mrr}` : null,
  ].filter(Boolean);

  const user = [
    "## Reunião",
    `Título: ${input.title}`,
    `Início: ${input.startedAt}`,
    `Participantes:\n${bullets(input.participants)}`,
    "",
    "## Registro no CRM",
    `Tipo: ${r.kind}`,
    `Nome: ${r.name}`,
    r.stage ? `Etapa atual: ${r.stage}` : null,
    money.length ? money.join(" | ") : null,
    `Últimas anotações:\n${bullets(r.recentNotes)}`,
    "",
    "## Roteiro de qualificação (uma resposta por pergunta, nesta ordem)",
    input.questions.map((q, i) => `${i + 1}. ${q}`).join("\n"),
    "",
    "## Opções permitidas",
    `Resultados da reunião:\n${bullets(input.outcomes)}`,
    `Tipos de atividade:\n${bullets(input.activityTypes)}`,
    `Etapas do funil:\n${bullets(input.stages)}`,
    "",
    "## Transcrição",
    clipTranscript(input.transcript),
  ]
    .filter((l): l is string => l !== null)
    .join("\n");

  return { system: SYSTEM_PROMPT, user };
}

/** Confere a resposta com o pedido e zera as sugestões que fogem das listas permitidas. */
function validate(notes: MeetingNotes, input: NotesInput): MeetingNotes {
  const q = notes.qualification;
  if (q.length !== input.questions.length) {
    throw new NotesError("A qualificação não bate com o roteiro da empresa.");
  }
  const s = notes.suggestions;
  return {
    ...notes,
    // A ordem é a do roteiro; o texto da pergunta vem sempre dele, mesmo que o Claude reescreva.
    qualification: q.map((e, i) => ({ ...e, question: input.questions[i] })),
    suggestions: {
      meeting_outcome: s.meeting_outcome && input.outcomes.includes(s.meeting_outcome) ? s.meeting_outcome : null,
      next_activity: s.next_activity && input.activityTypes.includes(s.next_activity.type) ? s.next_activity : null,
      stage: s.stage && input.stages.includes(s.stage) ? s.stage : null,
    },
  };
}

/** Gera as notas. Sem streaming; o chamador cuida das tentativas. */
export async function generateNotes(input: NotesInput, client?: Anthropic): Promise<MeetingNotes> {
  const { system, user } = buildNotesRequest(input);
  let response;
  try {
    response = await (client ?? new Anthropic()).beta.messages.parse({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system,
      messages: [{ role: "user", content: user }],
      output_config: { effort: "medium", format: zodOutputFormat(MeetingNotesSchema) },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });
  } catch (e) {
    throw new NotesError(`Falha ao chamar o Claude: ${e instanceof Error ? e.message : String(e)}`, { cause: e });
  }
  if (response.stop_reason === "refusal") throw new NotesError("O Claude recusou gerar as notas desta reunião.");
  if (!response.parsed_output) throw new NotesError("O Claude devolveu uma resposta fora do formato esperado.");
  return validate(response.parsed_output, input);
}
