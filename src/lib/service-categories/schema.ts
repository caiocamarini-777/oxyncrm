import { z } from "zod";

export const DEFAULT_CATEGORY_COLOR = "#64748b";

export const serviceCategorySchema = z.object({
  name: z.string().trim().min(1, "Informe o nome da categoria.").max(80, "Use no máximo 80 caracteres."),
  color: z
    .string()
    .regex(/^#[0-9a-f]{6}$/i, "Escolha uma cor válida.")
    .optional(),
});
export type ServiceCategoryInput = z.input<typeof serviceCategorySchema>;
