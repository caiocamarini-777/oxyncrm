/** Leitura do catálogo de campos (o mesmo do motor): campos ligados, opções e campos de data. */
import type { Catalog, CatalogField, CatalogOption, DataType, InsightDefinition } from "./types";

export type ResolvedField = { field: CatalogField; entity: DataType; prefix: string | null };

const DATE_TYPES = new Set(["DATE", "DATE_TIME"]);

export function isDateField(f: CatalogField | undefined | null): boolean {
  return !!f && DATE_TYPES.has(f.type);
}

/** Campo da entidade (com o tipo de relatório) ou campo ligado (prefixo + campo da outra entidade). */
export function resolveField(catalog: Catalog, dataType: DataType, id: string, reportType?: string): ResolvedField | null {
  const own = catalog.fields[dataType]?.filter((f) => f.id === id) ?? [];
  const specific = own.find((f) => f.rts && reportType && f.rts.includes(reportType));
  const general = own.find((f) => !f.rts);
  if (specific || general) return { field: (specific ?? general)!, entity: dataType, prefix: null };
  for (const [prefix, target] of Object.entries(catalog.links[dataType] ?? {})) {
    if (!id.startsWith(prefix)) continue;
    const f = catalog.fields[target]?.find((x) => x.id === id.slice(prefix.length) && !x.rts && x.roles.includes("f"));
    if (f) return { field: { ...f, id }, entity: target, prefix };
  }
  return null;
}

/** Campos de uma entidade que valem no tipo de relatório e têm o papel pedido (f, g, s, m, c). */
export function fieldsWithRole(catalog: Catalog, dataType: DataType, reportType: string, role: string): CatalogField[] {
  const list = catalog.fields[dataType] ?? [];
  const out = new Map<string, CatalogField>();
  for (const f of list) {
    if (!f.roles.includes(role)) continue;
    if (f.rts && !f.rts.includes(reportType)) continue;
    if (!f.rts && out.has(f.id)) continue;
    out.set(f.id, f);
  }
  return [...out.values()];
}

/** Grupos do seletor de filtro: a própria entidade e as ligadas (como o "NEGÓCIOS ›" do Pipedrive). */
export function filterGroups(catalog: Catalog, dataType: DataType, reportType: string) {
  const groups: { entity: DataType; prefix: string; fields: CatalogField[] }[] = [
    { entity: dataType, prefix: "", fields: fieldsWithRole(catalog, dataType, reportType, "f") },
  ];
  for (const [prefix, target] of Object.entries(catalog.links[dataType] ?? {})) {
    const fields = (catalog.fields[target] ?? [])
      .filter((f) => f.roles.includes("f") && !f.rts)
      .map((f) => ({ ...f, id: prefix + f.id }));
    groups.push({ entity: target, prefix, fields });
  }
  return groups;
}

/** Colunas da lista: campos com papel c da entidade e das ligações diretas. */
export function columnGroups(catalog: Catalog, dataType: DataType) {
  const groups = [{ entity: dataType, prefix: "", fields: (catalog.fields[dataType] ?? []).filter((f) => f.roles.includes("c") && !f.rts) }];
  const direct: Record<DataType, string[]> = {
    activities: ["deal_id_", "lead_id_", "person_id_", "org_id_"],
    deals: ["lead_id_", "person_id_", "org_id_"],
    leads: ["deal_id_", "person_id_", "org_id_"],
    organizations: [],
    people: ["org_id_"],
  };
  for (const prefix of direct[dataType]) {
    const target = catalog.links[dataType]?.[prefix];
    if (!target) continue;
    groups.push({
      entity: target,
      prefix,
      fields: (catalog.fields[target] ?? []).filter((f) => f.roles.includes("c") && !f.rts).map((f) => ({ ...f, id: prefix + f.id })),
    });
  }
  return groups;
}

/** Opções de um campo: lista fixa ou fonte do catálogo (usuários, etapas...). Busca (orgs, pessoas) fica de fora. */
export function optionsFor(catalog: Catalog, field: CatalogField): CatalogOption[] | null {
  if (Array.isArray(field.opts)) return field.opts.map(([id, label]) => ({ id, label }));
  if (field.type === "BOOLEAN") return [{ id: "true", label: "Sim" }, { id: "false", label: "Não" }];
  if (!field.opts) return null;
  if (["orgs", "persons", "deals", "leads"].includes(field.opts)) return null;
  return catalog.options[field.opts] ?? [];
}

/** Fonte de busca para campos de organização, pessoa, negócio e lead. */
export function searchKind(field: CatalogField): "orgs" | "persons" | "deals" | "leads" | null {
  return typeof field.opts === "string" && ["orgs", "persons", "deals", "leads"].includes(field.opts)
    ? (field.opts as "orgs" | "persons" | "deals" | "leads")
    : null;
}

/** Ids dos campos de data do relatório que têm período (os que o filtro de período do painel substitui). */
export function periodFilterIds(catalog: Catalog, def: InsightDefinition): string[] {
  return def.parameters.filter_by
    .filter((f) => f.period !== null && isDateField(resolveField(catalog, def.data_type, f.filter, def.report_type)?.field))
    .map((f) => f.filter);
}
