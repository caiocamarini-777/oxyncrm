import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const b64u = (b: Buffer) => b.toString("base64url");

function keyOf(keyB64: string): Buffer {
  const key = Buffer.from(keyB64, "base64");
  if (key.length !== 32) throw new Error("GMAIL_TOKEN_KEY deve ter 32 bytes em base64");
  return key;
}

/** AES-256-GCM. Formato: v1.<iv>.<tag>.<dados>, tudo em base64url. */
export function encryptToken(plain: string, keyB64: string): string {
  const key = keyOf(keyB64);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", b64u(iv), b64u(cipher.getAuthTag()), b64u(data)].join(".");
}

export function decryptToken(enc: string, keyB64: string): string {
  const key = keyOf(keyB64);
  const [version, iv, tag, data] = enc.split(".");
  if (version !== "v1" || !iv || !tag || data === undefined) {
    throw new Error("Token criptografado em formato inválido");
  }
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}
