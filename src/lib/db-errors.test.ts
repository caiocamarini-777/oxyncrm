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
  it.each([
    ["OXYN_OWNER_NOT_MEMBER", "Essa pessoa não tem acesso a esta empresa."],
    ["OXYN_REASSIGN_FORBIDDEN", "Você não pode trocar o responsável."],
    ["OXYN_TRASH_FORBIDDEN", "Você não pode mover para a lixeira."],
    ["OXYN_COMPANY_IMMUTABLE", "Não é possível mudar a empresa do registro."],
    ["OXYN_INVALID_CUSTOM_FIELD", "Valor inválido no campo personalizado."],
    ["OXYN_CROSS_COMPANY", "Os registros ligados precisam ser da mesma empresa."],
    ["OXYN_REQUIRED_FIELDS", "Preencha os campos obrigatórios desta etapa."],
    ["OXYN_TOTALS_FROM_ITEMS", "Com produtos no negócio, os totais vêm dos itens."],
    ["OXYN_PRODUCT_INACTIVE", "Este produto está inativo."],
    ["OXYN_INVALID_TRANSITION", "Essa mudança de status não é permitida."],
    ["OXYN_STAGE_ARCHIVED", "Esta etapa está arquivada."],
    ["OXYN_PIPELINE_ARCHIVED", "Este funil está arquivado."],
    ["OXYN_LAST_MEETING_TYPE", "Mantenha ao menos um tipo de reunião ativo."],
    ["OXYN_LAST_BOOKING_OUTCOME", "Mantenha ao menos um resultado que agenda reunião."],
    ["OXYN_LEGACY_CHANNEL", "O canal de importação não pode ser ativado."],
    ["OXYN_ALREADY_DONE", "Esta atividade já foi concluída."],
    ["OXYN_NOT_DONE", "Esta atividade não está concluída."],
    ["OXYN_OUTCOME_REQUIRED", "Informe o resultado da atividade."],
    ["OXYN_MEETING_REQUIRED", "Agende a reunião para concluir com este resultado."],
    ["OXYN_NEXT_ACTIVITY_REQUIRED", "Agende a próxima atividade para concluir."],
    ["OXYN_LINK_FORBIDDEN", "Você não tem acesso a um dos registros vinculados."],
    ["OXYN_INVALID_INPUT", "Dados inválidos. Confira os campos e tente novamente."],
    ["OXYN_INVALID_REPORT", "Relatório inválido. Revise os campos escolhidos."],
    ["OXYN_FORBIDDEN", "Você não tem permissão para esta ação."],
  ])("%s", (code, text) => expect(translateDbError({ message: `x ${code}` })).toBe(text));
  it("genérico", () =>
    expect(translateDbError({ code: "XX000" })).toBe("Não foi possível concluir. Tente novamente."));
});
