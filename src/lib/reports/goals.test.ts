import { describe, expect, it } from "vitest";
import { alignStart, goalSchema, isAlignedStart, parseTargetValue } from "./goals";

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

describe("alignStart", () => {
  it("quinta 2026-10-22", () => {
    expect(alignStart("2026-10-22", "week")).toBe("2026-10-19");
    expect(alignStart("2026-10-22", "month")).toBe("2026-10-01");
    expect(alignStart("2026-10-22", "quarter")).toBe("2026-10-01");
  });
  it("segunda e domingo na semana", () => {
    expect(alignStart("2026-10-19", "week")).toBe("2026-10-19");
    expect(alignStart("2026-10-25", "week")).toBe("2026-10-19");
  });
  it("trimestres", () => {
    expect(alignStart("2026-02-15", "quarter")).toBe("2026-01-01");
    expect(alignStart("2026-05-31", "quarter")).toBe("2026-04-01");
    expect(alignStart("2026-09-30", "quarter")).toBe("2026-07-01");
  });
  it("cruza o ano na semana e é consistente com isAlignedStart", () => {
    expect(alignStart("2027-01-01", "week")).toBe("2026-12-28");
    for (const p of ["week", "month", "quarter"] as const) expect(isAlignedStart(p, alignStart("2026-03-17", p))).toBe(true);
  });
  it("data inválida volta como veio", () => {
    expect(alignStart("x", "month")).toBe("x");
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

describe("parseTargetValue", () => {
  it("entende pt-BR", () => {
    expect(parseTargetValue("10.000")).toBe(10000);
    expect(parseTargetValue("1.500,50")).toBe(1500.5);
    expect(parseTargetValue("10000")).toBe(10000);
    expect(parseTargetValue("2,5")).toBe(2.5);
  });
  it("vazio e lixo viram NaN", () => {
    expect(parseTargetValue("")).toBeNaN();
    expect(parseTargetValue("abc")).toBeNaN();
  });
});
