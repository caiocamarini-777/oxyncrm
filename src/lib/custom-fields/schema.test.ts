import { describe, expect, test } from "vitest";
import {
  customFieldDefSchema,
  slugifyKey,
  validateCustomFieldValues,
  type CustomFieldDef,
} from "./schema";

const USER = "00000000-0000-4000-8000-0000000000c2";
const OTHER = "00000000-0000-4000-8000-0000000000c5";

const defs: CustomFieldDef[] = [
  { key: "porte", label: "Porte", type: "select", options: ["Pequeno", "Médio", "Grande"] },
  { key: "tags", label: "Tags", type: "multiselect", options: ["a", "b"] },
  { key: "qtd", label: "Quantidade", type: "number", options: [] },
  { key: "valor", label: "Valor", type: "money", options: [] },
  { key: "desde", label: "Desde", type: "date", options: [] },
  { key: "resp", label: "Responsável", type: "user", options: [] },
  { key: "obs", label: "Observação", type: "text", options: [] },
];
const members = [USER];

describe("slugifyKey", () => {
  test("minúsculas, sem acento, com sublinhado", () => {
    expect(slugifyKey("Porte da empresa")).toBe("porte_da_empresa");
    expect(slugifyKey("Código-Interno")).toBe("codigo_interno");
  });
  test("prefixo campo_ quando começa por dígito", () => {
    expect(slugifyKey("2º contato")).toBe("campo_2_contato");
  });
  test("corta em 40 caracteres", () => {
    expect(slugifyKey("a".repeat(80)).length).toBe(40);
    expect(slugifyKey("1" + "a".repeat(80)).length).toBe(40);
  });
});

describe("customFieldDefSchema", () => {
  test("gera a chave a partir do rótulo", () => {
    const r = customFieldDefSchema.parse({ label: "Porte da empresa", type: "text" });
    expect(r.key).toBe("porte_da_empresa");
  });
  test("select sem opções é rejeitado", () => {
    expect(customFieldDefSchema.safeParse({ label: "X", type: "select", options: [] }).success).toBe(false);
    expect(customFieldDefSchema.safeParse({ label: "X", type: "multiselect" }).success).toBe(false);
  });
  test("opções repetidas são rejeitadas", () => {
    expect(
      customFieldDefSchema.safeParse({ label: "X", type: "select", options: ["a", "a"] }).success,
    ).toBe(false);
  });
  test("rótulo vazio ou longo demais é rejeitado", () => {
    expect(customFieldDefSchema.safeParse({ label: " ", type: "text" }).success).toBe(false);
    expect(customFieldDefSchema.safeParse({ label: "x".repeat(61), type: "text" }).success).toBe(false);
  });
  test("tipos sem opções descartam opções", () => {
    const r = customFieldDefSchema.parse({ label: "N", type: "number", options: ["a"] });
    expect(r.options).toEqual([]);
  });
});

describe("validateCustomFieldValues", () => {
  const run = (v: Record<string, unknown>) => validateCustomFieldValues(defs, v, members);
  test("valores válidos", () => {
    expect(
      run({ porte: "Médio", tags: ["a", "b"], qtd: 3, valor: 10.5, desde: "2024-02-29", resp: USER, obs: null }),
    ).toEqual({ ok: true });
  });
  test("opção inexistente", () => {
    expect(run({ porte: "Gigante" })).toMatchObject({ ok: false, key: "porte" });
    expect(run({ tags: ["a", "z"] })).toMatchObject({ ok: false, key: "tags" });
  });
  test("chave inexistente", () => {
    expect(run({ inexistente: 1 })).toMatchObject({ ok: false, key: "inexistente" });
  });
  test("null é aceito", () => {
    expect(run({ porte: null })).toEqual({ ok: true });
  });
  test("datas inválidas", () => {
    expect(run({ desde: "2026-13-01" })).toMatchObject({ ok: false, key: "desde" });
    expect(run({ desde: "2024-02-30" })).toMatchObject({ ok: false, key: "desde" });
    expect(run({ desde: "2024-2-3" })).toMatchObject({ ok: false, key: "desde" });
  });
  test("tipos errados", () => {
    expect(run({ qtd: "3" })).toMatchObject({ ok: false, key: "qtd" });
    expect(run({ obs: "x".repeat(2001) })).toMatchObject({ ok: false, key: "obs" });
    expect(run({ tags: "a" })).toMatchObject({ ok: false, key: "tags" });
  });
  test("usuário precisa estar na lista de membros", () => {
    expect(run({ resp: OTHER })).toMatchObject({ ok: false, key: "resp" });
    expect(run({ resp: "nao-uuid" })).toMatchObject({ ok: false, key: "resp" });
  });
});
