import { describe, expect, it } from "vitest";
import { translateDbError } from "./db-errors";

describe("translateDbError", () => {
  it("23503", () =>
    expect(translateDbError({ code: "23503" })).toBe(
      "Este registro está em uso e não pode ser excluído.",
    ));
  it("último admin", () =>
    expect(translateDbError({ message: "OXYN_LAST_SUPER_ADMIN" })).toBe(
      "É preciso manter pelo menos um administrador geral ativo.",
    ));
  it("auto bloqueio", () =>
    expect(translateDbError({ message: "x OXYN_SELF_LOCKOUT" })).toBe(
      "Você não pode remover o seu próprio acesso de administrador.",
    ));
  it("genérico", () =>
    expect(translateDbError({ code: "XX000" })).toBe("Não foi possível concluir. Tente novamente."));
});
