import "server-only";
import { connection } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { scopeCompanyIds } from "./permissions";
import { toGoalRow, type GoalRow, type RawGoal } from "./rows";

export type { GoalRow } from "./rows";

function fail(what: string, error: { message: string; code?: string }): never {
  console.error(`[relatórios] ${what}:`, error.code, error.message);
  throw new Error(`Falha ao carregar relatórios (${what}).`);
}

// Metas -----------------------------------------------------------------------------------------------------
/** Metas das empresas do escopo, com o progresso do período corrente. */
export async function listGoals(scopeSlug: string): Promise<GoalRow[]> {
  await connection();
  const companies = await scopeCompanyIds(scopeSlug);
  if (companies.length === 0) return [];
  const supabase = await createServerClient();
  const { data, error } = await supabase.rpc("goals_progress_self", { p_companies: companies });
  if (error) fail("metas", error);
  return ((data ?? []) as RawGoal[]).map(toGoalRow);
}
