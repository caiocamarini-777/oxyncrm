/** Aceita só caminhos internos; qualquer outra coisa vira "/". */
export function safeNext(next: string | null | undefined): string {
  if (!next) return "/";
  if (!next.startsWith("/")) return "/";
  if (next.startsWith("//") || next.startsWith("/\\")) return "/";
  return next;
}
