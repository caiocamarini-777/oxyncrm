import type { Address } from "./addresses";

/**
 * Formas puras (sem acesso ao banco) das conversas mostradas nos cards.
 * A lista leva só metadados e trecho; o corpo é buscado ao abrir a mensagem (`getEmailMessageBody`).
 */

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

export type ThreadMessageView = {
  id: string;
  gmailMessageId: string;
  fromEmail: string;
  fromName: string | null;
  to: Address[];
  cc: Address[];
  sentAt: string;
  snippet: string;
  /** Corpo já em mãos (caixa ao vivo). Nos cards fica ausente e é buscado ao abrir a mensagem. */
  bodyHtml?: string | null;
  bodyText?: string | null;
  attachments: { filename: string }[];
  direction: "in" | "out";
};

export type RecordThread = {
  threadId: string;
  /** Caixa da conversa e id da conversa no Gmail (para responder). */
  accountId: string;
  gmailThreadId: string;
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
  gmail_thread_id: string;
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
      snippet: decodeSnippet(m.snippet),
      attachments: attachmentNames(m.attachments),
      direction: m.direction,
    }));
    const mineEmail = input.mineAccounts.get(t.account_id) ?? null;
    const isMine = mineEmail !== null;
    // Outro usuário não lê `email_accounts` pela RLS: a caixa aparece pelo remetente da mensagem enviada.
    const accountEmail = mineEmail ?? messages.find((m) => m.direction === "out")?.fromEmail ?? null;
    out.push({
      threadId: t.id,
      accountId: t.account_id,
      gmailThreadId: t.gmail_thread_id,
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

export type ThreadSummary = {
  /** Quem mandou a última mensagem e para quem (até 2 nomes, depois "e mais N"). */
  from: string;
  to: string;
  messages: number;
  attachments: number;
  at: string;
  snippet: string;
  direction: "in" | "out";
};

/** Resumo do card da conversa no histórico, a partir da última mensagem. */
export function threadSummary(thread: RecordThread): ThreadSummary {
  const last = thread.messages[thread.messages.length - 1];
  const label = (a: { email: string; name: string | null }) => a.name?.trim() || a.email;
  const to = (last?.to ?? []).map(label);
  return {
    from: last ? label({ email: last.fromEmail, name: last.fromName }) : "",
    to: to.length <= 2 ? to.join(", ") : `${to.slice(0, 2).join(", ")} e mais ${to.length - 2}`,
    messages: thread.messages.length,
    attachments: thread.messages.reduce((n, m) => n + m.attachments.length, 0),
    at: thread.lastMessageAt ?? last?.sentAt ?? "",
    snippet: last?.snippet ?? "",
    direction: last?.direction ?? "in",
  };
}

/** "Nome <e-mail>" ou só o e-mail. */
export function formatAddress(a: { email: string; name: string | null }): string {
  return a.name ? `${a.name} <${a.email}>` : a.email;
}

/** CSP do iframe: sem scripts; imagens e fontes remotas só quando o usuário pede ("Mostrar imagens"). */
export function emailCsp(showImages: boolean): string {
  return showImages
    ? "default-src 'none'; img-src https: data: cid:; style-src 'unsafe-inline'; font-src https: data:"
    : "default-src 'none'; img-src data: cid:; style-src 'unsafe-inline'; font-src data:";
}

/** CSP padrão (imagens remotas bloqueadas). */
export const EMAIL_CSP = emailCsp(false);

/** Texto de um valor de atributo como o navegador o interpretaria num URL: entidades decodificadas, sem controles/espaços. */
function normalizeUrlValue(v: string): string {
  return v
    .replace(/&#x([0-9a-f]+);?/gi, (_m, h: string) => safeChar(parseInt(h, 16)))
    .replace(/&#(\d+);?/g, (_m, d: string) => safeChar(parseInt(d, 10)))
    .replace(/&colon;/gi, ":")
    .replace(/&(tab|newline);/gi, "")
    .split("")
    .filter((c) => !isIgnoredInUrl(c.charCodeAt(0)))
    .join("")
    .toLowerCase();
}

/** Controles, espaços e caracteres invisíveis que o navegador ignora dentro do esquema de um URL. */
function isIgnoredInUrl(code: number): boolean {
  return (
    code <= 0x20 ||
    (code >= 0x7f && code <= 0x9f) ||
    (code >= 0x200b && code <= 0x200f) ||
    code === 0x2028 ||
    code === 0x2029 ||
    code === 0xfeff
  );
}

function safeChar(code: number): string {
  return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
}

const URL_ATTRS = new Set(["href", "src", "xlink:href", "action", "formaction", "background", "poster", "data", "srcset", "lowsrc", "dynsrc"]);

function isDangerousUrl(attr: string, value: string): boolean {
  const v = normalizeUrlValue(value);
  if (v.startsWith("javascript:") || v.startsWith("vbscript:")) return true;
  if (v.startsWith("data:")) return !(attr === "src" && v.startsWith("data:image/"));
  return false;
}

const BLOCK_TAGS = /<\s*(script|iframe|object|frameset|frame)\b[\s\S]*?(?:<\s*\/\s*\1\s*>|$)/gi;
const LONE_BLOCK_TAGS = /<\s*\/?\s*(script|iframe|object|embed|base|frame|frameset)\b[^>]*>/gi;
const TAG = /<([a-zA-Z][^\s/>]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
const ATTR = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

/**
 * Tira do HTML do e-mail o que pode executar ou navegar: `<script>`/`<iframe>`/`<object>`/`<embed>`/`<base>`,
 * atributos `on*` e `href`/`src` etc. com `javascript:`, `vbscript:` e `data:` (só `data:image` em `src` passa).
 * É uma segunda barreira: o iframe já é sandbox e a CSP bloqueia scripts.
 */
export function sanitizeEmailHtml(html: string): string {
  // uma tag aberta e nunca fechada no fim do HTML se juntaria ao que vem depois no documento
  const noBlocks = html.replace(BLOCK_TAGS, "").replace(LONE_BLOCK_TAGS, "").replace(/<[a-zA-Z][^>]*$/, "");
  return noBlocks.replace(TAG, (_whole, name: string, rest: string) => {
    let attrs = "";
    for (const m of rest.matchAll(ATTR)) {
      const attr = m[1].toLowerCase();
      const value = m[2] ?? m[3] ?? m[4];
      if (attr.startsWith("on")) continue;
      if (value !== undefined && URL_ATTRS.has(attr) && isDangerousUrl(attr, value)) continue;
      attrs += value === undefined ? ` ${m[1]}` : ` ${m[1]}="${value.replace(/"/g, "&quot;")}"`;
    }
    const selfClose = /\/\s*$/.test(rest) && !attrs.endsWith("/") ? " /" : "";
    return `<${name}${attrs}${selfClose}>`;
  });
}

/** Há imagem ou fundo remoto (http/https ou //) no HTML? Decide se vale mostrar o botão "Mostrar imagens". */
export function hasRemoteImages(html: string): boolean {
  return (
    /<(?:img|image|input|video)\b[^>]*\s(?:src|srcset|poster)\s*=\s*["']?\s*(?:https?:)?\/\//i.test(html) ||
    /\sbackground\s*=\s*["']?\s*(?:https?:)?\/\//i.test(html) ||
    /url\(\s*["']?\s*(?:https?:)?\/\//i.test(html)
  );
}

/**
 * Documento do iframe: CSP sem scripts, links em nova aba e uma base de estilo.
 * O HTML do e-mail é sanitizado e o `<meta refresh>` removido para o conteúdo não redirecionar o quadro.
 */
export function buildEmailSrcdoc(html: string, opts: { showImages?: boolean } = {}): string {
  const body = sanitizeEmailHtml(html).replace(/<meta\b[^>]*http-equiv\s*=\s*["']?refresh[^>]*>/gi, "");
  return (
    `<!doctype html><html><head><meta charset="utf-8">` +
    `<meta http-equiv="Content-Security-Policy" content="${emailCsp(opts.showImages === true)}">` +
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
