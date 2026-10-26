// Constantes compartilhadas entre o motor (servidor) e a interface (cliente).

/** Início da mensagem de falha do users_check; depois dele vêm os pares "Nome (Empresa)" separados por "; ". */
export const USERS_CHECK_FAILURE = "Usuários sem acesso ativo à empresa de destino:";

/** Máximo de itens guardados em import_jobs.errors e em import_jobs.warnings (import_log_error); todos contam. */
export const LOG_LIMIT = 1000;

/** Pares "Nome (Empresa)" de uma falha do users_check, ou null se a mensagem é de outra falha. */
export function usersCheckPairs(reason: string): string[] | null {
  if (!reason.startsWith(USERS_CHECK_FAILURE)) return null;
  return reason
    .slice(USERS_CHECK_FAILURE.length)
    .split("; ")
    .map((p) => p.trim())
    .filter(Boolean);
}
