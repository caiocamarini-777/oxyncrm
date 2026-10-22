const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

const dateFmt = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: "America/Sao_Paulo",
});

const moneyFmt = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

/** dd/mm/aaaa. Datas puras (aaaa-mm-dd) não sofrem deslocamento de fuso. */
export function formatDate(iso: string | null): string {
  if (!iso) return "";
  if (DATE_ONLY.test(iso)) {
    const [y, m, d] = iso.split("-");
    return `${d}/${m}/${y}`;
  }
  const dt = new Date(iso);
  return Number.isNaN(dt.getTime()) ? "" : dateFmt.format(dt);
}

export function formatMoney(value: number | null): string {
  return value === null || value === undefined ? "" : moneyFmt.format(value);
}

const compactFmt = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  notation: "compact",
  minimumFractionDigits: 0,
  maximumFractionDigits: 1,
});

/** BRL compacto para somas ("R$ 125 mil", "R$ 1,5 mi"); abaixo de mil, sem centavos. */
export function formatMoneyCompact(value: number): string {
  return compactFmt.format(Math.abs(value) < 1000 ? Math.round(value) : value);
}

export function normalizeEmail(v: string): string {
  return v.trim().toLowerCase();
}

/** Só dígitos, na forma nacional: `+55 11 99999-0000` e `(11) 99999-0000` dão o mesmo valor. */
export function normalizePhone(v: string): string {
  return v.replace(/\D/g, "").replace(/^55(?=\d{10,11}$)/, "");
}

export function formatPhone(v: string): string {
  const d = normalizePhone(v);
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return d;
}

/**
 * Texto BRL ("1.500,25" / "1500.25") para número; vazio vira null; ilegível vira NaN.
 * Com vírgula, o ponto é separador de milhar; sem vírgula, o ponto é decimal.
 */
export function parseBRL(raw: string): number | null {
  const v = raw.trim();
  const t = v.includes(",") ? v.replace(/\./g, "").replace(",", ".") : v;
  if (t === "") return null;
  return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : Number.NaN;
}
