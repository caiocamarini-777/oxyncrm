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

/** Assunto RFC 2047: =?UTF-8?B?...?= em pedaços de até 45 bytes (limite de 75 caracteres por palavra). */
function encodeWords(value: string): string {
  if (ASCII.test(value)) return value;
  const chunks: string[] = [];
  let cur = "";
  for (const ch of value) {
    if (Buffer.byteLength(cur + ch, "utf8") > 45) {
      chunks.push(cur);
      cur = "";
    }
    cur += ch;
  }
  if (cur) chunks.push(cur);
  return chunks.map((c) => `=?UTF-8?B?${Buffer.from(c, "utf8").toString("base64")}?=`).join("\r\n ");
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
  const head: string[] = [`From: ${encodeAddress(input.from)}`, `To: ${input.to.map(encodeAddress).join(", ")}`];
  if (input.cc?.length) head.push(`Cc: ${input.cc.map(encodeAddress).join(", ")}`);
  head.push(`Subject: ${encodeWords(oneLine(input.subject))}`);
  if (input.inReplyTo) head.push(`In-Reply-To: ${oneLine(input.inReplyTo)}`);
  if (input.references) head.push(`References: ${oneLine(input.references)}`);
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
