import { describe, expect, it } from "vitest";
import { REMINDER_OPTIONS } from "./reminders";
import { activitySchema, completeSchema } from "./schema";

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const msg = (r: { success: boolean; error?: { issues: { message: string }[] } }) => r.error?.issues[0].message;
const base = { typeId: U(1), channelId: U(2), subject: "Ligar", dueAt: "2026-10-23T23:30", leadId: U(3) };

describe("REMINDER_OPTIONS", () => {
  it("opções em minutos", () => {
    expect(REMINDER_OPTIONS.map((o) => o.label)).toEqual([
      "Sem lembrete",
      "Na hora",
      "15 minutos antes",
      "30 minutos antes",
      "1 hora antes",
      "1 dia antes",
    ]);
    expect(REMINDER_OPTIONS.map((o) => o.minutes)).toEqual([null, 0, 15, 30, 60, 1440]);
  });
});

describe("activitySchema", () => {
  it("converte data local para UTC e aplica padrões", () => {
    const ok = activitySchema.parse(base);
    expect(ok.dueAt).toBe("2026-10-24T02:30:00.000Z");
    expect(ok.durationMinutes).toBe(30);
    expect(ok.reminderMinutes).toBeNull();
    expect(ok.dealId).toBeNull();
  });
  it("exige vínculo", () => {
    const { leadId: _l, ...rest } = base;
    void _l;
    expect(msg(activitySchema.safeParse(rest))).toBe("Vincule a atividade a um lead, negócio, pessoa ou organização.");
  });
  it("assunto de 1 a 200", () => {
    expect(msg(activitySchema.safeParse({ ...base, subject: " " }))).toBe("Informe o assunto.");
    expect(activitySchema.safeParse({ ...base, subject: "a".repeat(201) }).success).toBe(false);
  });
  it("data inválida e lembrete fora das opções", () => {
    expect(msg(activitySchema.safeParse({ ...base, dueAt: "2026-10-23" }))).toBe("Informe a data e a hora.");
    expect(activitySchema.safeParse({ ...base, reminderMinutes: 7 }).success).toBe(false);
    expect(activitySchema.parse({ ...base, reminderMinutes: 60 }).reminderMinutes).toBe(60);
  });
  it("duração limitada a um dia", () => {
    expect(activitySchema.safeParse({ ...base, durationMinutes: 1441 }).success).toBe(false);
  });
});

describe("completeSchema", () => {
  it("atividade comum exige resultado", () => {
    expect(msg(completeSchema.safeParse({ isMeeting: false }))).toBe("Informe o resultado da atividade.");
    expect(completeSchema.safeParse({ isMeeting: false, outcomeId: U(9) }).success).toBe(true);
  });
  it("reunião exige resultado da reunião", () => {
    expect(msg(completeSchema.safeParse({ isMeeting: true, outcomeId: U(9) }))).toBe("Informe o resultado da reunião.");
    expect(completeSchema.safeParse({ isMeeting: true, meetingOutcome: "held" }).success).toBe(true);
    expect(completeSchema.safeParse({ isMeeting: true, meetingOutcome: "nope" }).success).toBe(false);
  });
  it("reunião realizada aceita resultado de qualificação; as demais não", () => {
    expect(completeSchema.safeParse({ isMeeting: true, meetingOutcome: "held", outcomeId: U(9) }).success).toBe(true);
    expect(msg(completeSchema.safeParse({ isMeeting: true, meetingOutcome: "no_show", outcomeId: U(9) }))).toBe(
      "O resultado só vale para reunião realizada.",
    );
  });
  it("nota até 2.000", () => {
    expect(completeSchema.safeParse({ isMeeting: false, outcomeId: U(9), note: "a".repeat(2001) }).success).toBe(false);
  });
  it("próxima e reunião seguem o schema da atividade", () => {
    const ok = completeSchema.parse({
      isMeeting: false,
      outcomeId: U(9),
      next: { typeId: U(1), channelId: U(2), subject: "Retornar", dueAt: "2026-10-25T10:00" },
      meeting: { subject: "Demo", dueAt: "2026-10-26T10:00" },
    });
    expect(ok.next?.dueAt).toBe("2026-10-25T13:00:00.000Z");
    expect(ok.next?.ownerId).toBeUndefined();
    expect(ok.meeting?.dueAt).toBe("2026-10-26T13:00:00.000Z");
    expect(completeSchema.safeParse({ isMeeting: false, outcomeId: U(9), next: { subject: "" } }).success).toBe(false);
  });
});
