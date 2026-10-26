import { isUuid } from "@/lib/uuid";
import type { Preset } from "./presets";
import type { PresetReportSpec } from "./spec";

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const uuids = (sp: URLSearchParams, key: string) => [...new Set(sp.getAll(key).filter(isUuid))];

/**
 * Monta a spec de um relatório pronto a partir dos filtros da URL. Devolve null quando falta um parâmetro
 * obrigatório (o funil de "Conversão por etapa") e não há padrão para usar.
 */
export function presetSpecFromQuery(
  preset: Preset,
  sp: URLSearchParams,
  defaultPipeline: string | null,
): PresetReportSpec | null {
  const spec: PresetReportSpec = { kind: preset.key, chart: preset.chart };

  if (preset.params.some((p) => p.key === "pipeline")) {
    const pipeline = isUuid(sp.get("funil")) ? sp.get("funil")! : defaultPipeline;
    if (!pipeline) return null;
    const params: Record<string, unknown> = { pipeline };
    const group = sp.get("agrupar");
    if (group === "owner" || group === "month") params.group_by = group;
    spec.params = params;
  }

  const filters: { field: string; op: "in"; value: string[] }[] = [];
  const add = (field: string, key: string) => {
    const ids = uuids(sp, key);
    if (preset.filters.includes(field as never) && ids.length > 0) filters.push({ field, op: "in", value: ids });
  };
  add("company", "empresa");
  add("owner", "owner");
  add("team", "team");
  if (!spec.params) add("pipeline", "funil");
  if (filters.length > 0) spec.filters = filters;

  const from = sp.get("de");
  const to = sp.get("ate");
  if (preset.usesPeriod && from && to && DAY.test(from) && DAY.test(to) && from <= to) {
    spec.period = { from, to };
  }
  return spec;
}
