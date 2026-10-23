import { describe, expect, it } from "vitest";
import { goalSchema, isAlignedStart } from "./goals";

const U = "00000000-0000-4000-8000-000000000001";
const base = { companyId: U, targetKind: "company", metric: "won_value", period: "month", startsOn: "2026-10-01", targetValue: 100 };

describe("isAlignedStart", () => {
  it("semana começa na segunda", () => {
    expect(isAlignedStart("week", "2026-10-26")).toBe(true);
    expect(isAlignedStart("week", "2026-10-27")).toBe(false);
  });
  it("mês começa no dia 1", () => {
    expect(isAlignedStart("month", "2026-11-01")).toBe(true);
    expect(isAlignedStart("month", "2026-11-02")).toBe(false);
  });
  it("trimestre começa em jan, abr, jul ou out", () => {
    expect(isAlignedStart("quarter", "2026-10-01")).toBe(true);
    expect(isAlignedStart("quarter", "2026-04-01")).toBe(true);
    expect(isAlignedStart("quarter", "2026-05-01")).toBe(false);
    expect(isAlignedStart("quarter", "2026-10-02")).toBe(false);
  });
  it("data inválida", () => {
    expect(isAlignedStart("month", "2026-02-31")).toBe(false);
    expect(isAlignedStart("month", "x")).toBe(false);
  });
});

describe("goalSchema", () => {
  it("aceita meta alinhada", () => {
    expect(goalSchema.safeParse(base).success).toBe(true);
    expect(goalSchema.safeParse({ ...base, targetKind: "user", targetUserId: U }).success).toBe(true);
    expect(goalSchema.safeParse({ ...base, targetKind: "team", targetTeamId: U, period: "week", startsOn: "2026-10-26" }).success).toBe(true);
  });
  it("rejeita início desalinhado, alvo inconsistente e valor não positivo", () => {
    expect(goalSchema.safeParse({ ...base, startsOn: "2026-10-02" }).success).toBe(false);
    expect(goalSchema.safeParse({ ...base, targetKind: "user" }).success).toBe(false);
    expect(goalSchema.safeParse({ ...base, targetKind: "team", targetUserId: U }).success).toBe(false);
    expect(goalSchema.safeParse({ ...base, targetUserId: U }).success).toBe(false);
    expect(goalSchema.safeParse({ ...base, targetValue: 0 }).success).toBe(false);
    expect(goalSchema.safeParse({ ...base, metric: "x" }).success).toBe(false);
  });
});
