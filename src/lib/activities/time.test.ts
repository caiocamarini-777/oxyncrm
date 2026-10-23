import { describe, expect, it } from "vitest";
import { dayKey, dueStatus, formatDue, formatDateTime, monthGrid, toLocalInput, toUtc, weekGrid } from "./time";

describe("toUtc / toLocalInput", () => {
  it("converte de São Paulo para UTC e volta", () => {
    expect(toUtc("2026-10-23T23:30")).toBe("2026-10-24T02:30:00.000Z");
    expect(toLocalInput("2026-10-24T02:30:00Z")).toBe("2026-10-23T23:30");
    expect(toLocalInput(toUtc("2026-01-05T08:05"))).toBe("2026-01-05T08:05");
  });
  it("rejeita formato inválido", () => {
    expect(() => toUtc("23/10/2026 10:00")).toThrow();
  });
  it("rejeita datas impossíveis", () => {
    expect(() => toUtc("2026-02-31T10:00")).toThrow();
    expect(() => toUtc("2026-10-23T25:00")).toThrow();
  });
});

describe("dayKey", () => {
  it("usa o dia de São Paulo", () => {
    expect(dayKey("2026-10-24T02:30:00Z")).toBe("2026-10-23");
    expect(dayKey("2026-10-24T03:00:00Z")).toBe("2026-10-24");
  });
});

describe("dueStatus", () => {
  // 02:00 UTC de 24/10 = 23:00 de 23/10 em São Paulo
  const now = new Date("2026-10-24T02:00:00Z");
  it("23h30 de hoje em São Paulo continua hoje", () => {
    expect(dueStatus("2026-10-24T02:30:00Z", false, now)).toBe("today");
  });
  it("23h30 de ontem em São Paulo está atrasada", () => {
    expect(dueStatus("2026-10-23T02:30:00Z", false, now)).toBe("overdue");
  });
  it("amanhã e concluída", () => {
    expect(dueStatus("2026-10-24T12:00:00Z", false, now)).toBe("upcoming");
    expect(dueStatus("2026-10-23T02:30:00Z", true, now)).toBe("done");
  });
  it("hoje mas já passou da hora está atrasada", () => {
    expect(dueStatus("2026-10-23T15:00:00Z", false, now)).toBe("overdue");
  });
});

describe("weekGrid / monthGrid", () => {
  it("semana de segunda a domingo", () => {
    const w = weekGrid("2026-10-24"); // sábado
    expect(w).toHaveLength(7);
    expect(w[0]).toBe("2026-10-19");
    expect(w[6]).toBe("2026-10-25");
  });
  it("domingo fecha a semana", () => {
    expect(weekGrid("2026-10-25")[0]).toBe("2026-10-19");
    expect(weekGrid("2026-10-26")[0]).toBe("2026-10-26");
  });
  it("outubro de 2026 tem 5 semanas completas", () => {
    const m = monthGrid("2026-10-15");
    expect(m).toHaveLength(5);
    expect(m.every((w) => w.length === 7)).toBe(true);
    expect(m[0][0]).toBe("2026-09-28");
    expect(m[4][6]).toBe("2026-11-01");
  });
  it("fevereiro de 2027 começa na segunda e tem 4 semanas", () => {
    expect(monthGrid("2027-02-10")).toHaveLength(4);
  });
});

describe("formatDue", () => {
  const now = new Date("2026-10-22T15:00:00Z"); // 12:00 de 22/10 (quinta) em SP
  it("hoje", () => expect(formatDue("2026-10-22T17:30:00Z", now)).toBe("Hoje, 14:30"));
  it("amanhã", () => expect(formatDue("2026-10-23T12:00:00Z", now)).toBe("Amanhã, 09:00"));
  it("outro dia", () => expect(formatDue("2026-10-28T13:00:00Z", now)).toBe("qua., 28/10, 10:00"));
  it("atrasada", () => {
    expect(formatDue("2026-10-20T15:00:00Z", now)).toBe("Atrasada há 2 dias");
    expect(formatDue("2026-10-21T15:00:00Z", now)).toBe("Atrasada há 1 dia");
  });
  it("hoje já passou da hora mostra Hoje", () => {
    expect(formatDue("2026-10-22T12:00:00Z", now)).toBe("Hoje, 09:00");
  });
});

describe("formatDateTime", () => {
  it("dd/MM às HH:mm em São Paulo", () => {
    expect(formatDateTime("2026-10-24T02:30:00Z")).toBe("23/10, 23:30");
  });
});
