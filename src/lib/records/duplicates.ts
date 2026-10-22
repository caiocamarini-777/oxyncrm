/** Resultado de `check_duplicates`: nada além do campo coincidente, do responsável e (se permitido) do id. */
export type DuplicateMatch = {
  matchedOn: string;
  ownerName: string;
  recordId: string | null;
};

export const MATCH_LABELS: Record<string, string> = {
  cnpj: "CNPJ",
  domain: "domínio",
  email: "e-mail",
  phone: "telefone",
};
