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
  if (msg.includes("OXYN_COMPANY_IMMUTABLE")) return "Não é possível mudar a empresa do registro.";
  if (msg.includes("OXYN_INVALID_CUSTOM_FIELD")) return "Valor inválido no campo personalizado.";
  if (msg.includes("OXYN_CROSS_COMPANY")) return "Os registros ligados precisam ser da mesma empresa.";
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
