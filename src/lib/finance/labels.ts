export const END_RULE_LABEL: Record<string, string> = {
  ends: "Termina no fim da vigência",
  auto_renew: "Renova automaticamente",
  renew_adjust: "Renova com reajuste",
  confirm: "Pede confirmação na renovação",
};
export const ADJUST_KIND_LABEL: Record<string, string> = { none: "Sem reajuste", percent: "Percentual fixo", index: "Índice" };
export const LINE_KIND_LABEL: Record<string, string> = { setup: "Setup", recurring: "Recorrente", commission: "Comissão" };
export const FREQUENCY_LABEL: Record<string, string> = { monthly: "Mensal", quarterly: "Trimestral", yearly: "Anual" };
export const CONTRACT_STATUS_LABEL: Record<string, string> = {
  draft: "Pendente",
  active: "Ativo",
  ended: "Encerrado",
  cancelled: "Cancelado",
};

/** Número do formulário em formato BRL ("1234,50"). */
export const toInput = (n: number | null | undefined): string => (n === null || n === undefined ? "" : n.toFixed(2).replace(".", ","));
