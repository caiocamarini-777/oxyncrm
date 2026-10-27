import { describe, expect, it } from "vitest";
import { pdTimeToIso, stageHistory } from "./stage-history";

describe("stageHistory", () => {
  it("entrada inicial e uma linha por mudança, em ordem, com o tempo na etapa anterior", () => {
    const moves = stageHistory("2025-10-01 12:00:00", "11", [
      { from: "8", to: "11", at: "2026-01-16 16:15:13" },
      { from: "6", to: "7", at: "2025-10-02 12:00:00" },
      { from: "7", to: "8", at: "2025-10-03 12:00:00" },
    ]);
    expect(moves).toEqual([
      { from: null, to: "6", at: "2025-10-01T12:00:00.000Z", secondsInPrevious: null },
      { from: "6", to: "7", at: "2025-10-02T12:00:00.000Z", secondsInPrevious: 86400 },
      { from: "7", to: "8", at: "2025-10-03T12:00:00.000Z", secondsInPrevious: 86400 },
      { from: "8", to: "11", at: "2026-01-16T16:15:13.000Z", secondsInPrevious: 9087313 },
    ]);
  });
  it("sem mudanças: só a etapa atual na criação", () => {
    expect(stageHistory("2026-03-01 00:00:00", "5", [])).toEqual([
      { from: null, to: "5", at: "2026-03-01T00:00:00.000Z", secondsInPrevious: null },
    ]);
  });
  it("mudança registrada antes da criação não fica negativa", () => {
    expect(stageHistory("2026-03-02 00:00:00", "2", [{ from: "1", to: "2", at: "2026-03-01 00:00:00" }])[1]!.secondsInPrevious).toBe(0);
  });
  it("pdTimeToIso aceita os dois formatos", () => {
    expect(pdTimeToIso("2026-01-16 16:15:13")).toBe("2026-01-16T16:15:13.000Z");
    expect(pdTimeToIso("2026-01-16T16:15:13Z")).toBe("2026-01-16T16:15:13.000Z");
  });
});
