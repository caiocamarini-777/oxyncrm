import type { HistoryRecord } from "./client";
import type { EmailLinkTarget } from "./matcher";
import type { ParsedMessage } from "./parse";

// Lógica decisória da sincronização, sem rede nem banco (testável).

/** Dados da caixa que a sincronização lê (colunas de email_accounts). */
export type SyncAccount = {
  id: string;
  company_id: string;
  email: string;
  history_id: string | null;
  backfill_page_token: string | null;
  backfill_done: boolean;
  /** Tentativas com erro 5xx por mensagem (`{gmailId: n}`). Ausente = nenhuma. */
  sync_failures?: Record<string, number> | null;
};

export type MessageRow = {
  thread_id: string;
  account_id: string;
  gmail_message_id: string;
  rfc_message_id: string | null;
  from_email: string;
  from_name: string | null;
  to: { email: string; name: string | null }[];
  cc: { email: string; name: string | null }[];
  sent_at: string;
  snippet: string;
  body_html: string | null;
  body_text: string | null;
  attachments: { filename: string; mimeType: string; size: number }[];
  direction: "in" | "out";
};

// Janelas da carga ------------------------------------------------------------

export const BACKFILL_MONTHS = 12;
export const RECOVERY_DAYS = 7;

const pad = (n: number) => String(n).padStart(2, "0");
const fmtDate = (d: Date) => `${d.getUTCFullYear()}/${pad(d.getUTCMonth() + 1)}/${pad(d.getUTCDate())}`;

/** Data (YYYY/MM/DD) 12 meses antes de `now`: início da primeira carga. */
export function backfillAfter(now: Date): string {
  const d = new Date(now);
  d.setUTCMonth(d.getUTCMonth() - BACKFILL_MONTHS);
  return fmtDate(d);
}

/** Data (YYYY/MM/DD) 7 dias antes de `now`: início da recuperação após histórico expirado. */
export function recoveryAfter(now: Date): string {
  return fmtDate(new Date(now.getTime() - RECOVERY_DAYS * 86_400_000));
}

export function backfillQuery(after: string): string {
  return `after:${after} -in:chats -in:spam -in:trash`;
}

/**
 * O cursor da carga mora em `backfill_page_token` como `<YYYY/MM/DD>|<pageToken>`. A data fixa a janela
 * da carga inteira (a consulta não muda se a carga atravessar a meia-noite, o que invalidaria o token de
 * página) e diferencia os 12 meses da primeira carga dos 7 dias da recuperação. Valor nulo, ou um token
 * sem prefixo, é uma primeira carga de 12 meses.
 */
export function encodeCursor(after: string, pageToken: string | null): string {
  return `${after}|${pageToken ?? ""}`;
}

export function decodeCursor(raw: string | null, now: Date): { after: string; pageToken: string | null } {
  const m = raw ? /^(\d{4}\/\d{2}\/\d{2})\|([\s\S]*)$/.exec(raw) : null;
  if (m) return { after: m[1], pageToken: m[2] || null };
  return { after: backfillAfter(now), pageToken: raw || null };
}

// Histórico ----------------------------------------------------------------------

/** Rótulos cuja retirada faz a mensagem ser reavaliada (saiu do spam ou da lixeira). */
const RESCUE_LABELS = new Set(["SPAM", "TRASH"]);

/**
 * Mensagens a avaliar num trecho do histórico: as novas (`messagesAdded`) e as que saíram do spam ou da
 * lixeira (`labelsRemoved` com SPAM/TRASH). Outras retiradas de rótulo (lida, arquivada...) não importam.
 */
export function historyRefs(records: HistoryRecord[]): { id: string; threadId: string }[] {
  const refs: { id: string; threadId: string }[] = [];
  for (const rec of records) {
    for (const m of rec.messagesAdded ?? []) refs.push({ id: m.message.id, threadId: m.message.threadId });
    for (const m of rec.labelsRemoved ?? []) {
      if ((m.labelIds ?? []).some((l) => RESCUE_LABELS.has(l))) refs.push({ id: m.message.id, threadId: m.message.threadId });
    }
  }
  return refs;
}

/** Maior `id` dos registros (historyIds são números grandes em texto); null se não houver nenhum. */
export function latestHistoryId(records: HistoryRecord[]): string | null {
  let best: bigint | null = null;
  for (const rec of records) {
    if (!rec.id || !/^\d+$/.test(rec.id)) continue;
    const v = BigInt(rec.id);
    if (best === null || v > best) best = v;
  }
  return best === null ? null : best.toString();
}

// Decisões por mensagem ---------------------------------------------------------

/** Tentativas com erro 5xx antes de pular a mensagem. */
export const MAX_MESSAGE_ATTEMPTS = 3;


const SKIP_LABELS = new Set(["SPAM", "TRASH", "DRAFT", "CHAT"]);

/** O histórico traz também rascunhos, lixo, spam e chat: nada disso entra. */
export function skipByLabels(labelIds: string[] | undefined): boolean {
  return (labelIds ?? []).some((l) => SKIP_LABELS.has(l));
}

/** Só busca o conteúdo completo (e grava) se há vínculo ou se a conversa já está salva. */
export function needsFull(links: EmailLinkTarget[], threadStored: boolean): boolean {
  return links.length > 0 || threadStored;
}

/** Endereços da mensagem (remetente, para e cc), minúsculos e sem vazios. */
export function messageAddresses(p: Pick<ParsedMessage, "from" | "to" | "cc">): string[] {
  return [p.from, ...p.to, ...p.cc].map((a) => a.email.trim().toLowerCase()).filter(Boolean);
}

export function directionOf(fromEmail: string, accountEmail: string): "in" | "out" {
  return fromEmail.trim().toLowerCase() === accountEmail.trim().toLowerCase() ? "out" : "in";
}

// Gravação -------------------------------------------------------------------------

/** O Postgres recusa NUL em texto e substitutos soltos em jsonb: limpa antes de gravar. */
export function clean(s: string): string;
export function clean(s: string | null): string | null;
export function clean(s: string | null): string | null {
  if (s === null) return null;
  return s.replace(/\u0000/g, "").toWellFormed();
}

export function buildMessageRow(account: Pick<SyncAccount, "id" | "email">, threadId: string, p: ParsedMessage): MessageRow {
  const addr = (a: { email: string; name: string | null }) => ({ email: clean(a.email), name: clean(a.name) });
  return {
    thread_id: threadId,
    account_id: account.id,
    gmail_message_id: p.gmailId,
    rfc_message_id: clean(p.rfcMessageId),
    from_email: clean(p.from.email.toLowerCase()),
    from_name: clean(p.from.name),
    to: p.to.map(addr),
    cc: p.cc.map(addr),
    sent_at: p.sentAt,
    snippet: clean(p.snippet),
    body_html: clean(p.html),
    body_text: clean(p.text),
    attachments: p.attachments.map((a) => ({ filename: clean(a.filename), mimeType: clean(a.mimeType), size: a.size })),
    direction: directionOf(p.from.email, account.email),
  };
}

const REPLY_PREFIX = /^\s*((re|res|enc|fw|fwd|aw|wg)\s*:\s*)+/i;

/**
 * Atualização da conversa depois de gravar uma mensagem: `last_message_at` é o maior `sent_at` e o
 * assunto é o da mensagem original (a carga lê da mais nova para a mais antiga, então um "Re:" pode
 * chegar primeiro). Devolve só o que muda; vazio = nada a atualizar.
 */
export function threadPatch(
  existing: { subject: string; last_message_at: string | null } | null,
  p: Pick<ParsedMessage, "subject" | "sentAt">,
): { subject?: string; last_message_at?: string } {
  const patch: { subject?: string; last_message_at?: string } = {};
  const subject = clean(p.subject);
  const cur = existing?.subject ?? "";
  if (subject && (!cur || (REPLY_PREFIX.test(cur) && !REPLY_PREFIX.test(subject)))) patch.subject = subject;
  const last = existing?.last_message_at ? new Date(existing.last_message_at).getTime() : -Infinity;
  if (new Date(p.sentAt).getTime() > last) patch.last_message_at = p.sentAt;
  return patch;
}

// Lotes ----------------------------------------------------------------------------

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Remove ids repetidos (o histórico repete a mesma mensagem), mantendo a primeira ocorrência. */
export function dedupeRefs<T extends { id: string }>(refs: T[]): T[] {
  const seen = new Set<string>();
  return refs.filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)));
}

/** Agrupa por conversa: mensagens da mesma conversa rodam em sequência, grupos em paralelo. */
export function groupByThread<T extends { threadId: string }>(refs: T[]): T[][] {
  const groups = new Map<string, T[]>();
  for (const r of refs) {
    const g = groups.get(r.threadId);
    if (g) g.push(r);
    else groups.set(r.threadId, [r]);
  }
  return [...groups.values()];
}
