import type { GmailThread } from "./client";
import { parseGmailMessage, type GmailMessage, type ParsedMessage } from "./parse";
import { directionOf, skipByLabels } from "./sync-core";
import type { ThreadMessageView } from "./thread-view";

// Formas puras (sem rede nem banco) do módulo E-mail ao vivo.

/** Conversas por página da lista ao vivo. */
export const LIVE_PAGE_SIZE = 25;
/** Leituras de metadados em paralelo por página. */
export const LIVE_CONCURRENCY = 5;

export type LiveThreadSummary = {
  gmailThreadId: string;
  subject: string;
  /** Quem enviou a última mensagem ("Você" quando é a própria caixa). */
  sender: string;
  /** ISO da última mensagem, ou null se o Gmail não informou. */
  lastAt: string | null;
  snippet: string;
  messageCount: number;
};

/** O trecho do Gmail vem com entidades HTML (`&#39;`, `&amp;`...). */
export function decodeSnippet(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_m, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

const REPLY_PREFIX = /^\s*((re|res|enc|fw|fwd|aw|wg)\s*:\s*)+/i;

/**
 * Resumo de uma conversa lida em formato `metadata`. O assunto é o da primeira mensagem (a original,
 * sem "Re:"); remetente, data e trecho vêm da última. Sem mensagens legíveis, usa o trecho da listagem.
 */
export function summarizeThread(
  gmailThreadId: string,
  thread: GmailThread | null,
  accountEmail: string,
  fallbackSnippet = "",
): LiveThreadSummary {
  const visible = (thread?.messages ?? []).filter((m) => !skipByLabels(m.labelIds));
  if (visible.length === 0) {
    return { gmailThreadId, subject: "", sender: "", lastAt: null, snippet: decodeSnippet(fallbackSnippet), messageCount: 0 };
  }
  const parsed = visible.map(parseGmailMessage);
  const first = parsed[0];
  const last = parsed[parsed.length - 1];
  const original = parsed.find((p) => p.subject && !REPLY_PREFIX.test(p.subject)) ?? first;
  const own = directionOf(last.from.email, accountEmail) === "out";
  return {
    gmailThreadId,
    subject: original.subject || first.subject,
    sender: own ? "Você" : last.from.name?.trim() || last.from.email,
    lastAt: Date.parse(last.sentAt) > 0 ? last.sentAt : null,
    snippet: decodeSnippet(last.snippet || fallbackSnippet),
    messageCount: parsed.length,
  };
}

/** `map` com no máximo `limit` chamadas ao mesmo tempo, preservando a ordem do resultado. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  async function worker() {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return out;
}

/** Endereço de uma página do módulo, só com os parâmetros que têm valor. */
export function mailboxHref(base: string, params: { caixa?: string | null; q?: string | null; pagina?: string | null }): string {
  const p = new URLSearchParams();
  if (params.caixa) p.set("caixa", params.caixa);
  if (params.q?.trim()) p.set("q", params.q.trim());
  if (params.pagina) p.set("pagina", params.pagina);
  const s = p.toString();
  return s ? `${base}?${s}` : base;
}

/** Texto digitado na busca: aparado e limitado (a sintaxe do Gmail é livre). */
export function cleanQuery(raw: string | undefined): string {
  return (raw ?? "").trim().slice(0, 200);
}

/** Cursor de página do Gmail vindo da URL: só o que parece um token (evita lixo na consulta). */
export function cleanPageToken(raw: string | undefined): string | null {
  const t = (raw ?? "").trim();
  return /^[A-Za-z0-9_-]{1,512}$/.test(t) ? t : null;
}

/** Busca padrão da caixa ao vivo: sem chats, spam e lixeira (o Gmail já os exclui da caixa de entrada). */
export function effectiveQuery(q: string): string {
  return q ? q : "-in:chats -in:spam -in:trash";
}

/** Mensagem do Gmail -> a forma que o `MessageView` mostra. */
export function toMessageView(p: ParsedMessage, accountEmail: string): ThreadMessageView {
  return {
    id: p.gmailId,
    gmailMessageId: p.gmailId,
    fromEmail: p.from.email.toLowerCase(),
    fromName: p.from.name,
    to: p.to,
    cc: p.cc,
    sentAt: p.sentAt,
    snippet: p.snippet,
    bodyHtml: p.html,
    bodyText: p.text,
    attachments: p.attachments.map((a) => ({ filename: a.filename || "(sem nome)" })),
    direction: directionOf(p.from.email, accountEmail),
  };
}

/** Mensagens que seriam gravadas (sem rascunho, spam, lixo e chat), em ordem cronológica. */
export function visibleMessages(messages: GmailMessage[] | undefined): GmailMessage[] {
  return (messages ?? [])
    .filter((m) => !skipByLabels(m.labelIds))
    .slice()
    .sort((a, b) => Number(a.internalDate ?? 0) - Number(b.internalDate ?? 0));
}

export type ExternalSender = { email: string; name: string | null };

/** Remetentes distintos de mensagens recebidas (não da própria caixa), na ordem em que aparecem. */
export function externalSenders(messages: ThreadMessageView[], accountEmail: string): ExternalSender[] {
  const own = accountEmail.trim().toLowerCase();
  const seen = new Map<string, ExternalSender>();
  for (const m of messages) {
    const email = m.fromEmail.trim().toLowerCase();
    if (!email || email === own) continue;
    const cur = seen.get(email);
    if (!cur) seen.set(email, { email, name: m.fromName?.trim() || null });
    else if (!cur.name && m.fromName?.trim()) cur.name = m.fromName.trim();
  }
  return [...seen.values()];
}

/** Nome sugerido para a pessoa criada a partir do remetente: o nome do cabeçalho ou a parte local do e-mail. */
export function suggestedPersonName(s: ExternalSender): string {
  if (s.name) return s.name;
  const local = s.email.split("@")[0] ?? s.email;
  return local
    .replace(/[._-]+/g, " ")
    .trim()
    .replace(/\b\p{L}/gu, (c) => c.toUpperCase());
}
