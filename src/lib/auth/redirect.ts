/** Aceita só caminhos internos; qualquer outra coisa vira "/". */
export function safeNext(next: string | null | undefined): string {
  if (!next || !next.startsWith("/")) return "/";
  if (/[\x00-\x1f\\]/.test(next)) return "/";
  try {
    const u = new URL(next, "http://x");
    if (u.origin !== "http://x") return "/";
    return u.pathname + u.search + u.hash;
  } catch {
    return "/";
  }
}
