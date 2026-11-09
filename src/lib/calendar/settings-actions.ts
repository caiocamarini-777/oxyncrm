"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentProfile, requireSuperAdmin } from "@/lib/auth/session";
import { translateDbError, type ActionResult } from "@/lib/db-errors";
import { createServerClient } from "@/lib/supabase/server";
import { afterActivityWrite } from "./activity-hooks";
import { withCalendarSettings } from "./settings";

const PATH = "/configuracoes/agenda";
const uuid = z.string().uuid();
const INVALID = { ok: false, error: "Dados inválidos." } as const;

/**
 * Liga ou desliga a sincronização com a Agenda do Google na empresa (`companies.settings.calendar_sync`), só para o
 * admin geral (a RLS de `companies` também só deixa ele editar). Ligar grava `enabled_at`; desligar mantém o
 * histórico dele. O merge preserva as outras chaves do jsonb; a escrita só vale se a empresa não mudou desde a
 * leitura (`updated_at`), com algumas tentativas, como `saveMeetingSettings`. A empresa arquivada não é editada.
 * Ligar não envia nada na hora: quem adota os eventos do Pipedrive e cria os que faltam é a primeira rodada do cron.
 */
export async function saveCalendarSync(companyId: string, enabled: boolean): Promise<ActionResult> {
  await requireSuperAdmin();
  if (!uuid.safeParse(companyId).success || typeof enabled !== "boolean") return INVALID;
  const supabase = await createServerClient();
  for (let attempt = 0; attempt < 3; attempt++) {
    const cur = await supabase
      .from("companies")
      .select("settings, updated_at")
      .eq("id", companyId)
      .is("archived_at", null)
      .maybeSingle();
    if (cur.error) return { ok: false, error: translateDbError(cur.error) };
    if (!cur.data) return { ok: false, error: "Empresa não encontrada." };
    const { data, error } = await supabase
      .from("companies")
      .update({ settings: withCalendarSettings(cur.data.settings, enabled, new Date()) })
      .eq("id", companyId)
      .eq("updated_at", cur.data.updated_at)
      .select("id");
    if (error) return { ok: false, error: translateDbError(error) };
    if (data && data.length > 0) {
      revalidatePath(PATH);
      return { ok: true, data: undefined };
    }
  }
  return { ok: false, error: "Não foi possível salvar agora. Tente novamente." };
}

/**
 * "Tentar de novo" da atividade com erro da Agenda: zera as tentativas e marca pendente pelo cliente do USUÁRIO (a
 * RLS de `activities` confere que ele pode editar a atividade) e manda na hora. Só vale para atividade em `error`
 * (fora dela não há o que tentar, e uma empresa com a Agenda desligada nunca chega a `pending`). Mexer só nas colunas
 * `calendar_*` não passa pelo gatilho de pendente, então o estado gravado aqui é o que vale. O resultado do envio
 * (feito, ou erro de novo) aparece na atividade, não neste retorno.
 */
export async function retryCalendarSync(activityId: string): Promise<ActionResult> {
  if (!uuid.safeParse(activityId).success) return INVALID;
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, error: "Você não tem permissão para esta ação." };
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("activities")
    .update({ calendar_state: "pending", calendar_attempts: 0, calendar_error: null })
    .eq("id", activityId)
    .eq("calendar_state", "error")
    .select("id");
  if (error) return { ok: false, error: translateDbError(error) };
  if (!data || data.length === 0) {
    return { ok: false, error: "Esta atividade não tem erro da Agenda para tentar de novo, ou você não pode editá-la." };
  }
  await afterActivityWrite(activityId);
  revalidatePath("/", "layout");
  return { ok: true, data: undefined };
}
