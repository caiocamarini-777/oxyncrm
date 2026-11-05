/**
 * Gravação do resultado da reunião. `MeetingSink` é a interface; hoje só existe a implementação que escreve
 * no Pipedrive via REST. Uma `crmSink` (gravar direto no CRM) entra no desligamento do Pipedrive: por ora só a
 * interface existe e `MEET_SINK` não é lida.
 * Sem tentativas aqui: escrever é efeito colateral (repetir duplicaria nota/atividade), então quem chama decide.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { toUtc } from "@/lib/activities/time";

/** Registro-alvo da gravação. Para lead, `pipedriveId` é o uuid do lead no Pipedrive. */
export type SinkTarget = {
  entity: "deals" | "leads" | "persons";
  pipedriveId: string;
  personPipedriveId: string | null;
  orgPipedriveId: string | null;
};

export interface MeetingSink {
  writeNote(t: SinkTarget, html: string, userId: number | null): Promise<{ noteId: number }>;
  /** Com âncora (atividade de reunião agendada): conclui; sem âncora: cria a atividade de reunião já concluída. */
  completeMeeting(
    t: SinkTarget,
    args: { anchorPipedriveId: string | null; outcomeId: number | null; subject: string; startedAt: string; userId: number | null },
  ): Promise<void>;
  /** `dueDate` (YYYY-MM-DD) e `dueTime` (HH:MM) chegam no horário de São Paulo; o Pipedrive recebe UTC. */
  createActivity(
    t: SinkTarget,
    args: { typeKey: string; subject: string; dueDate: string; dueTime: string | null; userId: number | null },
  ): Promise<void>;
  moveStage(dealPipedriveId: string, stagePipedriveId: number): Promise<void>;
}

export class SinkError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "SinkError";
  }
}

/** Chave do tipo "Reunião" no Pipedrive (padrão da conta), usada ao criar a atividade sem âncora. */
export const MEETING_TYPE_KEY = "meeting";

const BASE_URL = "https://api.pipedrive.com";

/** Campo de vínculo da API: negócio e pessoa usam id numérico; lead usa uuid (texto). */
function targetFields(t: SinkTarget): Record<string, string | number> {
  const f: Record<string, string | number> = {};
  if (t.entity === "deals") f.deal_id = Number(t.pipedriveId);
  else if (t.entity === "leads") f.lead_id = t.pipedriveId;
  else f.person_id = Number(t.pipedriveId);
  return f;
}

/** Atividades também levam a pessoa e a organização quando conhecidas (sem sobrescrever o próprio alvo). */
function activityFields(t: SinkTarget): Record<string, string | number> {
  const f = targetFields(t);
  if (t.entity !== "persons" && t.personPipedriveId) f.person_id = Number(t.personPipedriveId);
  if (t.orgPipedriveId) f.org_id = Number(t.orgPipedriveId);
  return f;
}

/** "2026-11-12" + "09:00" (São Paulo) vira { date, time } em UTC. */
function localToUtc(dueDate: string, dueTime: string): { date: string; time: string } {
  const iso = toUtc(`${dueDate}T${dueTime}`);
  return { date: iso.slice(0, 10), time: iso.slice(11, 16) };
}

export function pipedriveSink(opts: { token: string; fetchImpl?: typeof fetch }): MeetingSink {
  const doFetch = opts.fetchImpl ?? fetch;

  async function call(method: "POST" | "PUT", path: string, body: Record<string, unknown>): Promise<{ data?: { id?: number } }> {
    const res = await doFetch(`${BASE_URL}${path}`, {
      method,
      headers: { "x-api-token": opts.token, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    let json: { error?: string; data?: { id?: number } } | null = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (!res.ok) {
      // nunca inclui headers (token) na mensagem
      throw new SinkError(res.status, `Pipedrive respondeu ${res.status} em ${method} ${path}${json?.error ? `: ${json.error}` : ""}`);
    }
    return json ?? {};
  }

  return {
    async writeNote(t, html, userId) {
      const r = await call("POST", "/v1/notes", {
        content: html,
        ...targetFields(t),
        ...(userId != null ? { user_id: userId } : {}),
      });
      const noteId = r.data?.id;
      if (typeof noteId !== "number") throw new SinkError(502, "Pipedrive não devolveu o id da nota.");
      return { noteId };
    },

    async completeMeeting(t, a) {
      const outcome = a.outcomeId != null ? { outcome: a.outcomeId } : {};
      if (a.anchorPipedriveId) {
        await call("PUT", `/v1/activities/${encodeURIComponent(a.anchorPipedriveId)}`, { done: 1, ...outcome });
        return;
      }
      const start = new Date(a.startedAt).toISOString(); // Pipedrive guarda data e hora em UTC
      await call("POST", "/v1/activities", {
        subject: a.subject,
        type: MEETING_TYPE_KEY,
        done: 1,
        due_date: start.slice(0, 10),
        due_time: start.slice(11, 16),
        ...(a.userId != null ? { user_id: a.userId } : {}),
        ...activityFields(t),
        ...outcome,
      });
    },

    async createActivity(t, a) {
      const due = a.dueTime ? localToUtc(a.dueDate, a.dueTime) : { date: a.dueDate, time: null };
      await call("POST", "/v1/activities", {
        subject: a.subject,
        type: a.typeKey,
        done: 0,
        due_date: due.date,
        ...(due.time ? { due_time: due.time } : {}),
        ...(a.userId != null ? { user_id: a.userId } : {}),
        ...activityFields(t),
      });
    },

    async moveStage(dealPipedriveId, stagePipedriveId) {
      await call("PUT", `/v1/deals/${encodeURIComponent(dealPipedriveId)}`, { stage_id: stagePipedriveId });
    },
  };
}

/**
 * Usuário do Pipedrive do vendedor: inverte `mappings.users` (id do Pipedrive -> perfil) da última
 * importação concluída. `null` quando não há importação ou o perfil não foi mapeado.
 */
export async function pipedriveUserFor(db: SupabaseClient, profileId: string): Promise<number | null> {
  const { data, error } = await db
    .from("import_jobs")
    .select("mappings")
    .eq("source", "pipedrive")
    .eq("status", "done")
    .order("finished_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Falha ao ler as importações do Pipedrive: ${error.message}`);
  const users = (data as { mappings?: { users?: Record<string, string> } | null } | null)?.mappings?.users;
  if (!users || typeof users !== "object") return null;
  const found = Object.entries(users).find(([, profile]) => profile === profileId);
  if (!found) return null;
  const id = Number(found[0]);
  return Number.isFinite(id) ? id : null;
}
