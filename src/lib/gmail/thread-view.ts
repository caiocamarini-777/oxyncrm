import type { Address } from "./addresses";

/** Formas puras (sem acesso ao banco) das conversas mostradas nos cards. */

export type ThreadMessageView = {
  id: string;
  gmailMessageId: string;
  fromEmail: string;
  fromName: string | null;
  to: Address[];
  cc: Address[];
  sentAt: string;
  snippet: string;
  bodyHtml: string | null;
  bodyText: string | null;
  attachments: { filename: string }[];
  direction: "in" | "out";
};

export type RecordThread = {
  threadId: string;
  linkId: string;
  subject: string;
  lastMessageAt: string | null;
  /** Endereço da caixa. Só aparece quando a caixa é sua ou quando há mensagem enviada por ela; senão `null`. */
  accountEmail: string | null;
  isMine: boolean;
  canUnlink: boolean;
  messages: ThreadMessageView[];
};

export type ThreadRow = {
  id: string;
  account_id: string;
  subject: string;
  last_message_at: string | null;
};

export type MessageRow = {
  id: string;
  thread_id: string;
  gmail_message_id: string;
  from_email: string;
  from_name: string | null;
  to: unknown;
  cc: unknown;
  sent_at: string;
  snippet: string;
  body_html: string | null;
  body_text: string | null;
  attachments: unknown;
  direction: "in" | "out";
};

export type LinkRow = { id: string; thread_id: string };

function addresses(v: unknown): Address[] {
  if (!Array.isArray(v)) return [];
  const out: Address[] = [];
  for (const a of v) {
    if (a && typeof a === "object" && typeof (a as Address).email === "string") {
      const name = (a as Address).name;
      out.push({ email: (a as Address).email, name: typeof name === "string" && name ? name : null });
    }
  }
  return out;
}

function attachmentNames(v: unknown): { filename: string }[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((a) => (a && typeof a === "object" ? (a as { filename?: unknown }).filename : null))
    .map((f) => (typeof f === "string" && f ? f : "(sem nome)"))
    .map((filename) => ({ filename }));
}

const time = (iso: string | null) => (iso ? Date.parse(iso) || 0 : 0);

/**
 * Agrupa as mensagens por conversa. Mensagens em ordem cronológica; conversas da mais recente
 * para a mais antiga (por `last_message_at`, ou pela última mensagem se não houver).
 */
export function buildRecordThreads(input: {
  threads: ThreadRow[];
  messages: MessageRow[];
  links: LinkRow[];
  /** id da caixa -> endereço, só das caixas do usuário atual. */
  mineAccounts: Map<string, string>;
  canEditRecord: boolean;
}): RecordThread[] {
  const byThread = new Map<string, MessageRow[]>();
  for (const m of input.messages) {
    const list = byThread.get(m.thread_id);
    if (list) list.push(m);
    else byThread.set(m.thread_id, [m]);
  }
  const linkByThread = new Map(input.links.map((l) => [l.thread_id, l.id]));

  const out: RecordThread[] = [];
  for (const t of input.threads) {
    const linkId = linkByThread.get(t.id);
    if (!linkId) continue;
    const rows = (byThread.get(t.id) ?? []).slice().sort((a, b) => time(a.sent_at) - time(b.sent_at));
    const messages: ThreadMessageView[] = rows.map((m) => ({
      id: m.id,
      gmailMessageId: m.gmail_message_id,
      fromEmail: m.from_email,
      fromName: m.from_name,
      to: addresses(m.to),
      cc: addresses(m.cc),
      sentAt: m.sent_at,
      snippet: m.snippet,
      bodyHtml: m.body_html,
      bodyText: m.body_text,
      attachments: attachmentNames(m.attachments),
      direction: m.direction,
    }));
    const mineEmail = input.mineAccounts.get(t.account_id) ?? null;
    const isMine = mineEmail !== null;
    // Outro usuário não lê `email_accounts` pela RLS: a caixa aparece pelo remetente da mensagem enviada.
    const accountEmail = mineEmail ?? messages.find((m) => m.direction === "out")?.fromEmail ?? null;
    out.push({
      threadId: t.id,
      linkId,
      subject: t.subject,
      lastMessageAt: t.last_message_at ?? messages[messages.length - 1]?.sentAt ?? null,
      accountEmail: accountEmail || null,
      isMine,
      canUnlink: isMine || input.canEditRecord,
      messages,
    });
  }
  return out.sort((a, b) => time(b.lastMessageAt) - time(a.lastMessageAt));
}

/** "Ana, Bruno e mais 2": nomes (ou e-mails) distintos de quem participa da conversa. */
export function threadParticipants(messages: ThreadMessageView[], max = 3): string {
  const seen = new Map<string, string>();
  const add = (email: string, name: string | null) => {
    const key = email.toLowerCase();
    if (key && !seen.has(key)) seen.set(key, name?.trim() || email);
  };
  for (const m of messages) add(m.fromEmail, m.fromName);
  for (const m of messages) for (const a of [...m.to, ...m.cc]) add(a.email, a.name);
  const names = [...seen.values()];
  if (names.length <= max) return names.join(", ");
  return `${names.slice(0, max).join(", ")} e mais ${names.length - max}`;
}

/** "Nome <e-mail>" ou só o e-mail. */
export function formatAddress(a: { email: string; name: string | null }): string {
  return a.name ? `${a.name} <${a.email}>` : a.email;
}

export const EMAIL_CSP =
  "default-src 'none'; img-src https: data:; style-src 'unsafe-inline'; font-src https: data:";

/**
 * Documento do iframe: CSP sem scripts, links em nova aba e uma base de estilo.
 * O `<meta refresh>` do e-mail é removido para o conteúdo não redirecionar o quadro.
 */
export function buildEmailSrcdoc(html: string): string {
  const body = html.replace(/<meta\b[^>]*http-equiv\s*=\s*["']?refresh[^>]*>/gi, "");
  return (
    `<!doctype html><html><head><meta charset="utf-8">` +
    `<meta http-equiv="Content-Security-Policy" content="${EMAIL_CSP}">` +
    `<base target="_blank">` +
    `<style>body{margin:0;padding:0;font-family:system-ui,sans-serif;font-size:14px;word-wrap:break-word}img{max-width:100%;height:auto}</style>` +
    `</head><body>${body}</body></html>`
  );
}

export const MAX_IFRAME_HEIGHT = 800;
export const MIN_IFRAME_HEIGHT = 40;

/** Altura do iframe a partir do conteúdo, limitada (acima disso rola). */
export function clampIframeHeight(contentHeight: number): number {
  if (!Number.isFinite(contentHeight)) return MIN_IFRAME_HEIGHT;
  return Math.min(MAX_IFRAME_HEIGHT, Math.max(MIN_IFRAME_HEIGHT, Math.ceil(contentHeight)));
}
