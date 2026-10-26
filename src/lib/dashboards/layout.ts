export const MIN_COLS = 1;
export const MAX_COLS = 4;
export const MIN_ROWS = 1;
export const MAX_ROWS = 3;

export type Spans = { colSpan: number; rowSpan: number };

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

export function clampSpans(colSpan: number, rowSpan: number): Spans {
  return { colSpan: clamp(Math.round(colSpan), MIN_COLS, MAX_COLS), rowSpan: clamp(Math.round(rowSpan), MIN_ROWS, MAX_ROWS) };
}

/** Novo tamanho (em células) depois de arrastar a alça por `deltaPx`; células de `cellPx` pixels. */
export function snapSpan(start: number, deltaPx: number, cellPx: number, min: number, max: number): number {
  if (!(cellPx > 0)) return clamp(start, min, max);
  return clamp(start + Math.round(deltaPx / cellPx), min, max);
}

/** Atalho de teclado da alça: setas ajustam largura e altura; outra tecla não faz nada (null). */
export function keyResize(s: Spans, key: string): Spans | null {
  switch (key) {
    case "ArrowRight":
      return clampSpans(s.colSpan + 1, s.rowSpan);
    case "ArrowLeft":
      return clampSpans(s.colSpan - 1, s.rowSpan);
    case "ArrowDown":
      return clampSpans(s.colSpan, s.rowSpan + 1);
    case "ArrowUp":
      return clampSpans(s.colSpan, s.rowSpan - 1);
    default:
      return null;
  }
}
