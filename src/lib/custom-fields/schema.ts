import { z } from "zod";
import { isUuid } from "@/lib/uuid";

export const CUSTOM_FIELD_TYPES = [
  "text",
  "number",
  "money",
  "date",
  "select",
  "multiselect",
  "user",
] as const;
export type CustomFieldType = (typeof CUSTOM_FIELD_TYPES)[number];

export const CUSTOM_FIELD_TYPE_LABELS: Record<CustomFieldType, string> = {
  text: "Texto",
  number: "Número",
  money: "Valor em reais",
  date: "Data",
  select: "Seleção única",
  multiselect: "Seleção múltipla",
  user: "Usuário",
};

export const CUSTOM_FIELD_ENTITIES_PHASE2 = ["organizations", "persons", "leads", "deals"] as const;
export type CustomFieldEntity = (typeof CUSTOM_FIELD_ENTITIES_PHASE2)[number];

export const CUSTOM_FIELD_ENTITY_LABELS: Record<CustomFieldEntity, string> = {
  organizations: "Organizações",
  persons: "Pessoas",
  leads: "Leads",
  deals: "Negócios",
};

export const LABEL_COLORS = ["teal", "blue", "green", "red", "gray", "purple"] as const;
export type LabelColor = (typeof LABEL_COLORS)[number];

export const LABEL_COLOR_NAMES: Record<LabelColor, string> = {
  teal: "Azul-petróleo",
  blue: "Azul",
  green: "Verde",
  red: "Vermelho",
  gray: "Cinza",
  purple: "Roxo",
};

export type CustomFieldDef = {
  key: string;
  label: string;
  type: CustomFieldType;
  options: string[];
};

const MAX_KEY = 40;

export function slugifyKey(label: string): string {
  let s = label
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (s === "") s = "campo";
  if (/^[0-9]/.test(s)) s = `campo_${s}`;
  return s.slice(0, MAX_KEY).replace(/_+$/g, "");
}

export const customFieldDefSchema = z
  .object({
    label: z
      .string()
      .trim()
      .min(1, "Informe o nome do campo.")
      .max(60, "Use no máximo 60 caracteres."),
    type: z.enum(CUSTOM_FIELD_TYPES),
    options: z
      .array(z.string().trim().min(1, "Opção vazia.").max(60, "Use no máximo 60 caracteres."))
      .default([]),
  })
  .superRefine((v, ctx) => {
    if (v.type !== "select" && v.type !== "multiselect") return;
    if (v.options.length < 1) {
      ctx.addIssue({ code: "custom", path: ["options"], message: "Informe pelo menos uma opção." });
      return;
    }
    if (new Set(v.options).size !== v.options.length) {
      ctx.addIssue({ code: "custom", path: ["options"], message: "As opções não podem se repetir." });
    }
  })
  .transform((v) => ({
    label: v.label,
    type: v.type,
    key: slugifyKey(v.label),
    options: v.type === "select" || v.type === "multiselect" ? v.options : [],
  }));
export type CustomFieldDefInput = z.input<typeof customFieldDefSchema>;

export const customFieldUpdateSchema = z
  .object({
    label: z.string().trim().min(1, "Informe o nome do campo.").max(60, "Use no máximo 60 caracteres."),
    options: z
      .array(z.string().trim().min(1, "Opção vazia.").max(60, "Use no máximo 60 caracteres."))
      .default([]),
    position: z.number().int().min(0).optional(),
  })
  .superRefine((v, ctx) => {
    if (new Set(v.options).size !== v.options.length) {
      ctx.addIssue({ code: "custom", path: ["options"], message: "As opções não podem se repetir." });
    }
  });

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function validDate(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function valueOk(def: CustomFieldDef, v: unknown, memberIds: string[]): boolean {
  switch (def.type) {
    case "text":
      return typeof v === "string" && [...v].length <= 2000;
    case "number":
    case "money":
      return typeof v === "number" && Number.isFinite(v);
    case "date":
      return typeof v === "string" && validDate(v);
    case "select":
      return typeof v === "string" && def.options.includes(v);
    case "multiselect":
      return Array.isArray(v) && v.every((e) => typeof e === "string" && def.options.includes(e));
    case "user":
      return isUuid(v) && memberIds.includes(v.toLowerCase());
  }
}

/** Espelha public.validate_custom_fields; `memberIds` são os usuários válidos do tipo `user`. */
export function validateCustomFieldValues(
  defs: CustomFieldDef[],
  values: Record<string, unknown>,
  memberIds: string[] = [],
): { ok: true } | { ok: false; key: string; message: string } {
  const members = memberIds.map((m) => m.toLowerCase());
  for (const [key, v] of Object.entries(values)) {
    const def = defs.find((d) => d.key === key);
    if (!def) return { ok: false, key, message: "Campo desconhecido." };
    if (v === null) continue;
    if (!valueOk(def, v, members)) {
      return { ok: false, key, message: `Valor inválido para "${def.label}".` };
    }
  }
  return { ok: true };
}
