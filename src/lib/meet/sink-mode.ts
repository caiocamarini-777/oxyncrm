/**
 * Destino das gravações do assistente de reuniões e a trava do modo espelho.
 * `MEETING_SINK` escolhe entre o Pipedrive (padrão) e o CRM; a troca acontece na virada, depois de desligar o
 * modo espelho. Enquanto o espelho estiver ativo, gravar no CRM é proibido: o Pipedrive apagaria o que fosse gravado.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export type MeetingSinkMode = "pipedrive" | "crm";

/** Lê `MEETING_SINK` (ou o valor passado): só `crm` liga o CRM; ausente ou inválido volta ao Pipedrive. */
export function meetingSinkMode(env: string | undefined = process.env.MEETING_SINK): MeetingSinkMode {
  return env?.trim().toLowerCase() === "crm" ? "crm" : "pipedrive";
}

/** O espelho vale enquanto o último job de importação concluído rodou como espelho há menos que isto. */
export const MIRROR_GUARD_MS = 48 * 3600_000;

/** Aviso (e `last_error` da reunião) quando o modo CRM está ligado mas o espelho ainda não foi desligado. */
export const MIRROR_ACTIVE_ERROR = "modo espelho ativo: o Pipedrive apagaria o que fosse gravado no CRM";

/**
 * Modo espelho do Pipedrive ativo: o último job de importação concluído é espelho e terminou há menos de 48 h.
 * Falha de leitura lança erro (quem chama não grava no CRM sem saber se o espelho está ligado).
 */
export async function mirrorActive(db: SupabaseClient, now: Date): Promise<boolean> {
  const { data, error } = await db
    .from("import_jobs")
    .select("mirror, finished_at")
    .eq("source", "pipedrive")
    .eq("status", "done")
    .not("finished_at", "is", null)
    .order("finished_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Falha ao ler as importações do Pipedrive: ${error.message}`);
  const job = data as { mirror: boolean; finished_at: string } | null;
  return !!job?.mirror && Date.parse(job.finished_at) > now.getTime() - MIRROR_GUARD_MS;
}
