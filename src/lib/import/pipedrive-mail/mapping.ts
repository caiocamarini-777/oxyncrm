import { clean } from "../../gmail/sync-core";
import { toIso } from "../mapping";

/** Corpo do e-mail cortado neste tamanho (caracteres). */
export const MAX_BODY_CHARS = 1_048_576;
/** Limite do bucket `record-files`: 25 MB. */
export const MAX_FILE_BYTES = 26_214_400;

export type PdAddress = { email_address?: string | null; name?: string | null };

export type PdMailMessage = {
  id: number;
  mail_thread_id?: number | null;
  subject?: string | null;
  snippet?: string | null;
  from?: PdAddress[] | null;
  to?: PdAddress[] | null;
  cc?: PdAddress[] | null;
  message_time?: string | null;
  add_time?: string | null;
  user_id?: number | null;
  mua_message_id?: string | null;
  sent_flag?: number | boolean | null;
};

export type PdFile = {
  id: number;
  name?: string | null;
  file_name?: string | null;
  file_type?: string | null;
  file_size?: number | null;
  inline_flag?: boolean | number | null;
  remote_location?: string | null;
  url?: string | null;
  mail_message_id?: number | null;
  deal_id?: number | null;
  lead_id?: string | null;
  person_id?: number | null;
  org_id?: number | null;
  activity_id?: number | null;
  add_time?: string | null;
  user_id?: number | null;
};

export type EmailRow = {
  pipedrive_id: number;
  pipedrive_thread_id: number | null;
  owner_id: string | null;
  subject: string;
  from_email: string;
  from_name: string | null;
  to: { email: string; name: string | null }[];
  cc: { email: string; name: string | null }[];
  sent_at: string;
  snippet: string;
  body_html: string | null;
  rfc_message_id: string | null;
  direction: "in" | "out";
};

const EPOCH = "1970-01-01T00:00:00.000Z";

/** Data do Pipedrive (UTC) -> ISO com milissegundos; vazia ou inválida: null. Reaproveita o `toIso` da importação. */
function isoMillis(v: string | null | undefined): string | null {
  const iso = toIso(v);
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function addresses(list: PdAddress[] | null | undefined): { email: string; name: string | null }[] {
  if (!Array.isArray(list)) return [];
  const out: { email: string; name: string | null }[] = [];
  for (const a of list) {
    if (!a?.email_address) continue;
    out.push({ email: clean(a.email_address), name: clean(a.name || null) });
  }
  return out;
}

/** Textos passam pelo `clean` do Gmail: o Postgres recusa NUL em texto e substitutos soltos em jsonb. */
export function mapMailMessage(m: PdMailMessage, ctx: { ownerId: string | null; body: string | null }): EmailRow {
  const from = Array.isArray(m.from) ? m.from[0] : undefined;
  return {
    pipedrive_id: m.id,
    pipedrive_thread_id: m.mail_thread_id ?? null,
    owner_id: ctx.ownerId,
    subject: clean(m.subject ?? ""),
    from_email: clean(from?.email_address ?? ""),
    from_name: clean(from?.name || null),
    to: addresses(m.to),
    cc: addresses(m.cc),
    sent_at: isoMillis(m.message_time) ?? isoMillis(m.add_time) ?? EPOCH,
    snippet: clean(m.snippet ?? ""),
    // cortado antes do clean: um par substituto partido ao meio vira U+FFFD
    body_html: ctx.body === null ? null : clean(ctx.body.slice(0, MAX_BODY_CHARS)),
    rfc_message_id: clean(m.mua_message_id || null),
    direction: m.sent_flag === 1 || m.sent_flag === true ? "out" : "in",
  };
}

export type FileTarget =
  | { kind: "email"; pdMessageId: number }
  | { kind: "record"; entity: "deals" | "leads" | "persons" | "organizations"; pdId: string }
  | { kind: "activity"; pdActivityId: number }
  | { kind: "skip"; reason: "inline" | "ics" | "no_target" };

const present = (v: unknown): boolean => v !== null && v !== undefined && v !== "";

/** Para onde o arquivo vai. A ordem das regras é a precedência: inline, ics, e-mail, deal, lead, pessoa, organização, atividade. */
export function classifyFile(f: PdFile): FileTarget {
  if (f.inline_flag) return { kind: "skip", reason: "inline" };
  if (f.file_type?.toLowerCase() === "ics" || [f.file_name, f.name].some((n) => /\.ics$/i.test(n ?? ""))) return { kind: "skip", reason: "ics" };
  if (present(f.mail_message_id)) return { kind: "email", pdMessageId: f.mail_message_id as number };
  if (present(f.deal_id)) return { kind: "record", entity: "deals", pdId: String(f.deal_id) };
  if (present(f.lead_id)) return { kind: "record", entity: "leads", pdId: String(f.lead_id) };
  if (present(f.person_id)) return { kind: "record", entity: "persons", pdId: String(f.person_id) };
  if (present(f.org_id)) return { kind: "record", entity: "organizations", pdId: String(f.org_id) };
  if (present(f.activity_id)) return { kind: "activity", pdActivityId: f.activity_id as number };
  return { kind: "skip", reason: "no_target" };
}

/** Arquivo que mora fora do Pipedrive (Google Drive etc.): não dá para baixar. */
export function isRemoteFile(f: PdFile): boolean {
  return !!f.remote_location && f.remote_location !== "s3";
}

/** Link externo só se for http(s): um `javascript:` vindo do Pipedrive não pode virar URL aberta pela tela. */
export function isWebUrl(raw: string | null | undefined): raw is string {
  if (!raw) return false;
  try {
    const u = new URL(raw);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

/** Nome original do arquivo, para exibir (`record_files.filename`): sem barras; vazio cai no próximo. */
export function fileName(f: PdFile): string {
  return clean(f.file_name || f.name || `arquivo-${f.id}`).replace(/[/\\]/g, "_");
}

/** Data em que o arquivo entrou no Pipedrive (`add_time`, UTC) em ISO; vazia ou inválida: null (fica o padrão do banco). */
export function fileAddedAt(f: PdFile): string | null {
  return isoMillis(f.add_time);
}

/** Tamanho máximo do nome no caminho do bucket. */
const MAX_KEY_NAME = 120;
/** Extensão mais longa que o corte preserva (com o ponto). */
const MAX_KEY_EXT = 20;

/**
 * Nome para a chave do Storage: ASCII (sem acentos), só `[A-Za-z0-9._-]` (o resto vira `_`), sem `..` nem ponto
 * no início, até 120 caracteres preservando a extensão; `arquivo` se ficar vazio. O storage-js não codifica o
 * caminho na URL (`#`, `?` e `%` quebrariam o envio) e o Storage recusa chaves fora do ASCII.
 */
export function safeName(name: string): string {
  let s = name.normalize("NFKD").replace(/\p{M}+/gu, "").replace(/[^A-Za-z0-9._-]/gu, "_");
  if (s.length > MAX_KEY_NAME) {
    const dot = s.lastIndexOf(".");
    const ext = dot > 0 && s.length - dot <= MAX_KEY_EXT ? s.slice(dot) : "";
    s = s.slice(0, MAX_KEY_NAME - ext.length) + ext;
  }
  s = s.replace(/\.{2,}/g, ".").replace(/^\.+/, "");
  return s || "arquivo";
}

/**
 * Caminho do arquivo no bucket: `{empresa}/pd-{id do arquivo no Pipedrive}/{nome seguro}`. Determinístico: uma
 * reexecução grava no mesmo objeto (envio com upsert), sem deixar cópias órfãs.
 */
export function storagePath(companyId: string, pdFileId: number, name: string): string {
  return `${companyId}/pd-${pdFileId}/${safeName(name)}`;
}
