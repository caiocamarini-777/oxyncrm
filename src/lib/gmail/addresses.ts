export const GENERIC_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "hotmail.com",
  "outlook.com",
  "live.com",
  "yahoo.com",
  "yahoo.com.br",
  "icloud.com",
  "me.com",
  "uol.com.br",
  "bol.com.br",
  "terra.com.br",
  "ig.com.br",
  "msn.com",
  "protonmail.com",
]);

export type Address = { email: string; name: string | null };

/** Domínio de um e-mail, em minúsculo ("" se não houver @). */
export function domainOf(email: string): string {
  const i = email.lastIndexOf("@");
  return i < 0 ? "" : email.slice(i + 1).trim().toLowerCase();
}

/** Decodifica palavras codificadas (RFC 2047) de um cabeçalho: =?UTF-8?B?...?= e =?UTF-8?Q?...?=. */
export function decodeHeaderWords(value: string): string {
  const joined = value.replace(/(=\?[^?]+\?[bBqQ]\?[^?]*\?=)\s+(?==\?[^?]+\?[bBqQ]\?)/g, "$1");
  return joined.replace(/=\?([^?]+)\?([bBqQ])\?([^?]*)\?=/g, (whole, charset: string, enc: string, text: string) => {
    try {
      const bytes =
        enc.toUpperCase() === "B"
          ? Buffer.from(text, "base64")
          : Buffer.from(
              text
                .replace(/_/g, " ")
                .replace(/=([0-9A-Fa-f]{2})/g, (_m, h: string) => String.fromCharCode(parseInt(h, 16))),
              "latin1",
            );
      return new TextDecoder(charset.toLowerCase()).decode(bytes);
    } catch {
      return whole;
    }
  });
}

/** Divide pelas vírgulas que ficam fora de aspas, de <...> e de (...). */
function splitTopLevel(header: string): string[] {
  const parts: string[] = [];
  let cur = "";
  let quoted = false;
  let angle = 0;
  let paren = 0;
  for (let i = 0; i < header.length; i++) {
    const ch = header[i];
    if (quoted) {
      cur += ch;
      if (ch === "\\" && i + 1 < header.length) cur += header[++i];
      else if (ch === '"') quoted = false;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === "<") angle++;
    else if (ch === ">") angle = Math.max(0, angle - 1);
    else if (ch === "(") paren++;
    else if (ch === ")") paren = Math.max(0, paren - 1);
    if ((ch === "," || ch === ";") && !angle && !paren) {
      parts.push(cur);
      cur = "";
    } else cur += ch;
  }
  parts.push(cur);
  return parts;
}

const EMAIL = /^[^\s<>@",;]+@[^\s<>@",;]+$/;

function cleanName(raw: string): string | null {
  let n = raw.trim();
  if (n.startsWith('"') && n.endsWith('"') && n.length >= 2) {
    n = n.slice(1, -1).replace(/\\(.)/g, "$1");
  }
  n = decodeHeaderWords(n).trim();
  return n || null;
}

const GROUP_PREFIX = /^\s*(?:"(?:[^"\\]|\\.)*"|[^<>@",;:"]+):/;

/** Lê um cabeçalho To/Cc/From: "Nome, Sobrenome" <a@b.com>, a@b.com, Nome <A@B.com>. E-mail sai em minúsculo. */
export function parseAddressList(header: string): Address[] {
  const out: Address[] = [];
  for (const part of splitTopLevel(header ?? "")) {
    // Sintaxe de grupo ("Equipe: a@b.com, c@d.com;"): tira o prefixo "nome:" do primeiro membro.
    const p = part.replace(GROUP_PREFIX, "").trim();
    if (!p) continue;
    const open = p.lastIndexOf("<");
    const close = p.lastIndexOf(">");
    if (open >= 0 && close > open) {
      const email = p.slice(open + 1, close).trim().toLowerCase();
      if (!EMAIL.test(email)) continue;
      out.push({ email, name: cleanName(p.slice(0, open)) });
    } else {
      const bare = p.replace(/\([^)]*\)/g, "").trim().toLowerCase();
      if (EMAIL.test(bare)) out.push({ email: bare, name: null });
    }
  }
  return out;
}
