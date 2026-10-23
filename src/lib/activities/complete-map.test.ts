import { describe, expect, it } from "vitest";
import { completeFailure } from "./complete-map";

describe("completeFailure", () => {
  it("próxima atividade exigida", () => {
    expect(completeFailure({ message: "OXYN_NEXT_ACTIVITY_REQUIRED" })).toEqual({
      ok: false,
      error: "Agende a próxima atividade para concluir.",
      code: "next_required",
      rule: "require",
    });
  });
  it("reunião e resultado exigidos", () => {
    expect(completeFailure({ message: "x OXYN_MEETING_REQUIRED" })).toMatchObject({ code: "meeting_required" });
    expect(completeFailure({ message: "OXYN_OUTCOME_REQUIRED" })).toMatchObject({ code: "outcome_required" });
    expect(completeFailure({ message: "OXYN_MEETING_REQUIRED" })).not.toHaveProperty("rule");
  });
  it("outros erros não têm código", () => {
    const r = completeFailure({ message: "OXYN_ALREADY_DONE" });
    expect(r.error).toBe("Esta atividade já foi concluída.");
    expect(r).not.toHaveProperty("code");
  });
});
