import { describe, expect, it } from "vitest";
import type { MeetingNotes } from "./notes";
import { renderNoteHtml } from "./note-html";

const base: MeetingNotes = {
  summary: "Reunião de apresentação.",
  pains: [],
  objections: [],
  qualification: [],
  next_steps: [],
  suggestions: { meeting_outcome: null, next_activity: null, stage: null },
};
const meta = { startedAt: "2026-11-05T17:30:00Z", ownerName: "Caio", mappedUser: true };

describe("renderNoteHtml", () => {
  it("escapa HTML no resumo", () => {
    const html = renderNoteHtml({ ...base, summary: "<script>alert(1)</script> & cia" }, meta);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt; &amp; cia");
  });

  it("omite seções vazias e lista as preenchidas", () => {
    const html = renderNoteHtml({ ...base, pains: ["Retrabalho", "Sem <b>visão</b>"] }, meta);
    expect(html).toContain("<b>Resumo</b>");
    expect(html).toContain("<b>Dores</b>");
    expect(html).toContain("<ul><li>Retrabalho</li><li>Sem &lt;b&gt;visão&lt;/b&gt;</li></ul>");
    expect(html).not.toContain("Objeções");
    expect(html).not.toContain("Qualificação");
    expect(html).not.toContain("Próximos passos");
  });

  it("renderiza qualificação e próximos passos", () => {
    const html = renderNoteHtml(
      {
        ...base,
        qualification: [{ question: "Orçamento", answer: "R$ 10 mil" }],
        next_steps: [
          { what: "Enviar proposta", owner: "Caio", due: "12/11" },
          { what: "Validar com diretoria", owner: "Ana", due: null },
        ],
      },
      meta,
    );
    expect(html).toContain("<li><b>Orçamento:</b> R$ 10 mil</li>");
    expect(html).toContain("<li>Enviar proposta (Caio, até 12/11)</li>");
    expect(html).toContain("<li>Validar com diretoria (Ana)</li>");
  });

  it("rodapé no horário de São Paulo", () => {
    const html = renderNoteHtml(base, meta);
    expect(html).toContain("<i>Gerada pelo assistente a partir da reunião de 05/11 14:30</i>");
    expect(html).not.toContain("vendedor:");
  });

  it("cita o vendedor no rodapé quando não há usuário mapeado", () => {
    const html = renderNoteHtml(base, { ...meta, mappedUser: false, ownerName: "Caio <x>" });
    expect(html).toContain("a partir da reunião de 05/11 14:30 (vendedor: Caio &lt;x&gt;)</i>");
  });
});
