import "server-only";
import { cache } from "react";
import { getCurrentProfile } from "@/lib/auth/session";
import { getAccessibleCompanies } from "@/lib/companies/scope";
import { createServerClient } from "@/lib/supabase/server";
import { accessMapFromRows, slugsWithAccess, type FinanceAccess, type FinanceAccessRow } from "./access";

export type { FinanceAccess } from "./access";

const NONE: FinanceAccess = { view: false, manage: false, sell: false };

/**
 * Acesso do usuário ao Financeiro em todas as empresas, numa chamada só (fin_my_companies) e uma vez
 * por request. Empresa ausente do mapa = sem acesso (módulo desligado, arquivada ou sem as chaves).
 */
const financeAccessMap = cache(async (): Promise<Map<string, FinanceAccess>> => {
  const profile = await getCurrentProfile();
  if (!profile || !profile.active) return new Map();
  const supabase = await createServerClient();
  const { data, error } = await supabase.rpc("fin_my_companies");
  if (error) {
    console.error("[financeiro] permissão:", error.code, error.message);
    throw new Error("Falha ao carregar o financeiro (permissão).");
  }
  return accessMapFromRows((data ?? []) as FinanceAccessRow[]);
});

/** Acesso do usuário ao Financeiro de uma empresa (tudo falso se o módulo está desligado nela). */
export async function getFinanceAccess(companyId: string): Promise<FinanceAccess> {
  return (await financeAccessMap()).get(companyId) ?? NONE;
}

/**
 * Slugs das empresas acessíveis com a permissão pedida. Usado pelo menu do layout: se a consulta
 * falhar, registra e segue como sem acesso ao Financeiro, em vez de derrubar o app inteiro.
 */
async function slugsWhere(action: "view" | "sell"): Promise<string[]> {
  try {
    const [access, companies] = await Promise.all([financeAccessMap(), getAccessibleCompanies()]);
    return slugsWithAccess(companies, access, action);
  } catch (err) {
    console.error("[financeiro] menu sem Financeiro (falha ao carregar o acesso):", err);
    return [];
  }
}

/** Slugs das empresas acessíveis em que o usuário pode registrar vendas de clientes. */
export const salesCompanySlugs = cache(() => slugsWhere("sell"));

/** Slugs das empresas acessíveis em que o usuário pode ver o Financeiro (para o menu). */
export const financeCompanySlugs = cache(() => slugsWhere("view"));
