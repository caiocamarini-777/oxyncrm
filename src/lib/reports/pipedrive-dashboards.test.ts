import { describe, expect, it } from "vitest";
import { MISSING, buildCatalog, type Refs } from "./pipedrive-dashboards";
import { reportSpecSchema } from "./spec";

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const full: Refs = {
  source: (n) => (n.startsWith("Fórum") ? U(1) : n === "Jitterbit" ? U(2) : U(3)),
  outcome: () => U(4),
  meetingType: () => U(5),
  pipeline: () => U(6),
  user: () => U(7),
};
const empty: Refs = { source: () => null, outcome: () => null, meetingType: () => null, pipeline: () => null, user: () => null };

describe("catálogo dos painéis do Pipedrive", () => {
  it("dois painéis com 34 e 15 widgets", () => {
    const [kpis, dir] = buildCatalog("HARPIX", full);
    expect(kpis!.name).toBe("KPIs - HARPIX");
    expect(kpis!.widgets).toHaveLength(34);
    expect(dir!.name).toBe("HARPIX - Resultados diretoria");
    expect(dir!.widgets).toHaveLength(15);
  });
  it("toda spec é válida, com e sem as referências da empresa", () => {
    for (const refs of [full, empty]) {
      for (const d of buildCatalog("NAIA", refs)) {
        for (const w of d.widgets) {
          const r = reportSpecSchema.safeParse(w.spec);
          expect(r.success, `${w.title}: ${r.success ? "" : r.error.issues[0]?.message}`).toBe(true);
        }
      }
    }
  });
  it("referência ausente vira id inexistente, e o 'não é Fórum' some", () => {
    const [kpis] = buildCatalog("NAIA", empty);
    const abertos = kpis!.widgets[0]!.spec;
    expect(JSON.stringify(abertos)).not.toContain("not_in");
    expect(JSON.stringify(kpis!.widgets.find((w) => w.title.includes("Números de qualificados"))!.spec)).toContain(MISSING);
  });
  it("linhas de 4 colunas: cada linha soma no máximo 4", () => {
    for (const d of buildCatalog("X", full)) {
      let row = 0;
      for (const w of d.widgets) {
        if (row + w.colSpan > 4) row = 0;
        row += w.colSpan;
        expect(row).toBeLessThanOrEqual(4);
      }
    }
  });
});
