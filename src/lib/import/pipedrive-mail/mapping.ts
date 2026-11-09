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
    out.push({ email: a.email_address, name: a.name || null });
  }
  return out;
}

export function mapMailMessage(m: PdMailMessage, ctx: { ownerId: string | null; body: string | null }): EmailRow {
  const from = Array.isArray(m.from) ? m.from[0] : undefined;
  return {
    pipedrive_id: m.id,
    pipedrive_thread_id: m.mail_thread_id ?? null,
    owner_id: ctx.ownerId,
    subject: m.subject ?? "",
    from_email: from?.email_address ?? "",
    from_name: from?.name || null,
    to: addresses(m.to),
    cc: addresses(m.cc),
    sent_at: isoMillis(m.message_time) ?? isoMillis(m.add_time) ?? EPOCH,
    snippet: m.snippet ?? "",
    body_html: ctx.body === null ? null : ctx.body.slice(0, MAX_BODY_CHARS),
    rfc_message_id: m.mua_message_id || null,
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

/** Nome seguro para o caminho no bucket: sem barras. */
export function fileName(f: PdFile): string {
  return (f.file_name ?? f.name ?? `arquivo-${f.id}`).replace(/[/\\]/g, "_");
}
