import { isRelativePeriod, type DashboardFilters } from "@/lib/reports/filters";
import { RELATIVE_KEYS, type RelativePeriod } from "@/lib/reports/spec";
import { isUuid } from "@/lib/uuid";

export const PERIOD_PRESETS = [
  { key: "month", label: "Mês atual" },
  { key: "quarter", label: "Trimestre atual" },
  { key: "30d", label: "Últimos 30 dias" },
  { key: "90d", label: "Últimos 90 dias" },
  { key: "365d", label: "Últimos 365 dias" },
] as const;
export type PeriodPresetKey = (typeof PERIOD_PRESETS)[number]["key"];

const DAY = /^\d{4}-\d{2}-\d{2}$/;

function parseDay(key: string): Date | null {
  if (!DAY.test(key)) return null;
  const d = new Date(`${key}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== key ? null : d;
}
const fmt = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);

/** Intervalo (datas locais, inclusivo) de um período pronto, dado o dia de hoje (AAAA-MM-DD). */
export function periodRange(key: PeriodPresetKey, today: string): { from: string; to: string } {
  const t = parseDay(today);
  if (!t) throw new Error("Dia inválido.");
  const y = t.getUTCFullYear();
  const m = t.getUTCMonth();
  switch (key) {
    case "month":
      return { from: fmt(new Date(Date.UTC(y, m, 1))), to: fmt(new Date(Date.UTC(y, m + 1, 0))) };
    case "quarter": {
      const q = Math.floor(m / 3) * 3;
      return { from: fmt(new Date(Date.UTC(y, q, 1))), to: fmt(new Date(Date.UTC(y, q + 3, 0))) };
    }
    default: {
      const days = Number.parseInt(key, 10);
      return { from: fmt(addDays(t, -(days - 1))), to: today };
    }
  }
}

export function matchPeriodPreset(p: { from: string; to: string }, today: string): PeriodPresetKey | null {
  for (const preset of PERIOD_PRESETS) {
    const r = periodRange(preset.key, today);
    if (r.from === p.from && r.to === p.to) return preset.key;
  }
  return null;
}

export type FilterParams = {
  de?: string;
  ate?: string;
  empresa?: string;
  /** Período relativo (this_month etc.); tem precedência sobre de/ate. */
  periodo?: string;
  /** Responsável (id). */
  responsavel?: string;
  /** Funil (id). */
  funil?: string;
};

const isRelativeKey = (v: string | undefined): v is RelativePeriod =>
  !!v && (RELATIVE_KEYS as readonly string[]).includes(v);

/**
 * Filtros efetivos de um dashboard: a URL válida vale; parâmetro inválido cai no padrão do dashboard (ou em nada).
 * `companyBySlug` é nulo quando o escopo é uma empresa só (o filtro de empresa não existe).
 */
export function resolveDashboardFilters(
  params: FilterParams,
  defaults: DashboardFilters,
  companyBySlug: Map<string, string> | null,
  /** Empresa do escopo atual; quando informada, o filtro de empresa só pode restringir dentro dela. */
  scopeCompanyId?: string | null,
): DashboardFilters {
  const out: DashboardFilters = {};
  const from = params.de;
  const to = params.ate;
  const urlPeriod = isRelativeKey(params.periodo)
    ? { relative: params.periodo }
    : from && to && parseDay(from) && parseDay(to) && from <= to
      ? { from, to }
      : null;
  const fallback = defaults.period && (isRelativePeriod(defaults.period) || "from" in defaults.period) ? defaults.period : null;
  const period = urlPeriod ?? fallback;
  if (period) out.period = period;

  // Lista presente é filtro, mesmo vazia: chave ausente = sem filtro, `[]` = nada. Ids inválidos do padrão saem;
  // se nada válido sobrar, fica `[]` (nunca "sem filtro").
  const clean = (v: string[] | null | undefined): string[] | undefined =>
    v === undefined || v === null ? undefined : [...new Set((Array.isArray(v) ? v : []).filter(isUuid))];

  const slug = params.empresa;
  const urlCompany = companyBySlug && slug ? companyBySlug.get(slug) : undefined;
  let company = urlCompany ? [urlCompany] : clean(defaults.company);
  if (scopeCompanyId) {
    // Escopo de uma empresa: o filtro só restringe. Interseção com o padrão do dashboard; vazia vira `[]`.
    company = company === undefined ? [scopeCompanyId] : company.filter((c) => c === scopeCompanyId);
  }
  if (company !== undefined) out.company = company;
  for (const key of ["owner", "team", "pipeline"] as const) {
    const ids = clean(defaults[key]);
    if (ids !== undefined) out[key] = ids;
  }
  // responsável e funil da URL substituem o padrão do dashboard
  if (params.responsavel && isUuid(params.responsavel)) out.owner = [params.responsavel];
  if (params.funil && isUuid(params.funil)) out.pipeline = [params.funil];
  return out;
}
