"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentProfile, requireSuperAdmin } from "@/lib/auth/session";
import { translateDbError, type ActionResult } from "@/lib/db-errors";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerClient } from "@/lib/supabase/server";
import { afterActivityWrite } from "./activity-hooks";
import { readCalendarSettings, withCalendarSettings } from "./settings";

const PATH = "/configuracoes/agenda";
const uuid = z.string().uuid();
const INVALID = { ok: false, error: "Dados inválidos." } as const;
const RETRY = "Não foi possível salvar agora. Tente novamente.";
/** O modo espelho vale enquanto o último job concluído do Pipedrive rodou como espelho há menos que isto. */
const MIRROR_WINDOW_MS = 48 * 3600_000;

/**
 * Modo espelho do Pipedrive ativo: o último job de importação concluído rodou como espelho e terminou há menos de
 * 48 h. Com ele, a limpeza do espelho mandaria para a lixeira as atividades criadas pela Agenda, e o Pipedrive
 * continuaria gravando na mesma Agenda.
 */
async function mirrorActive(
  supabase: Awaited<ReturnType<typeof createServerClient>>,
): Promise<{ ok: true; active: boolean } | { ok: false; error: string }> {
  const { data, error } = await supabase
    .from("import_jobs")
    .select("mirror, finished_at")
    .eq("status", "done")
    .not("finished_at", "is", null)
    .order("finished_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return { ok: false, error: translateDbError(error) };
  const job = data as { mirror: boolean; finished_at: string } | null;
  return { ok: true, active: !!job?.mirror && Date.now() - Date.parse(job.finished_at) < MIRROR_WINDOW_MS };
}

/**
 * Liga ou desliga a sincronização com a Agenda do Google na empresa (`companies.settings.calendar_sync`), só para o
 * admin geral (a RLS de `companies` também só deixa ele editar). Ligar grava `enabled_at`; desligar mantém o
 * histórico dele. O merge preserva as outras chaves do jsonb; a escrita só vale se a empresa não mudou desde a
 * leitura (`updated_at`), com algumas tentativas, como `saveMeetingSettings`. A empresa arquivada não é editada.
 * Ligar não envia nada na hora: quem adota os eventos do Pipedrive e cria os que faltam é a primeira rodada do cron.
 *
 * Ligar é recusado com o modo espelho ativo. Ligar de novo uma Agenda desligada zera o início e o token das caixas da
 * empresa (pelo cliente admin: a RLS de `email_accounts` não deixa o usuário gravar): a primeira rodada refaz a adoção
 * e cria o que foi agendado no CRM enquanto ela estava desligada.
 */
export async function saveCalendarSync(companyId: string, enabled: boolean): Promise<ActionResult> {
  await requireSuperAdmin();
  if (!uuid.safeParse(companyId).success || typeof enabled !== "boolean") return INVALID;
  const supabase = await createServerClient();
  if (enabled) {
    const mirror = await mirrorActive(supabase);
    if (!mirror.ok) return mirror;
    if (mirror.active) {
      return { ok: false, error: "Desligue o modo espelho (virada do Pipedrive) antes de ligar a Agenda." };
    }
  }
  let reset = false;
  for (let attempt = 0; attempt < 3; attempt++) {
    const cur = await supabase
      .from("companies")
      .select("settings, updated_at")
      .eq("id", companyId)
      .is("archived_at", null)
      .maybeSingle();
    if (cur.error) return { ok: false, error: translateDbError(cur.error) };
    if (!cur.data) return { ok: false, error: "Empresa não encontrada." };
    if (enabled && !reset && !readCalendarSettings(cur.data.settings).enabled) {
      // Antes de ligar: se a gravação falhar depois, as caixas só refazem a primeira rodada (é idempotente).
      const accounts = await createAdminClient()
        .from("email_accounts")
        .update({ calendar_since: null, calendar_sync_token: null })
        .eq("company_id", companyId);
      if (accounts.error) {
        console.error("[agenda] zerar as caixas ao ligar:", accounts.error.code, accounts.error.message);
        return { ok: false, error: RETRY };
      }
      reset = true;
    }
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
  return { ok: false, error: RETRY };
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
