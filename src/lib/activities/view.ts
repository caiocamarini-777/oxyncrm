import { isUuid } from "@/lib/uuid";
import { parseListQuery } from "@/lib/records/query";
import type { ListQuery } from "@/lib/records/types";
import { dayKey, monthGrid, weekGrid } from "./time";

export const VIEWS = ["lista", "semana", "mes"] as const;
export type ActivityView = (typeof VIEWS)[number];

/** `?visao=`: lista (padrão), semana ou mês. */
export function parseView(raw: string | null | undefined): ActivityView {
  return (VIEWS as readonly string[]).includes(raw ?? "") ? (raw as ActivityView) : "lista";
}

/** `?data=YYYY-MM-DD` válido, senão `fallback` (hoje em São Paulo). */
export function parseAnchor(raw: string | null | undefined, fallback: string): string {
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return fallback;
  const [y, m, d] = raw.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d ? raw : fallback;
}

export const TAB_PARAM = { overdue: "atrasadas", today: "hoje", upcoming: "proximas", done: "concluidas" } as const;
type Tab = keyof typeof TAB_PARAM;
export const DEFAULT_TAB: Tab = "today";

export type ActivityListFilters = ListQuery & { tab: Tab; type: string[]; channel: string[]; team: string[] };

const uuids = (p: URLSearchParams, key: string) => [...new Set(p.getAll(key).map((v) => v.trim()).filter(isUuid))];

/** Lista: aba (`aba`), tipos, canais e equipes, além dos filtros comuns. */
export function parseActivityListQuery(params: URLSearchParams, sorts: string[] = ["due_at", "subject", "completed_at"]): ActivityListFilters {
  const raw = params.get("aba");
  const tab = (Object.keys(TAB_PARAM) as Tab[]).find((t) => TAB_PARAM[t] === raw) ?? DEFAULT_TAB;
  return {
    ...parseListQuery(params, sorts),
    tab,
    type: uuids(params, "type"),
    channel: uuids(params, "channel"),
    team: uuids(params, "team"),
  };
}

const addDays = (key: string, n: number) => {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};

/** Semana: ±7 dias; mês: dia 1 do mês vizinho. */
export function shiftAnchor(anchor: string, view: "semana" | "mes", dir: 1 | -1): string {
  if (view === "semana") return addDays(anchor, 7 * dir);
  const [y, m] = anchor.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + dir, 1)).toISOString().slice(0, 10);
}

/** Primeiro e último dia da grade (inclusive). */
export function agendaRange(anchor: string, view: "semana" | "mes"): { from: string; to: string } {
  if (view === "semana") {
    const w = weekGrid(anchor);
    return { from: w[0], to: w[6] };
  }
  const weeks = monthGrid(anchor);
  return { from: weeks[0][0], to: weeks[weeks.length - 1][6] };
}

export function groupByDay<T extends { dueAt: string }>(rows: T[]): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const r of rows) {
    const k = dayKey(r.dueAt);
    const list = out.get(k);
    if (list) list.push(r);
    else out.set(k, [r]);
  }
  return out;
}
