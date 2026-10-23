import { describe, expect, test } from "vitest";
import {
  activityChannelSchema,
  activityOutcomeSchema,
  activityTypeSchema,
  leadRuleSchema,
} from "./settings-schema";

describe("activityTypeSchema", () => {
  test("aceita nome e reunião", () => {
    expect(activityTypeSchema.parse({ name: " Visita ", isMeeting: true })).toEqual({ name: "Visita", isMeeting: true });
  });
  test("recusa nome vazio e acima de 40", () => {
    expect(activityTypeSchema.safeParse({ name: " ", isMeeting: false }).success).toBe(false);
    expect(activityTypeSchema.safeParse({ name: "x".repeat(41), isMeeting: false }).success).toBe(false);
  });
});

describe("activityChannelSchema", () => {
  test("aceita até 40 caracteres", () => {
    expect(activityChannelSchema.safeParse({ name: "Indicação" }).success).toBe(true);
    expect(activityChannelSchema.safeParse({ name: "x".repeat(41) }).success).toBe(false);
  });
});

describe("activityOutcomeSchema", () => {
  test("classificação válida", () => {
    expect(activityOutcomeSchema.safeParse({ name: "Talvez", classification: "neutral", booksMeeting: false }).success).toBe(true);
  });
  test("recusa classificação desconhecida e nome longo", () => {
    expect(activityOutcomeSchema.safeParse({ name: "A", classification: "x", booksMeeting: false }).success).toBe(false);
    expect(activityOutcomeSchema.safeParse({ name: "x".repeat(61), classification: "success", booksMeeting: false }).success).toBe(false);
  });
});

describe("patch parcial de resultado", () => {
  const patch = activityOutcomeSchema.pick({ classification: true, booksMeeting: true }).partial();
  test("aceita parcial e recusa classificação inválida", () => {
    expect(patch.safeParse({ booksMeeting: true }).success).toBe(true);
    expect(patch.safeParse({ classification: "x" }).success).toBe(false);
  });
});

describe("leadRuleSchema", () => {
  test("off, suggest, require", () => {
    for (const r of ["off", "suggest", "require"]) expect(leadRuleSchema.safeParse(r).success).toBe(true);
    expect(leadRuleSchema.safeParse("always").success).toBe(false);
  });
});
