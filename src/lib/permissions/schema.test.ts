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
});
