import { createHash, timingSafeEqual } from "node:crypto";

/** Confere `Authorization: Bearer <segredo>` em tempo constante. Sem segredo configurado, nega. */
export function isCronAuthorized(header: string | null, secret: string | undefined): boolean {
  if (!secret || !header) return false;
  const m = header.match(/^Bearer (.+)$/);
  if (!m) return false;
  // Hash fixa o tamanho dos dois lados, então timingSafeEqual não vaza o comprimento.
  const a = createHash("sha256").update(m[1]).digest();
  const b = createHash("sha256").update(secret).digest();
  return timingSafeEqual(a, b);
}
