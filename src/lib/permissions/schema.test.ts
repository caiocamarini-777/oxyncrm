import { describe, expect, it } from "vitest";
import { DEFAULT_PERMISSIONS, ENTITIES, permissionsSchema } from "./schema";

function clone() {
  return structuredClone(DEFAULT_PERMISSIONS) as Record<string, Record<string, unknown>>;
}

describe("permissionsSchema", () => {
  it("aceita as permissões padrão", () => {
    expect(() => permissionsSchema.parse(DEFAULT_PERMISSIONS)).not.toThrow();
  });
  it("rejeita visibilidade inválida", () => {
    const p = clone();
    p.visibility.leads = "all";
    expect(permissionsSchema.safeParse(p).success).toBe(false);
  });
  it("rejeita chave ausente", () => {
    const p = clone();
    delete p.settings.share_dashboards;
    expect(permissionsSchema.safeParse(p).success).toBe(false);
  });
  it("rejeita chave extra", () => {
    const p = clone();
    p.actions.foo = true;
    expect(permissionsSchema.safeParse(p).success).toBe(false);
  });
  it("rejeita tipo errado", () => {
    const p = clone();
    p.actions.create = "true";
    expect(permissionsSchema.safeParse(p).success).toBe(false);
  });
  it("padrão tem visibilidade own em todas as entidades", () => {
    expect(Object.keys(DEFAULT_PERMISSIONS.visibility)).toEqual([...ENTITIES]);
    expect(Object.values(DEFAULT_PERMISSIONS.visibility).every((v) => v === "own")).toBe(true);
  });
  it("aceita papel sem as chaves de finanças", () => {
    const p = clone();
    delete p.settings.view_finance;
    delete p.settings.manage_finance;
    delete p.settings.register_sales;
    expect(permissionsSchema.safeParse(p).success).toBe(true);
  });
  it("aceita view_finance verdadeiro", () => {
    const p = { ...DEFAULT_PERMISSIONS, settings: { ...DEFAULT_PERMISSIONS.settings, view_finance: true } };
    expect(permissionsSchema.safeParse(p).success).toBe(true);
  });
  it("padrão traz as chaves de finanças desligadas", () => {
    expect(DEFAULT_PERMISSIONS.settings.manage_finance).toBe(false);
    expect(DEFAULT_PERMISSIONS.settings.view_finance).toBe(false);
    expect(DEFAULT_PERMISSIONS.settings.register_sales).toBe(false);
  });
});
