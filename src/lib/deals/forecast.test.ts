import { describe, expect, it } from "vitest";
import { forecastBuckets } from "./forecast";

const now = new Date("2026-10-22T12:00:00Z");
const d = (id: string, date: string | null, value: number, probability: number, status = "open") => ({
  id, status, expectedCloseDate: date, value, probability,
});

describe("forecastBuckets", () => {
  const b = forecastBuckets(
    [
      d("1", "2026-09-30", 100, 50), // atrasado
      d("2", "2026-10-05", 200, 25), // mês atual
      d("3", "2026-12-15", 1000, 10),
      d("4", null, 400, 75),
      d("5", "2026-11-01", 300, 100, "won"), // fechado fica de fora
      d("6", "2028-01-01", 999, 10), // além da janela
    ],
    now,
  );
  it("colunas: atrasados, 6 meses, sem data", () => {
    expect(b.map((x) => x.key)).toEqual([
      "overdue", "2026-10", "2026-11", "2026-12", "2027-01", "2027-02", "2027-03", "none",
    ]);
    expect(b[0].label).toBe("Atrasados");
    expect(b[7].label).toBe("Sem data");
  });
  it("conta, soma e pondera", () => {
    expect(b[0]).toMatchObject({ count: 1, total: 100, weighted: 50 });
    expect(b[1]).toMatchObject({ count: 1, total: 200, weighted: 50 });
    expect(b[2]).toMatchObject({ count: 0, total: 0, weighted: 0 });
    expect(b[3]).toMatchObject({ count: 1, total: 1000, weighted: 100 });
    expect(b[7]).toMatchObject({ count: 1, total: 400, weighted: 300 });
  });
});
