import { describe, expect, it } from "vitest";
import { goalValueType } from "./goal-progress";

describe("goalValueType", () => {
  it("moeda para valor e MRR ganhos, número para o resto", () => {
    expect(goalValueType("won_value")).toBe("currency");
    expect(goalValueType("won_mrr")).toBe("currency");
    expect(goalValueType("meetings_held")).toBe("number");
    expect(goalValueType("")).toBe("number");
  });
});
