import { type Address, decodeHeaderWords, parseAddressList } from "./addresses";

/** Mensagem como a API v1 do Gmail devolve (format=full). */
export type GmailMessagePart = {
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: { name: string; value: string }[];
  body?: { attachmentId?: string; size?: number; data?: string };
  parts?: GmailMessagePart[];
};

export type GmailMessage = {
  id: string;
  threadId: string;
  historyId?: string;
  /** Milissegundos desde 1970, como texto. */
  internalDate?: string;
  snippet?: string;
  labelIds?: string[];
  payload?: GmailMessagePart;
};

export type ParsedAttachment = {
  filename: string;
  mimeType: string;
  size: number;
  attachmentId: string | null;
};

export type ParsedMessage = {
  gmailId: string;
  threadId: string;
  rfcMessageId: string | null;
  subject: string;
  from: Address;
  to: Address[];
  cc: Address[];
  sentAt: string;
  snippet: string;
  html: string | null;
  text: string | null;
  attachments: ParsedAttachment[];
  historyId: string | null;
};

/** HTML maior que isso não é guardado (o texto fica). */
export const MAX_HTML_BYTES = 512 * 1024;

function header(part: GmailMessagePart | undefined, name: string): string {
  const n = name.toLowerCase();
  return part?.headers?.find((h) => h.name.toLowerCase() === n)?.value ?? "";
}

function charsetOf(part: GmailMessagePart): string {
  const m = /charset\s*=\s*"?([^";\s]+)"?/i.exec(header(part, "content-type"));
  return m ? m[1].toLowerCase() : "utf-8";
}

/** base64url -> texto. Usa o charset da parte; cai em UTF-8 se for desconhecido. */
function decodeBody(data: string, charset: string): string {
  const bytes = Buffer.from(data, "base64url");
  try {
    return new TextDecoder(charset).decode(bytes);
  } catch {
    return bytes.toString("utf8");
  }
}

type Walk = { html: string | null; text: string | null; attachments: ParsedAttachment[] };

function walk(part: GmailMessagePart, acc: Walk): void {
  const mime = (part.mimeType ?? "").toLowerCase();
  if (part.filename) {
    acc.attachments.push({
      filename: part.filename,
      mimeType: part.mimeType ?? "application/octet-stream",
      size: part.body?.size ?? 0,
      attachmentId: part.body?.attachmentId ?? null,
    });
  } else if (part.body?.data !== undefined) {
    // O primeiro text/plain e o primeiro text/html valem; o resto é alternativa repetida.
    if (mime === "text/html" && acc.html === null) acc.html = decodeBody(part.body.data, charsetOf(part));
    else if (mime === "text/plain" && acc.text === null) acc.text = decodeBody(part.body.data, charsetOf(part));
  }
  for (const child of part.parts ?? []) walk(child, acc);
}

export function parseGmailMessage(msg: GmailMessage): ParsedMessage {
  const payload = msg.payload;
  const acc: Walk = { html: null, text: null, attachments: [] };
  if (payload) walk(payload, acc);

  let html = acc.html;
  if (html !== null && Buffer.byteLength(html, "utf8") > MAX_HTML_BYTES) html = null;

  const from = parseAddressList(header(payload, "from"))[0] ?? { email: "", name: null };
  const ms = Number(msg.internalDate);

  return {
    gmailId: msg.id,
    threadId: msg.threadId,
    rfcMessageId: header(payload, "message-id").trim() || null,
    subject: decodeHeaderWords(header(payload, "subject")).trim(),
    from,
    to: parseAddressList(header(payload, "to")),
    cc: parseAddressList(header(payload, "cc")),
    sentAt: new Date(Number.isFinite(ms) ? ms : 0).toISOString(),
    snippet: msg.snippet ?? "",
    html,
    text: acc.text,
    attachments: acc.attachments,
    historyId: msg.historyId ?? null,
  };
}
