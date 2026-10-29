import { z } from "zod";
import { parseBRL } from "@/lib/records/format";

export const PRODUCT_KINDS = ["setup", "recurring"] as const;
export const PRODUCT_KIND_LABELS = { setup: "Setup", recurring: "Recorrente" } as const;

const price = z
  .preprocess((v) => {
    if (v === undefined || v === null) return 0;
    if (typeof v === "string") return parseBRL(v) ?? 0;
    return v;
  }, z.number({ message: "Informe um preço válido." }))
  .refine((v) => v >= 0, "O preço não pode ser negativo.")
  .refine((v) => Number.isInteger(Math.round(v * 1e6) / 1e4), "Use no máximo 2 casas decimais.")
  .refine((v) => v < 1e12, "Valor muito alto.");

export const productSchema = z.object({
  name: z.string().trim().min(1, "Informe o nome do produto.").max(120, "Use no máximo 120 caracteres."),
  kind: z.enum(PRODUCT_KINDS, { message: "Escolha o tipo." }),
  defaultPrice: price,
  serviceCategoryId: z
    .string()
    .uuid()
    .optional()
    .nullable()
    .transform((v) => v ?? null),
});
export type ProductInput = z.input<typeof productSchema>;
