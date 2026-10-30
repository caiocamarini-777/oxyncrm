// Helpers puros das telas analíticas do Financeiro (Projeção, Clientes, Serviços, Custos).
import type { EntryLite } from "./calc";
import { shareBy } from "./calc";

/** Primeiro dia do mês `month` ('YYYY-MM-DD') deslocado de `n` meses. */
export function addMonths(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 10);
}

/** Meses ('YYYY-MM-01') de `from` até `to`, inclusive. */
export function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  const end = `${to.slice(0, 7)}-01`;
  for (let m = `${from.slice(0, 7)}-01`; m <= end; m = addMonths(m, 1)) out.push(m);
  return out;
}

function lastDayOfMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

export type ContractLineInput = {
  organizationId: string | null;
  endRule: "ends" | "auto_renew" | "renew_adjust" | "confirm" | null;
  amount: number;
  firstMonth: string;
  months: number;
  contractId: string;
};

export type ClientContractInfo = {
  mrr: number;
  /** Último dia da vigência: o fim do último mês coberto pelas linhas recorrentes. */
  endsOn: string | null;
  endRule: ContractLineInput["endRule"];
};

/** MRR atual (linhas ativas no mês corrente) e fim da vigência por cliente. */
export function clientContractInfo(lines: ContractLineInput[], today: string): Map<string, ClientContractInfo> {
  const current = `${today.slice(0, 7)}-01`;
  const out = new Map<string, ClientContractInfo>();
  for (const l of lines) {
    if (!l.organizationId) continue;
    const info = out.get(l.organizationId) ?? { mrr: 0, endsOn: null, endRule: null };
    const lastMonth = addMonths(l.firstMonth, l.months - 1);
    if (l.firstMonth <= current && current <= lastMonth) info.mrr = Math.round((info.mrr + l.amount) * 100) / 100;
    const endsOn = lastDayOfMonth(lastMonth);
    if (info.endsOn === null || endsOn > info.endsOn) {
      info.endsOn = endsOn;
      info.endRule = l.endRule;
    }
    out.set(l.organizationId, info);
  }
  return out;
}

function addDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** Vigência termina de hoje até daqui a `days` dias. */
export function endsWithin(endsOn: string | null, today: string, days = 90): boolean {
  return endsOn !== null && endsOn >= today && endsOn <= addDays(today, days);
}

/** Participação por chave, só da direção pedida (shareBy não filtra direção). */
export function shareOfDirection(
  entries: EntryLite[],
  direction: "in" | "out",
  key: "organizationId" | "serviceCategoryId" | "expenseCategoryId",
) {
  return shareBy(entries.filter((e) => e.direction === direction), key);
}

/** 0,6 -> "60,0%". */
export function formatShare(share: number): string {
  return `${(share * 100).toFixed(1).replace(".", ",")}%`;
}

/** 12,345 -> "12,3 meses"; null -> "—". */
export function formatCoverage(months: number | null): string {
  return months === null ? "—" : `${months.toFixed(1).replace(".", ",")} meses`;
}

/** Lançamentos que contam nas análises: em aberto de meses já encerrados ficam de fora (como na projeção). */
export function countableEntries<T extends EntryLite>(entries: T[], today: string): T[] {
  const current = `${today.slice(0, 7)}-01`;
  return entries.filter((e) => !(e.status === "open" && e.competence < current));
}
