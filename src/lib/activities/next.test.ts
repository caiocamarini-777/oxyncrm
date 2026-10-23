import { describe, expect, it } from "vitest";
import { toNextActivity } from "./next";

// 2026-10-23 15:00 em São Paulo
const now = new Date("2026-10-23T18:00:00Z");
const row = (dueAt: string) => ({ activityId: "a1", dueAt, subject: "Ligar", overdue: false });

describe("toNextActivity", () => {
  it("atrasada quando o horário já passou", () => {
    const n = toNextActivity(row("2026-10-23T17:59:00Z"), now);
    expect(n).toMatchObject({ status: "overdue", label: "Atrasada", subject: "Ligar" });
  });
  it("hoje, ainda por vir", () => {
    expect(toNextActivity(row("2026-10-23T22:00:00Z"), now)).toMatchObject({ status: "today", label: "Hoje" });
  });
  it("amanhã", () => {
    expect(toNextActivity(row("2026-10-24T13:00:00Z"), now)).toMatchObject({ status: "upcoming", label: "Amanhã" });
  });
  it("data curta nos demais casos", () => {
    expect(toNextActivity(row("2026-10-30T13:00:00Z"), now)).toMatchObject({ status: "upcoming", label: "30/10" });
  });
  it("usa o fuso de São Paulo na virada do dia", () => {
    // 01:30 UTC de 24/10 ainda é 22:30 de 23/10 em São Paulo
    expect(toNextActivity(row("2026-10-24T01:30:00Z"), now).label).toBe("Hoje");
  });
});
