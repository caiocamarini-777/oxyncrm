import { describe, expect, it } from "vitest";
import { scaledRetention } from "./retention";

describe("scaledRetention", () => {
  it("mantém a alíquota efetiva", () => {
    expect(scaledRetention(2000, 1000, 100)).toBe(200);
    expect(scaledRetention(500, 1000, 100)).toBe(50);
  });
  it("arredonda a 2 casas", () => {
    expect(scaledRetention(333.33, 1000, 51)).toBe(17);
    expect(scaledRetention(100, 3, 1)).toBe(33.33);
  });
  it("bruto antigo 0 ou sem retenção dá 0", () => {
    expect(scaledRetention(100, 0, 0)).toBe(0);
    expect(scaledRetention(100, 1000, 0)).toBe(0);
  });
  it("bruto 0 zera a retenção e nunca passa do bruto", () => {
    expect(scaledRetention(0, 1000, 100)).toBe(0);
    expect(scaledRetention(10, 10, 10)).toBe(10);
  });
});
