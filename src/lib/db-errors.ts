export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

export function translateDbError(err: { code?: string; message?: string }): string {
  const msg = err.message ?? "";
  if (msg.includes("OXYN_LAST_SUPER_ADMIN"))
    return "É preciso manter pelo menos um administrador geral ativo.";
  if (msg.includes("OXYN_SELF_LOCKOUT"))
    return "Você não pode remover o seu próprio acesso de administrador.";
  if (msg.includes("OXYN_SYSTEM_ROLE"))
    return "O papel padrão do sistema não pode ser excluído nem renomeado.";
  if (msg.includes("OXYN_FORBIDDEN_FIELD"))
    return "Você não tem permissão para alterar este campo.";
  if (msg.includes("OXYN_OWNER_NOT_MEMBER")) return "Essa pessoa não tem acesso a esta empresa.";
  if (msg.includes("OXYN_REASSIGN_FORBIDDEN")) return "Você não pode trocar o responsável.";
  if (msg.includes("OXYN_TRASH_FORBIDDEN")) return "Você não pode mover para a lixeira.";
  if (msg.includes("OXYN_NOT_FOUND")) return "Registro não encontrado.";
  if (msg.includes("OXYN_COMPANY_IMMUTABLE")) return "Não é possível mudar a empresa do registro.";
  if (msg.includes("OXYN_INVALID_CUSTOM_FIELD")) return "Valor inválido no campo personalizado.";
  if (msg.includes("OXYN_CROSS_COMPANY")) return "Os registros ligados precisam ser da mesma empresa.";
  if (msg.includes("OXYN_REQUIRED_FIELDS")) return "Preencha os campos obrigatórios desta etapa.";
  if (msg.includes("OXYN_TOTALS_FROM_ITEMS")) return "Com produtos no negócio, os totais vêm dos itens.";
  if (msg.includes("OXYN_PRODUCT_INACTIVE")) return "Este produto está inativo.";
  if (msg.includes("OXYN_INVALID_TRANSITION")) return "Essa mudança de status não é permitida.";
  if (msg.includes("OXYN_STAGE_ARCHIVED")) return "Esta etapa está arquivada.";
  if (msg.includes("OXYN_PIPELINE_ARCHIVED")) return "Este funil está arquivado.";
  if (msg.includes("OXYN_LAST_MEETING_TYPE")) return "Mantenha ao menos um tipo de reunião ativo.";
  if (msg.includes("OXYN_LAST_BOOKING_OUTCOME")) return "Mantenha ao menos um resultado que agenda reunião.";
  if (msg.includes("OXYN_LEGACY_CHANNEL")) return "O canal de importação não pode ser ativado.";
  if (msg.includes("OXYN_ALREADY_DONE")) return "Esta atividade já foi concluída.";
  if (msg.includes("OXYN_NOT_DONE")) return "Esta atividade não está concluída.";
  if (msg.includes("OXYN_OUTCOME_REQUIRED")) return "Informe o resultado da atividade.";
  if (msg.includes("OXYN_MEETING_REQUIRED")) return "Agende a reunião para concluir com este resultado.";
  if (msg.includes("OXYN_NEXT_ACTIVITY_REQUIRED")) return "Agende a próxima atividade para concluir.";
  if (msg.includes("OXYN_LINK_FORBIDDEN")) return "Você não tem acesso a um dos registros vinculados.";
  if (msg.includes("OXYN_INVALID_INPUT")) return "Dados inválidos. Confira os campos e tente novamente.";
  if (msg.includes("OXYN_FORBIDDEN")) return "Você não tem permissão para esta ação.";
  switch (err.code) {
    case "23505":
      return "Já existe um registro com esse valor.";
    case "23503":
      return "Este registro está em uso e não pode ser excluído.";
    case "42501":
      return "Você não tem permissão para esta ação.";
  }
  return "Não foi possível concluir. Tente novamente.";
}
