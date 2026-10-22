import { describe, expect, it } from "vitest";
import { pipelineSchema, stageSchemaFor } from "./schema";

const stage = (over: Record<string, unknown> = {}) => ({ name: "Proposta", probability: 50, rottingDays: "", requiredFields: [], ...over });

describe("stageSchema", () => {
  const schema = stageSchemaFor(["porte"]);
  it("rejeita probabilidade 101 e não inteira", () => {
    expect(schema.safeParse(stage({ probability: 101 })).success).toBe(false);
    expect(schema.safeParse(stage({ probability: -1 })).success).toBe(false);
    expect(schema.safeParse(stage({ probability: 10.5 })).success).toBe(false);
    expect(schema.safeParse(stage({ probability: 100 })).success).toBe(true);
  });
  it("rejeita cf: inexistente e aceita ativo", () => {
    expect(schema.safeParse(stage({ requiredFields: ["cf:Inexistente"] })).success).toBe(false);
    expect(schema.safeParse(stage({ requiredFields: ["cf:outro"] })).success).toBe(false);
    expect(schema.parse(stage({ requiredFields: ["cf:porte", "person_id"] })).requiredFields).toEqual(["cf:porte", "person_id"]);
    expect(schema.safeParse(stage({ requiredFields: ["foo"] })).success).toBe(false);
  });
  it("dias para esfriar vazio ou 1 a 365", () => {
    expect(schema.parse(stage()).rottingDays).toBeNull();
    expect(schema.parse(stage({ rottingDays: "30" })).rottingDays).toBe(30);
    expect(schema.safeParse(stage({ rottingDays: "0" })).success).toBe(false);
    expect(schema.safeParse(stage({ rottingDays: "366" })).success).toBe(false);
  });
  it("nome de 1 a 60", () => {
    expect(schema.safeParse(stage({ name: " " })).success).toBe(false);
    expect(schema.safeParse(stage({ name: "a".repeat(61) })).success).toBe(false);
  });
});

describe("pipelineSchema", () => {
  it("valida nome e enums", () => {
    const ok = { name: "Funil", nextActivityRule: "off", cardValueField: "total" };
    expect(pipelineSchema.safeParse(ok).success).toBe(true);
    expect(pipelineSchema.safeParse({ ...ok, name: "a".repeat(81) }).success).toBe(false);
    expect(pipelineSchema.safeParse({ ...ok, nextActivityRule: "x" }).success).toBe(false);
    expect(pipelineSchema.safeParse({ ...ok, cardValueField: "x" }).success).toBe(false);
  });
});
