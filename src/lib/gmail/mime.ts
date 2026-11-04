import { randomBytes } from "node:crypto";

export type MimeInput = {
  from: string;
  to: string[];
  cc?: string[];
  subject: string;
  text: string;
  html: string;
  inReplyTo?: string;
  references?: string;
};

export function toBase64Url(s: string): string {
  return Buffer.from(s, "utf8").toString("base64url");
}

const ASCII = /^[\x00-\x7F]*$/;

/** Cabeçalho em uma linha só: quebra de linha num valor permitiria injetar outros cabeçalhos. */
const oneLine = (s: string) => s.replace(/[\r\n]+/g, " ").trim();

/** Linha de cabeçalho dobrada: até 78 caracteres por linha (RFC 5322 2.1.1). */
export const HEADER_LINE_MAX = 78;

/**
 * Monta `Nome: valor` dobrando nas linhas de até 78 caracteres: a quebra (CRLF) entra antes de um espaço
 * que já existe, então desdobrar devolve o valor original. Um trecho sem espaço maior que a linha fica
 * inteiro (o limite rígido é 998).
 */
export function foldHeader(name: string, value: string): string {
  const words = value.split(" ");
  const lines: string[] = [];
  let cur = `${name}: ${words[0]}`;
  for (const w of words.slice(1)) {
    // Nunca quebra antes de palavra vazia: a linha de continuação não pode ser só espaço.
    if (w !== "" && cur.length + 1 + w.length > HEADER_LINE_MAX) {
      lines.push(cur);
      cur = ` ${w}`;
    } else {
      cur += ` ${w}`;
    }
  }
  lines.push(cur);
  return lines.join("\r\n");
}

/**
 * RFC 2047: =?UTF-8?B?...?= em pedaços de até 42 bytes (palavras de até 68 caracteres, que cabem numa
 * linha com "Subject: "), separados por espaço para `foldHeader` quebrar entre eles.
 */
function encodeWords(value: string): string {
  if (ASCII.test(value)) return value;
  const chunks: string[] = [];
  let cur = "";
  for (const ch of value) {
    if (Buffer.byteLength(cur + ch, "utf8") > 42) {
      chunks.push(cur);
      cur = "";
    }
    cur += ch;
  }
  if (cur) chunks.push(cur);
  return chunks.map((c) => `=?UTF-8?B?${Buffer.from(c, "utf8").toString("base64")}?=`).join(" ");
}

/** Codifica só o nome de "Nome <a@b.com>" quando tem acento. */
function encodeAddress(addr: string): string {
  const a = oneLine(addr);
  const m = /^(.*?)\s*<([^<>]+)>$/.exec(a);
  if (!m || ASCII.test(m[1])) return a;
  const name = m[1].replace(/^"|"$/g, "");
  return `${encodeWords(name)} <${m[2]}>`;
}

/** Base64 em linhas de 76 caracteres, com CRLF. */
function wrap64(s: string): string {
  const b = Buffer.from(s, "utf8").toString("base64");
  return (b.match(/.{1,76}/g) ?? []).join("\r\n");
}

/** Monta a mensagem RFC 5322 (CRLF, UTF-8, multipart/alternative com texto e HTML). */
export function buildMime(input: MimeInput): string {
  const boundary = `oxyn_${randomBytes(12).toString("hex")}`;
  const head: string[] = [
    foldHeader("From", encodeAddress(input.from)),
    foldHeader("To", input.to.map(encodeAddress).join(", ")),
  ];
  if (input.cc?.length) head.push(foldHeader("Cc", input.cc.map(encodeAddress).join(", ")));
  head.push(foldHeader("Subject", encodeWords(oneLine(input.subject))));
  if (input.inReplyTo) head.push(`In-Reply-To: ${oneLine(input.inReplyTo)}`);
  if (input.references) head.push(foldHeader("References", oneLine(input.references)));
  head.push("MIME-Version: 1.0", `Content-Type: multipart/alternative; boundary="${boundary}"`);

  const part = (type: string, body: string) =>
    [
      `--${boundary}`,
      `Content-Type: ${type}; charset="UTF-8"`,
      "Content-Transfer-Encoding: base64",
      "",
      wrap64(body),
    ].join("\r\n");

  return [...head, "", part("text/plain", input.text), part("text/html", input.html), `--${boundary}--`, ""].join(
    "\r\n",
  );
}
