import { z } from "zod";
import { REQUIRED_FIELD_OPTIONS } from "@/lib/deals/required";

export const NEXT_ACTIVITY_RULES = ["off", "suggest", "require"] as const;
export const NEXT_ACTIVITY_LABELS = { off: "Desligada", suggest: "Sugerir", require: "Obrigar" } as const;
export const CARD_VALUE_FIELDS = ["total", "mrr", "setup"] as const;
export const CARD_VALUE_LABELS = { total: "Valor total", mrr: "MRR", setup: "Setup" } as const;

export const pipelineSchema = z.object({
  name: z.string().trim().min(1, "Informe o nome do funil.").max(80, "Use no máximo 80 caracteres."),
  nextActivityRule: z.enum(NEXT_ACTIVITY_RULES, { message: "Escolha uma regra." }),
  cardValueField: z.enum(CARD_VALUE_FIELDS, { message: "Escolha o campo do card." }),
});
export type PipelineInput = z.input<typeof pipelineSchema>;

const FIXED_KEYS: string[] = REQUIRED_FIELD_OPTIONS.map((o) => o.key);

/** `activeCustomKeys`: chaves dos campos personalizados ativos de negócios da empresa. */
export function stageSchemaFor(activeCustomKeys: string[]) {
  return z.object({
    name: z.string().trim().min(1, "Informe o nome da etapa.").max(60, "Use no máximo 60 caracteres."),
    probability: z
      .number({ message: "Informe a probabilidade." })
      .int("Use um número inteiro.")
      .min(0, "A probabilidade vai de 0 a 100.")
      .max(100, "A probabilidade vai de 0 a 100."),
    rottingDays: z
      .preprocess(
        (v) => (v === "" || v === undefined || v === null ? null : typeof v === "string" ? Number(v.trim()) : v),
        z
          .number({ message: "Informe de 1 a 365 dias." })
          .int("Informe de 1 a 365 dias.")
          .min(1, "Informe de 1 a 365 dias.")
          .max(365, "Informe de 1 a 365 dias.")
          .nullable(),
      ),
    requiredFields: z
      .array(z.string())
      .default([])
      .refine(
        (list) =>
          list.every((k) =>
            k.startsWith("cf:") ? activeCustomKeys.includes(k.slice(3)) : FIXED_KEYS.includes(k),
          ),
        "Campo obrigatório inválido.",
      )
      .transform((list) => [...new Set(list)]),
  });
}
export const stageSchema = stageSchemaFor([]);
export type StageInput = z.input<ReturnType<typeof stageSchemaFor>>;
