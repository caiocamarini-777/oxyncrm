/**
 * Regras puras das ações do vendedor sobre as reuniões (sem banco nem rede), para testar à parte.
 * Um arquivo `"use server"` só exporta funções assíncronas; por isso as regras ficam aqui.
 */

export type SuggestionKind = "meeting_outcome" | "next_activity" | "stage";
export type MeetingStatus = "waiting_transcript" | "processing" | "unlinked" | "done" | "failed" | "ignored";

/** Registros que o vendedor pode escolher ao vincular (nunca organização). */
export const LINK_ENTITIES = ["deals", "leads", "persons"] as const;
export type LinkEntity = (typeof LINK_ENTITIES)[number];

export function isLinkEntity(v: unknown): v is LinkEntity {
  return typeof v === "string" && (LINK_ENTITIES as readonly string[]).includes(v);
}

export const SUBJECT_MAX = 200;
const TYPE_MAX = 100;

export type EditedPayload =
  | { outcome: string }
  | { type: string; subject: string; due_date: string; due_time: string | null }
  | { stage: string };

export type Validated = { ok: true; payload: EditedPayload } | { ok: false; error: string };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** `YYYY-MM-DD` de um dia que existe no calendário. */
export function isValidDate(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}

/** `HH:MM` de 24 h, exatamente neste formato (o `toUtc` do sink exige). */
export function isValidTime(s: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
}

function text(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length > 0 && t.length <= max ? t : null;
}

/** Valida (e normaliza) o conteúdo de uma sugestão, editado pelo vendedor ou o guardado, conforme o `kind`. */
export function validateEdited(kind: SuggestionKind, edited: unknown): Validated {
  if (!isRecord(edited)) return { ok: false, error: "Dados da sugestão inválidos." };
  if (kind === "meeting_outcome") {
    const outcome = text(edited.outcome, TYPE_MAX);
    return outcome ? { ok: true, payload: { outcome } } : { ok: false, error: "Informe o resultado da reunião." };
  }
  if (kind === "stage") {
    const stage = text(edited.stage, TYPE_MAX);
    return stage ? { ok: true, payload: { stage } } : { ok: false, error: "Informe a etapa." };
  }
  const type = text(edited.type, TYPE_MAX);
  if (!type) return { ok: false, error: "Informe o tipo da atividade." };
  const subject = text(edited.subject, SUBJECT_MAX);
  if (!subject) return { ok: false, error: `Informe o assunto da atividade (até ${SUBJECT_MAX} caracteres).` };
  const dueDate = edited.due_date;
  if (typeof dueDate !== "string" || !isValidDate(dueDate)) {
    return { ok: false, error: "Data inválida. Use o formato AAAA-MM-DD." };
  }
  const dueTime = edited.due_time ?? null;
  if (dueTime !== null && (typeof dueTime !== "string" || !isValidTime(dueTime))) {
    return { ok: false, error: "Hora inválida. Use o formato HH:MM, de 00:00 a 23:59." };
  }
  return { ok: true, payload: { type, subject, due_date: dueDate, due_time: dueTime } };
}

const norm = (s: string) => s.trim().toLocaleLowerCase("pt-BR");

/** Mapa nome -> id do resultado de reunião, a partir das opções do campo "outcome" do Pipedrive. */
export function outcomeMap(options: { id: number | string; label?: string | null }[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const o of options) {
    const id = Number(o.id);
    const label = String(o.label ?? "").trim();
    if (label && Number.isFinite(id)) map.set(label, id);
  }
  return map;
}

/** Id do resultado pelo nome (exato, depois sem caixa/espaços). `null` se desconhecido. */
export function outcomeIdFor(name: string, map: Map<string, number>): number | null {
  const exact = map.get(name.trim());
  if (exact != null) return exact;
  const wanted = norm(name);
  for (const [label, id] of map) if (norm(label) === wanted) return id;
  return null;
}

/** Chave (`key_string`) do tipo de atividade pelo nome; sem correspondência, "task". */
export function typeKeyFor(name: string, types: { name?: string | null; key_string?: string | null }[]): string {
  const wanted = norm(name);
  const found = types.find((t) => norm(String(t.name ?? "")) === wanted && t.key_string);
  return found?.key_string ?? "task";
}

/**
 * Id da etapa no Pipedrive: inverte `mappings.pipelines[*].stages` (id no Pipedrive -> etapa do CRM).
 * `null` quando a etapa do CRM não veio da importação.
 */
export function stagePipedriveIdFor(
  crmStageId: string,
  pipelines: Record<string, { stages: Record<string, string | null> }> | null | undefined,
): number | null {
  for (const p of Object.values(pipelines ?? {})) {
    for (const [pdId, crmId] of Object.entries(p.stages ?? {})) {
      const id = Number(pdId);
      if (crmId === crmStageId && Number.isFinite(id)) return id;
    }
  }
  return null;
}

/** Só reunião sem vínculo, do próprio vendedor (ou do admin geral), pode ser vinculada. */
export function canLink(meeting: { owner_id: string; status: MeetingStatus }, userId: string, isSuperAdmin: boolean): boolean {
  return meeting.status === "unlinked" && (meeting.owner_id === userId || isSuperAdmin);
}

export const canDiscard = (status: MeetingStatus) => status === "unlinked" || status === "failed";
export const canRetry = (status: MeetingStatus) => status === "failed";
