// Datas puras do Financeiro (strings ISO, fuso America/Sao_Paulo).

export function todaySaoPaulo(): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
}

/** Primeiro e último dia do mês `ym` ('YYYY-MM') deslocado de `delta` meses. */
export function monthRange(ym: string, delta = 0): { from: string; to: string } {
  const [y, m] = ym.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1 + delta, 1));
  const last = new Date(Date.UTC(y, m + delta, 0));
  return { from: first.toISOString().slice(0, 10), to: last.toISOString().slice(0, 10) };
}

const MONTH_NAMES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

export function monthLabel(date: string): string {
  const [y, m] = date.split("-").map(Number);
  return `${MONTH_NAMES[m - 1]} de ${y}`;
}

export function weekdayShort(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"][new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}
