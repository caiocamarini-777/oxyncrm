import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import { buildNotesRequest, generateNotes, type MeetingNotes, type NotesInput, NotesError } from "./notes";

const QUESTIONS = ["Dor principal", "Orçamento", "Decisor"];

const input: NotesInput = {
  transcript: "Vendedor: bom dia.\nCliente: nosso maior problema é o retrabalho.",
  questions: QUESTIONS,
  title: "Demo Oxyn",
  startedAt: "2026-11-05T15:00:00-03:00",
  participants: ["Ana <ana@cliente.com>", "Caio <caio@oxyn.com>"],
  record: {
    kind: "deal",
    name: "Cliente SA",
    stage: "Proposta",
    value: 12000,
    setup: 2000,
    mrr: 1000,
    recentNotes: ["Ligação de apresentação", "E-mail enviado"],
  },
  outcomes: ["Avançou", "Sem interesse"],
  activityTypes: ["Reunião", "Ligação"],
  stages: ["Proposta", "Negociação"],
};

const valid: MeetingNotes = {
  summary: "Reunião de demonstração.",
  pains: ["Retrabalho"],
  objections: [],
  qualification: QUESTIONS.map((question) => ({ question, answer: "Não mencionado" })),
  next_steps: [{ what: "Enviar proposta", owner: "Caio", due: "2026-11-07" }],
  suggestions: {
    meeting_outcome: "Avançou",
    next_activity: { type: "Ligação", subject: "Retorno da proposta", due_date: "2026-11-10", due_time: "10:00" },
    stage: "Negociação",
  },
};

/** Cliente falso: grava os argumentos de `beta.messages.parse` e devolve a resposta dada. */
function fakeClient(response: { parsed_output: unknown; stop_reason?: string }) {
  const parse = vi.fn().mockResolvedValue({ stop_reason: "end_turn", ...response });
  return { client: { beta: { messages: { parse } } } as unknown as Anthropic, parse };
}

describe("buildNotesRequest", () => {
  it("inclui cada pergunta do roteiro e cada opção permitida", () => {
    const { system, user } = buildNotesRequest(input);
    const all = `${system}\n${user}`;
    for (const q of QUESTIONS) expect(all).toContain(q);
    for (const o of input.outcomes) expect(all).toContain(o);
    for (const t of input.activityTypes) expect(all).toContain(t);
    for (const s of input.stages) expect(all).toContain(s);
  });

  it("mantém o system prompt estável (sem dados da reunião) e põe o variável no user", () => {
    const a = buildNotesRequest(input);
    const b = buildNotesRequest({ ...input, title: "Outra", transcript: "x", questions: ["Q"] });
    expect(a.system).toBe(b.system);
    expect(a.user).toContain("Demo Oxyn");
    expect(a.user).toContain("nosso maior problema é o retrabalho");
  });

  it("corta transcrições gigantes", () => {
    const { user } = buildNotesRequest({ ...input, transcript: "a".repeat(2_000_000) });
    expect(user.length).toBeLessThan(1_000_000);
  });
});

describe("generateNotes", () => {
  it("chama o modelo e os parâmetros combinados", async () => {
    const { client, parse } = fakeClient({ parsed_output: valid });
    await generateNotes(input, client);
    const args = parse.mock.calls[0][0];
    expect(args.model).toBe("claude-opus-5-5");
    expect(args.max_tokens).toBe(16000);
    expect(args.output_config.effort).toBe("medium");
    expect(args.output_config.format).toBeDefined();
    expect(args.betas).toEqual(["server-side-fallback-2026-07-01"]);
    expect(args.fallbacks).toBe("default");
    expect(args).not.toHaveProperty("thinking");
    expect(args).not.toHaveProperty("temperature");
    expect(args.messages).toEqual([{ role: "user", content: expect.stringContaining("Demo Oxyn") }]);
  });

  it("devolve um parsed_output válido tal qual", async () => {
    const { client } = fakeClient({ parsed_output: valid });
    expect(await generateNotes(input, client)).toEqual(valid);
  });

  it("lança NotesError quando a qualificação tem tamanho diferente do roteiro", async () => {
    const bad = { ...valid, qualification: valid.qualification.slice(0, 2) };
    const { client } = fakeClient({ parsed_output: bad });
    await expect(generateNotes(input, client)).rejects.toBeInstanceOf(NotesError);
  });

  it("mantém o texto das perguntas do roteiro mesmo que o Claude reescreva", async () => {
    const reworded = { ...valid, qualification: valid.qualification.map((e) => ({ ...e, question: `${e.question}?` })) };
    const { client } = fakeClient({ parsed_output: reworded });
    const out = await generateNotes(input, client);
    expect(out.qualification.map((e) => e.question)).toEqual(QUESTIONS);
  });

  it("zera o resultado, o tipo e a etapa que não estão nas listas permitidas", async () => {
    const odd: MeetingNotes = {
      ...valid,
      suggestions: {
        meeting_outcome: "Inventado",
        next_activity: { type: "Telepatia", subject: "x", due_date: "2026-11-10", due_time: null },
        stage: "Etapa fantasma",
      },
    };
    const { client } = fakeClient({ parsed_output: odd });
    const out = await generateNotes(input, client);
    expect(out.suggestions).toEqual({ meeting_outcome: null, next_activity: null, stage: null });
  });

  it("lança NotesError quando o Claude recusa", async () => {
    const { client } = fakeClient({ parsed_output: null, stop_reason: "refusal" });
    await expect(generateNotes(input, client)).rejects.toBeInstanceOf(NotesError);
  });

  it("lança NotesError quando parsed_output é nulo", async () => {
    const { client } = fakeClient({ parsed_output: null });
    await expect(generateNotes(input, client)).rejects.toBeInstanceOf(NotesError);
  });

  it("lança NotesError quando a chamada falha", async () => {
    const parse = vi.fn().mockRejectedValue(new Error("rede"));
    const client = { beta: { messages: { parse } } } as unknown as Anthropic;
    await expect(generateNotes(input, client)).rejects.toBeInstanceOf(NotesError);
  });
});
