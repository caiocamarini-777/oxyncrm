import { isUuid } from "@/lib/uuid";
import { RELATIVE_KEYS, type RelativePeriod } from "./spec";

/** Período do painel: datas fixas ou relativo (resolvido no banco). */
export type DashboardPeriod = { from: string; to: string } | { relative: RelativePeriod };

export const isRelativePeriod = (p: DashboardPeriod | null | undefined): p is { relative: RelativePeriod } =>
  !!p && "relative" in p && (RELATIVE_KEYS as readonly string[]).includes(p.relative);

/** Filtros de um dashboard como a tela os guarda. */
export type DashboardFilters = {
  company?: string[];
  owner?: string[];
  team?: string[];
  /** Funil: vale nos widgets de negócios, receita e histórico de etapas. */
  pipeline?: string[];
  period?: DashboardPeriod | null;
};

export type WidgetFilters = {
  company?: string[];
  owner?: string[];
  team?: string[];
  pipeline?: string[];
  period?: DashboardPeriod;
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Filtros enviados a run_widget. No banco, chave ausente ou nula significa "sem filtro" e lista vazia significa
 * "nada". Aqui segue-se o mesmo: chave ausente/nula é omitida; chave presente vai como lista, e se nenhum id
 * válido sobrar, vai `[]` (nunca vira "sem filtro").
 */
export function buildWidgetFilters(f: DashboardFilters | null | undefined): WidgetFilters {
  const out: WidgetFilters = {};
  if (!f) return out;
  for (const key of ["company", "owner", "team", "pipeline"] as const) {
    const value = f[key];
    if (value === undefined || value === null) continue;
    out[key] = [...new Set((Array.isArray(value) ? value : []).filter(isUuid))];
  }
  if (isRelativePeriod(f.period)) {
    out.period = { relative: f.period.relative };
  } else if (f.period && "from" in f.period && DAY.test(f.period.from) && DAY.test(f.period.to)) {
    out.period = { from: f.period.from, to: f.period.to };
  }
  return out;
}

/** URL pública de um link de compartilhamento. */
export function shareUrl(site: string, token: string): string {
  return `${site.replace(/\/$/, "")}/d/${token}`;
}
