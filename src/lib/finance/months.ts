// Meses 'YYYY-MM' (ou 'YYYY-MM-DD'): cálculos puros para vigências.

/** Quantidade de meses de `start` a `end`, inclusive: 2026-11..2027-10 = 12. */
export function monthCount(start: string, end: string): number {
  const [y1, m1] = start.split("-").map(Number);
  const [y2, m2] = end.split("-").map(Number);
  return (y2 - y1) * 12 + (m2 - m1) + 1;
}

/** 'YYYY-MM' deslocado de `delta` meses. */
export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}

/** 'mm/aaaa' a partir de qualquer data do mês. */
export function formatMonth(date: string): string {
  const [y, m] = date.split("-");
  return `${m}/${y}`;
}

type VigenciaLine = { kind: string; firstMonth: string; installments: number; months: number | null };

/** Vigência do contrato: do menor início ao maior fim das linhas ('YYYY-MM'); null sem linhas. */
export function contractVigencia(lines: VigenciaLine[]): { start: string; end: string } | null {
  let start: string | null = null;
  let end: string | null = null;
  for (const l of lines) {
    const first = l.firstMonth.slice(0, 7);
    const last = shiftMonth(first, (l.kind === "setup" ? l.installments : (l.months ?? 1)) - 1);
    if (start === null || first < start) start = first;
    if (end === null || last > end) end = last;
  }
  return start && end ? { start, end } : null;
}

/** "Vigência: mm/aaaa – mm/aaaa". */
export function vigenciaLabel(v: { start: string; end: string } | null): string {
  return v ? `Vigência: ${formatMonth(v.start)} – ${formatMonth(v.end)}` : "Vigência: —";
}
