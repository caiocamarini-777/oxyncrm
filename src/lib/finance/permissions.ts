import "server-only";
import { cache } from "react";
import { getCurrentProfile } from "@/lib/auth/session";
import { getAccessibleCompanies } from "@/lib/companies/scope";
import { createServerClient } from "@/lib/supabase/server";

export type FinanceAccess = { view: boolean; manage: boolean; sell: boolean };

function fail(what: string, error: { message: string; code?: string }): never {
  console.error(`[financeiro] ${what}:`, error.code, error.message);
  throw new Error(`Falha ao carregar o financeiro (${what}).`);
}

const NONE: FinanceAccess = { view: false, manage: false, sell: false };

/** Acesso do usuário ao Financeiro de uma empresa (tudo falso se o módulo está desligado nela). */
export async function getFinanceAccess(companyId: string): Promise<FinanceAccess> {
  const profile = await getCurrentProfile();
  if (!profile || !profile.active) return NONE;
  const supabase = await createServerClient();
  const check = async (action: "view" | "manage" | "sell") => {
    const { data, error } = await supabase.rpc("can_finance", { p_company: companyId, p_action: action });
    if (error) fail("permissão", error);
    return data === true;
  };
  const [view, manage, sell] = await Promise.all([check("view"), check("manage"), check("sell")]);
  return { view, manage, sell };
}

async function slugsWhere(action: "view" | "sell"): Promise<string[]> {
  const [profile, companies] = await Promise.all([getCurrentProfile(), getAccessibleCompanies()]);
  if (!profile || !profile.active) return [];
  const supabase = await createServerClient();
  const checks = await Promise.all(
    companies.map(async (c) => {
      const { data, error } = await supabase.rpc("can_finance", { p_company: c.id, p_action: action });
      if (error) fail("permissão", error);
      return data === true ? c.slug : null;
    }),
  );
  return checks.filter((s): s is string => s !== null);
}

/** Slugs das empresas acessíveis em que o usuário pode registrar vendas de clientes. */
export const salesCompanySlugs = cache(() => slugsWhere("sell"));

/** Slugs das empresas acessíveis em que o usuário pode ver o Financeiro (para o menu). */
export const financeCompanySlugs = cache(() => slugsWhere("view"));
