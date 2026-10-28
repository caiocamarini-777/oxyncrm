/** Filtros do relatório: filtro novo para um campo e o resumo em chips ("ESTE MÊS · OMNI11 · SIM"). */
import { isDateField, optionsFor, resolveField } from "./catalog";
import { PERIOD_LABEL } from "./meta";
import type { Catalog, CatalogField, InsightDefinition, InsightFilter, Operator } from "./types";

export const NO_VALUE_OPS: Operator[] = ["isEmpty", "isNotEmpty"];
export const MULTI_OPS: Operator[] = ["isAnyOf", "isNotAnyOf", "isExcluding"];

export function newFilter(field: CatalogField, id = field.id): InsightFilter {
  if (isDateField(field)) return { filter: id, type: field.type, operands: [], period: "month" };
  const op = field.type === "BOOLEAN" ? "isExactly" : (field.operators[0] ?? "isExactly");
  return {
    filter: id,
    type: field.type,
    operands: [{ name: op, defaultValue: field.type === "BOOLEAN" ? true : MULTI_OPS.includes(op) ? [] : null }],
    period: null,
  };
}

/** Valores do filtro como lista de textos (para os chips e o seletor). */
export function filterValues(f: InsightFilter): string[] {
  const o = f.operands.find((x) => x.name !== "format");
  if (!o) return [];
  const v = o.defaultValue;
  if (Array.isArray(v)) return v.map(String);
  if (v === null || v === undefined || v === "") return [];
  return [String(v)];
}

export function filterOperator(f: InsightFilter): Operator | null {
  const o = f.operands.find((x) => x.name !== "format");
  return (o?.name as Operator) ?? null;
}

/** O filtro está completo (tem valor quando o operador pede)? Os incompletos não vão para o motor. */
export function isComplete(f: InsightFilter): boolean {
  if (f.period) return f.period !== "custom" || f.operands.some((o) => o.name === "isMoreThan" || o.name === "isLessThan");
  const op = filterOperator(f);
  if (!op) return false;
  return NO_VALUE_OPS.includes(op) || filterValues(f).length > 0;
}

/** Definição só com os filtros completos (o que é executado). */
export function runnable(def: InsightDefinition): InsightDefinition {
  return { ...def, parameters: { ...def.parameters, filter_by: def.parameters.filter_by.filter(isComplete) } };
}

/** Texto do chip de um filtro, em maiúsculas como no Pipedrive. */
export function chipText(catalog: Catalog, def: InsightDefinition, f: InsightFilter, names: Record<string, string> = {}): string | null {
  const r = resolveField(catalog, def.data_type, f.filter, def.report_type);
  if (!r) return null;
  if (f.period && isDateField(r.field)) return PERIOD_LABEL[f.period].toUpperCase();
  const op = filterOperator(f);
  // "tem <registro> ligado" (vindo da etiqueta da empresa no Pipedrive): não vira chip, como lá
  if (op === "isNotEmpty" && r.prefix && ["title", "name", "subject"].includes(f.filter.slice(r.prefix.length))) return null;
  if (op === "isEmpty") return `${r.field.name} vazio`.toUpperCase();
  if (op === "isNotEmpty") return `${r.field.name} preenchido`.toUpperCase();
  const opts = optionsFor(catalog, r.field);
  const labels = filterValues(f).map((v) => opts?.find((o) => o.id === v)?.label ?? names[v] ?? v);
  if (labels.length === 0) return null;
  const text = labels.join(", ");
  return (op === "isNot" || op === "isNotAnyOf" ? `não ${text}` : text).toUpperCase();
}

export function chips(catalog: Catalog, def: InsightDefinition): string[] {
  return def.parameters.filter_by.filter(isComplete).map((f) => chipText(catalog, def, f)).filter((x): x is string => !!x);
}
