import { isUuid } from "@/lib/uuid";

/** Filtros de um dashboard como a tela os guarda. */
export type DashboardFilters = {
  company?: string[];
  owner?: string[];
  team?: string[];
  period?: { from: string; to: string } | null;
};

export type WidgetFilters = {
  company?: string[];
  owner?: string[];
  team?: string[];
  period?: { from: string; to: string };
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
  for (const key of ["company", "owner", "team"] as const) {
    const value = f[key];
    if (value === undefined || value === null) continue;
    out[key] = [...new Set((Array.isArray(value) ? value : []).filter(isUuid))];
  }
  if (f.period && DAY.test(f.period.from) && DAY.test(f.period.to)) {
    out.period = { from: f.period.from, to: f.period.to };
  }
  return out;
}

/** URL pública de um link de compartilhamento. */
export function shareUrl(site: string, token: string): string {
  return `${site.replace(/\/$/, "")}/d/${token}`;
}
