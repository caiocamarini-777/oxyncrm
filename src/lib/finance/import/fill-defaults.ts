// Padrões da carga inicial da Oxyn (Step 6 da Task 14), aplicados ao rascunho do extrator:
// - conta única "itau" (Itaú PJ, banco Itaú) em contratos, despesas recorrentes e todos os lançamentos;
// - regra de fim "confirm" em todos os contratos;
// - categoria de serviço por cliente (nome do contrato / organização do lançamento).
import { normalizeName } from "./match";
import type { FinanceImportDraft } from "./schema";

export const OXYN_ACCOUNT = { key: "itau", name: "Itaú PJ", bank: "Itaú" } as const;

/** Cliente da planilha → categoria de serviço (comparado sem acentos, maiúsculas, espaços e pontuação). */
export const OXYN_SERVICE_CATEGORY_MAP: Readonly<Record<string, string>> = {
  "Omni 11": "Terceirização Vendas",
  "Harpix Operação": "Terceirização Vendas",
  "Harpix CRO": "Terceirização Vendas",
  "Harpix CTO": "Terceirização Vendas",
  Naia: "Terceirização Vendas",
  "Harpix Mentoria": "Consultoria Vendas",
  "Harpix Fase 1": "Consultoria Vendas",
};

export function serviceCategoryFor(name: string, map: Readonly<Record<string, string>> = OXYN_SERVICE_CATEGORY_MAP): string {
  const hit = Object.entries(map).find(([k]) => normalizeName(k) === normalizeName(name));
  if (!hit) throw new Error(`Sem categoria de serviço para ${name}`);
  return hit[1];
}

/** Rascunho do extrator → JSON pronto para o import (sem os avisos). Não altera o objeto recebido. */
export function fillDefaults(
  draft: Omit<FinanceImportDraft, "warnings"> & { warnings?: string[] },
  companySlug: string,
  map: Readonly<Record<string, string>> = OXYN_SERVICE_CATEGORY_MAP,
): Omit<FinanceImportDraft, "warnings"> {
  const d = structuredClone(draft);
  d.companySlug = companySlug;
  d.accounts = [{ ...OXYN_ACCOUNT }];
  for (const c of d.contracts) {
    c.endRule = "confirm";
    c.accountKey = OXYN_ACCOUNT.key;
    for (const l of c.lines) l.serviceCategory = serviceCategoryFor(c.title, map);
  }
  for (const r of d.recurringExpenses) r.accountKey = OXYN_ACCOUNT.key;
  for (const e of d.entries) {
    e.accountKey = OXYN_ACCOUNT.key;
    if (e.organizationName) e.serviceCategory = serviceCategoryFor(e.organizationName, map);
  }
  const { warnings: _warnings, ...rest } = d;
  void _warnings;
  return rest;
}
