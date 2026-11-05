"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSuperAdmin } from "@/lib/auth/session";
import { translateDbError, type ActionResult } from "@/lib/db-errors";
import { createServerClient } from "@/lib/supabase/server";
import { validateMeetingSettings, withMeetingSettings } from "./settings";

const PATH = "/configuracoes/assistente-reunioes";
const uuid = z.string().uuid();

/**
 * Grava `companies.settings.meeting_assistant` (`{enabled, questions}`) só para o admin geral (a RLS de
 * `companies` também só deixa ele editar). O merge preserva as outras chaves do jsonb; a escrita só vale se a
 * empresa não mudou desde a leitura (`updated_at`), com algumas tentativas — o mesmo padrão de
 * `setEmailSentAsActivity`. A empresa arquivada não é editada.
 */
export async function saveMeetingSettings(companyId: string, input: unknown): Promise<ActionResult> {
  await requireSuperAdmin();
  if (!uuid.safeParse(companyId).success) return { ok: false, error: "Dados inválidos." };
  const parsed = validateMeetingSettings(input);
  if (!parsed.ok) return { ok: false, error: parsed.error, fieldErrors: { questions: parsed.error } };
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
      .update({ settings: withMeetingSettings(cur.data.settings, parsed.value) })
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
