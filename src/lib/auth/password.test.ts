import { describe, expect, it } from "vitest";
import { validatePassword } from "./password";

describe("validatePassword", () => {
  it("recusa senha curta", () => {
    expect(validatePassword("curta", "curta")).toBe("A senha precisa ter pelo menos 8 caracteres.");
  });
  it("recusa confirmação diferente", () => {
    expect(validatePassword("senha-longa-1", "senha-longa-2")).toBe("As senhas não conferem.");
  });
  it("aceita senha válida", () => {
    expect(validatePassword("senha-longa-1", "senha-longa-1")).toBeNull();
  });
});
