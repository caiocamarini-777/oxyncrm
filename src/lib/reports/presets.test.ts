import { describe, expect, it } from "vitest";
import { PRESETS, getPreset } from "./presets";
import { PRESET_KEYS, reportSpecSchema } from "./spec";

const U = "00000000-0000-4000-8000-000000000001";

describe("PRESETS", () => {
  it("toda chave está na lista aceita pelo schema, sem repetir", () => {
    const keys = PRESETS.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.sort()).toEqual([...PRESET_KEYS].sort());
    for (const p of PRESETS) {
      const params = Object.fromEntries(p.params.filter((x) => x.required).map((x) => [x.key, U]));
      expect(reportSpecSchema.safeParse({ kind: p.key, params }).success).toBe(true);
    }
  });
  it("stage_conversion exige o param pipeline", () => {
    const p = getPreset("stage_conversion")!;
    expect(p.params.find((x) => x.key === "pipeline")).toMatchObject({ required: true, type: "pipeline" });
    expect(reportSpecSchema.safeParse({ kind: "stage_conversion" }).success).toBe(false);
  });
  it("cada preset tem nome, descrição e gráfico padrão", () => {
    for (const p of PRESETS) {
      expect(p.name.length).toBeGreaterThan(0);
      expect(p.description.length).toBeGreaterThan(0);
      expect(["number", "bar", "line", "funnel", "pie", "table"]).toContain(p.chart);
    }
  });
});
