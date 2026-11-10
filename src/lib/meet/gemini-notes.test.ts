import { describe, expect, it } from "vitest";
import { MAX_SUMMARY_CHARS, notesEngineFromEnv, notesFromGemini } from "./gemini-notes";

const DOC = `Anotações da reunião: Apresentação Acme

Resumo
Caio apresentou a proposta. A Acme quer automatizar a cobrança e decide até dezembro.

Detalhes
* Orçamento: a Acme tem verba para o primeiro trimestre.
* Concorrência: avaliam também outra empresa.

Próximas etapas sugeridas
* [Caio Camarini] Enviar a proposta revisada.
* [Ana (Acme)] Validar com o financeiro.
* Agendar a próxima reunião.

Revise as anotações do Gemini para conferir se estão corretas.`;

describe("notesEngineFromEnv", () => {
  it("com a chave da Anthropic usa o Claude; sem ela, o Gemini", () => {
    expect(notesEngineFromEnv({ ANTHROPIC_API_KEY: "sk-ant-x" })).toBe("claude");
    expect(notesEngineFromEnv({})).toBe("gemini");
    expect(notesEngineFromEnv({ ANTHROPIC_API_KEY: "  " })).toBe("gemini");
  });
});

describe("notesFromGemini", () => {
  it("resumo é o texto antes das próximas etapas; as etapas viram próximos passos com responsável", () => {
    const n = notesFromGemini(DOC);
    expect(n.summary).toContain("Caio apresentou a proposta.");
    expect(n.summary).toContain("Orçamento: a Acme tem verba");
    expect(n.summary).not.toContain("Enviar a proposta revisada");
    expect(n.next_steps).toEqual([
      { what: "Enviar a proposta revisada.", owner: "Caio Camarini", due: null },
      { what: "Validar com o financeiro.", owner: "Ana (Acme)", due: null },
      { what: "Agendar a próxima reunião.", owner: "", due: null },
    ]);
  });

  it("não traz roteiro, dores, objeções nem sugestões", () => {
    const n = notesFromGemini(DOC);
    expect(n.qualification).toEqual([]);
    expect(n.pains).toEqual([]);
    expect(n.objections).toEqual([]);
    expect(n.suggestions).toEqual({ meeting_outcome: null, next_activity: null, stage: null });
  });

  it("para na seção seguinte às próximas etapas", () => {
    const n = notesFromGemini(DOC);
    expect(n.next_steps.some((s) => s.what.includes("Revise as anotações"))).toBe(false);
  });

  it("sem a seção de próximas etapas: tudo vira resumo", () => {
    const n = notesFromGemini("Resumo\nConversa rápida sobre preço.");
    expect(n.summary).toBe("Resumo\nConversa rápida sobre preço.");
    expect(n.next_steps).toEqual([]);
  });

  it("aceita outros títulos e marcadores (Next steps, '-', caixinha)", () => {
    const n = notesFromGemini("Texto\n\nNext steps\n- [ ] [Bia] Mandar contrato\n1. Ligar na sexta");
    expect(n.next_steps).toEqual([
      { what: "Mandar contrato", owner: "Bia", due: null },
      { what: "Ligar na sexta", owner: "", due: null },
    ]);
  });

  it("resumo cortado no limite e linhas em branco repetidas viram uma", () => {
    const n = notesFromGemini(`a\n\n\n\nb\n${"x".repeat(MAX_SUMMARY_CHARS + 50)}`);
    expect(n.summary.startsWith("a\n\nb\n")).toBe(true);
    expect(n.summary.length).toBe(MAX_SUMMARY_CHARS);
  });
});
