import { describe, expect, it } from "vitest";
import { disqualifySchema, leadSchema, leadAgeLabel } from "./schema";

describe("disqualifySchema", () => {
  it("exige motivo", () => {
    const r = disqualifySchema.safeParse({ note: "x" });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0].message).toBe("Escolha um motivo.");
    expect(disqualifySchema.safeParse({ reasonId: "" }).success).toBe(false);
  });
  it("aceita motivo e limita a observação", () => {
    const id = "11111111-1111-4111-8111-111111111111";
    expect(disqualifySchema.parse({ reasonId: id }).note).toBeNull();
    expect(disqualifySchema.safeParse({ reasonId: id, note: "a".repeat(1001) }).success).toBe(false);
  });
});

describe("leadSchema", () => {
  it("valida o título", () => {
    expect(leadSchema.safeParse({ title: " " }).success).toBe(false);
    expect(leadSchema.safeParse({ title: "a".repeat(201) }).success).toBe(false);
    expect(leadSchema.parse({ title: "Lead" }).estimatedValue).toBeNull();
  });
  it("rejeita valor com 3 casas ou negativo", () => {
    expect(leadSchema.safeParse({ title: "L", estimatedValue: 10.123 }).success).toBe(false);
    expect(leadSchema.safeParse({ title: "L", estimatedValue: -1 }).success).toBe(false);
    expect(leadSchema.parse({ title: "L", estimatedValue: 10.5 }).estimatedValue).toBe(10.5);
    expect(leadSchema.parse({ title: "L", estimatedValue: "1500.25" }).estimatedValue).toBe(1500.25);
    expect(leadSchema.parse({ title: "L", estimatedValue: "1.500,25" }).estimatedValue).toBe(1500.25);
    expect(leadSchema.parse({ title: "L", estimatedValue: "1500,5" }).estimatedValue).toBe(1500.5);
    expect(leadSchema.parse({ title: "L", estimatedValue: "1.234.567,8" }).estimatedValue).toBe(1234567.8);
    expect(leadSchema.safeParse({ title: "L", estimatedValue: "1,5,5" }).success).toBe(false);
    expect(leadSchema.parse({ title: "L", estimatedValue: "" }).estimatedValue).toBeNull();
  });
});

describe("leadAgeLabel", () => {
  const now = new Date("2026-10-22T12:00:00-03:00");
  it("hoje, 1 dia, N dias", () => {
    expect(leadAgeLabel("2026-10-22T01:00:00-03:00", now)).toBe("hoje");
    expect(leadAgeLabel("2026-10-21T23:00:00-03:00", now)).toBe("1 dia");
    expect(leadAgeLabel("2026-10-12T08:00:00-03:00", now)).toBe("10 dias");
  });
});
