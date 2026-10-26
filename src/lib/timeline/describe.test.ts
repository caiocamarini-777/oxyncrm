import { describe, expect, it } from "vitest";
import { describeEvent } from "./describe";

const ev = (kind: string, entity: string, data: Record<string, unknown> | null = null) => ({ kind, entity, data });

describe("describeEvent (negócios)", () => {
  it("mudança de etapa", () => {
    expect(describeEvent(ev("stage_changed", "deals", { from: "s1", to: "s2" }), { s1: "Reunião", s2: "Proposta" })).toBe(
      "Moveu de Reunião para Proposta",
    );
  });
  it("status do negócio", () => {
    expect(describeEvent(ev("status_changed", "deals", { to: "won" }), {})).toBe("Marcou como ganho");
    expect(describeEvent(ev("status_changed", "deals", { to: "lost", reason_id: "r1" }), { r1: "Preço" })).toBe(
      "Marcou como perdido (Preço)",
    );
    expect(describeEvent(ev("status_changed", "deals", { to: "lost" }), {})).toBe("Marcou como perdido");
    expect(describeEvent(ev("status_changed", "deals", { from: "won", to: "open" }), {})).toBe("Reabriu o negócio");
  });
  it("status de lead segue igual", () => {
    expect(describeEvent(ev("status_changed", "leads", { to: "disqualified", reason_id: "r1" }), { r1: "Sem perfil" })).toBe(
      "Mudou o status para Desqualificado (Sem perfil)",
    );
  });
  it("conversão do lead", () => {
    expect(describeEvent(ev("converted", "leads", { deal_id: "d" }), {})).toBe("Converteu em negócio");
  });
  it("campos editados do negócio", () => {
    expect(
      describeEvent(ev("updated", "deals", { fields: ["expected_close_date", "lost_note", "mrr", "mrr_start"] }), {}),
    ).toBe("Editou data de fechamento, nota de perda, MRR e início do MRR");
  });
});

describe("describeEvent (atividades)", () => {
  const d = { activity_id: "a1", type: "Ligação", due_at: "2026-10-24T02:30:00Z" };
  it("agendamento", () => {
    expect(describeEvent(ev("activity_scheduled", "leads", d), { a1: "Falar com a Ana" })).toBe(
      "Agendou Ligação: Falar com a Ana para 23/10, 23:30",
    );
    expect(describeEvent(ev("activity_scheduled", "leads", d), {})).toBe("Agendou Ligação: atividade para 23/10, 23:30");
  });
  it("conclusão com resultado", () => {
    expect(
      describeEvent(ev("activity_completed", "deals", { activity_id: "a1", outcome: "Sem resposta" }), {
        a1: "Retorno",
        "type:a1": "Ligação",
      }),
    ).toBe("Concluiu Ligação: Retorno (Sem resposta)");
  });
  it("conclusão de reunião", () => {
    const m = (mo: string) =>
      describeEvent(ev("activity_completed", "deals", { activity_id: "a1", outcome: null, meeting_outcome: mo }), { a1: "Demo", "type:a1": "Reunião" });
    expect(m("held")).toBe("Concluiu Reunião: Demo (Realizada)");
    expect(m("no_show")).toBe("Concluiu Reunião: Demo (No-show)");
    expect(m("rescheduled")).toBe("Concluiu Reunião: Demo (Remarcada)");
    expect(m("canceled")).toBe("Concluiu Reunião: Demo (Cancelada)");
  });
});
