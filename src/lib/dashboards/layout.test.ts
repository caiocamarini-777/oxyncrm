import { describe, expect, it } from "vitest";
import { clampSpans, keyResize, snapSpan } from "./layout";

describe("snapSpan", () => {
  it("arredonda o deslocamento para células inteiras e respeita os limites", () => {
    expect(snapSpan(1, 0, 200, 1, 4)).toBe(1);
    expect(snapSpan(1, 190, 200, 1, 4)).toBe(2);
    expect(snapSpan(1, 80, 200, 1, 4)).toBe(1);
    expect(snapSpan(2, -250, 200, 1, 4)).toBe(1);
    expect(snapSpan(3, 900, 200, 1, 4)).toBe(4);
    expect(snapSpan(2, 100, 0, 1, 4)).toBe(2);
  });
});

describe("keyResize", () => {
  it("setas mudam largura e altura dentro dos limites", () => {
    expect(keyResize({ colSpan: 2, rowSpan: 1 }, "ArrowRight")).toEqual({ colSpan: 3, rowSpan: 1 });
    expect(keyResize({ colSpan: 4, rowSpan: 1 }, "ArrowRight")).toEqual({ colSpan: 4, rowSpan: 1 });
    expect(keyResize({ colSpan: 1, rowSpan: 1 }, "ArrowLeft")).toEqual({ colSpan: 1, rowSpan: 1 });
    expect(keyResize({ colSpan: 2, rowSpan: 1 }, "ArrowDown")).toEqual({ colSpan: 2, rowSpan: 2 });
    expect(keyResize({ colSpan: 2, rowSpan: 3 }, "ArrowDown")).toEqual({ colSpan: 2, rowSpan: 3 });
    expect(keyResize({ colSpan: 2, rowSpan: 2 }, "ArrowUp")).toEqual({ colSpan: 2, rowSpan: 1 });
    expect(keyResize({ colSpan: 2, rowSpan: 2 }, "Enter")).toBeNull();
  });
});

describe("clampSpans", () => {
  it("limita a 1-4 colunas e 1-3 linhas", () => {
    expect(clampSpans(9, 0)).toEqual({ colSpan: 4, rowSpan: 1 });
    expect(clampSpans(0, 9)).toEqual({ colSpan: 1, rowSpan: 3 });
  });
});
