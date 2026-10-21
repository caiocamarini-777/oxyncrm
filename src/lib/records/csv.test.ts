import { describe, expect, it } from "vitest";
import { toCsv } from "./csv";

describe("toCsv", () => {
  it("começa com BOM, usa ; e escapa aspas", () => {
    const out = toCsv(
      [
        { key: "name", header: "Nome" },
        { key: "note", header: "Obs" },
      ],
      [{ name: 'Ana "Tita"', note: "a;b" }],
    );
    expect(out.startsWith("﻿")).toBe(true);
    expect(out).toContain("Nome;Obs");
    expect(out).toContain('"Ana ""Tita""";"a;b"');
  });
  it("null e undefined viram vazio; quebra de linha é citada", () => {
    const out = toCsv([{ key: "a", header: "A" }, { key: "b", header: "B" }], [{ a: null, b: "x\ny" }]);
    expect(out).toContain('\r\n;"x\ny"');
  });
});
