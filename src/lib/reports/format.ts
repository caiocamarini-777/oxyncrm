import { TZ } from "@/lib/activities/time";

export type CellType = "currency" | "number" | "percent" | "days" | "month" | "text" | "date";

const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

const currencyFmt = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const numberFmt = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 });
const percentFmt = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const daysFmt = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });
const dateFmt = new Intl.DateTimeFormat("pt-BR", {
  timeZone: TZ,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

const DAY_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Formata o valor de uma célula do resultado pelo tipo da coluna (pt-BR, fuso de São Paulo). */
export function formatCell(value: unknown, type: CellType | string): string {
  switch (type) {
    case "currency": {
      const n = toNumber(value);
      return n === null ? "0" : currencyFmt.format(n);
    }
    case "number": {
      const n = toNumber(value);
      return n === null ? "0" : numberFmt.format(n);
    }
    case "percent": {
      const n = toNumber(value);
      return `${percentFmt.format(n ?? 0)}%`;
    }
    case "days": {
      const n = toNumber(value);
      if (n === null) return "0";
      return `${daysFmt.format(n)} ${n === 1 ? "dia" : "dias"}`;
    }
    case "month": {
      if (value === null || value === undefined || value === "") return "";
      const m = DAY_ONLY.exec(String(value));
      if (!m) return String(value);
      return `${MONTHS[Number(m[2]) - 1] ?? m[2]}/${m[1]}`;
    }
    case "date": {
      if (value === null || value === undefined || value === "") return "";
      const s = String(value);
      const m = DAY_ONLY.exec(s);
      if (m) return `${m[3]}/${m[2]}/${m[1]}`;
      const d = new Date(s);
      return Number.isNaN(d.getTime()) ? s : dateFmt.format(d);
    }
    default:
      return value === null || value === undefined ? "" : String(value);
  }
}
