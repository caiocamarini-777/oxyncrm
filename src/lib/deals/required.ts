import type { CustomFieldDef } from "@/lib/custom-fields/schema";

export const REQUIRED_FIELD_OPTIONS = [
  { key: "expected_close_date", label: "Data de fechamento esperada" },
  { key: "person_id", label: "Pessoa" },
  { key: "organization_id", label: "Organização" },
  { key: "estimated_value", label: "Valor estimado" },
  { key: "contract", label: "Condições de contrato" },
  { key: "products", label: "Produtos" },
] as const;

export type RequiredFieldKey = (typeof REQUIRED_FIELD_OPTIONS)[number]["key"];

export function requiredFieldLabel(key: string, customDefs: Pick<CustomFieldDef, "key" | "label">[] = []): string {
  const fixed = REQUIRED_FIELD_OPTIONS.find((o) => o.key === key);
  if (fixed) return fixed.label;
  if (key.startsWith("cf:")) {
    const def = customDefs.find((d) => d.key === key.slice(3));
    if (def) return def.label;
  }
  return key;
}

/** DETAIL de OXYN_REQUIRED_FIELDS: chaves separadas por vírgula. */
export function parseMissingFields(detail: string): string[] {
  return detail
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "");
}
