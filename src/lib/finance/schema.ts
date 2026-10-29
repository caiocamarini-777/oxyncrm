import { z } from "zod";
import { parseBRL } from "@/lib/records/format";

export const ENTRY_DIRECTIONS = ["in", "out"] as const;
export const ENTRY_NATURES = ["fixed", "variable", "non_recurring"] as const;

const brl = (invalid: string) =>
  z.preprocess((v) => {
    if (typeof v === "string") return parseBRL(v) ?? undefined;
    return v;
  }, z.number({ message: invalid }));

const money = brl("Informe um valor válido.")
  .refine((v) => Number.isFinite(v) && v > 0, "O valor precisa ser maior que zero.")
  .refine((v) => Number.isInteger(Math.round(v * 1e6) / 1e4), "Use no máximo 2 casas decimais.")
  .refine((v) => v < 1e12, "Valor muito alto.");

const isoDate = z
  .string({ message: "Informe a data." })
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Informe a data.")
  .refine((s) => {
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }, "Informe uma data válida.");

const optionalUuid = z
  .string()
  .uuid()
  .optional()
  .nullable()
  .transform((v) => v ?? null);

/** Lançamento avulso (entrada ou saída). */
export const entryInputSchema = z
  .object({
    direction: z.enum(ENTRY_DIRECTIONS, { message: "Escolha entrada ou saída." }),
    dueDate: isoDate,
    gross: money,
    description: z.string().trim().min(1, "Informe a descrição.").max(200, "Use no máximo 200 caracteres."),
    accountId: optionalUuid,
    organizationId: optionalUuid,
    incomeCategoryId: optionalUuid,
    serviceCategoryId: optionalUuid,
    expenseCategoryId: optionalUuid,
    nature: z
      .enum(ENTRY_NATURES)
      .optional()
      .nullable()
      .transform((v) => v ?? null),
  })
  .superRefine((v, ctx) => {
    if (v.direction === "out") {
      if (!v.expenseCategoryId)
        ctx.addIssue({ code: "custom", path: ["expenseCategoryId"], message: "Escolha a categoria da despesa." });
      if (!v.nature) ctx.addIssue({ code: "custom", path: ["nature"], message: "Escolha a natureza da despesa." });
    } else if (!v.incomeCategoryId && !v.serviceCategoryId) {
      ctx.addIssue({ code: "custom", path: ["incomeCategoryId"], message: "Escolha a categoria da receita." });
    }
  });
export type EntryInput = z.input<typeof entryInputSchema>;

/** Baixa de um ou mais lançamentos; `amount` só vale para um único. */
export const settleSchema = z
  .object({
    ids: z
      .array(z.string().uuid())
      .min(1, "Escolha ao menos um lançamento.")
      .max(500, "Escolha no máximo 500 lançamentos por vez."),
    settledOn: isoDate,
    accountId: optionalUuid,
    amount: z
      .preprocess((v) => (v === "" || v === undefined || v === null ? null : v), brl("Informe um valor válido.").nullable())
      .refine((v) => v === null || (Number.isFinite(v) && v >= 0), "Informe um valor válido.")
      .refine((v) => v === null || Number.isInteger(Math.round(v * 1e6) / 1e4), "Use no máximo 2 casas decimais."),
  })
  .superRefine((v, ctx) => {
    if (v.amount !== null && v.ids.length !== 1)
      ctx.addIssue({ code: "custom", path: ["amount"], message: "O valor só pode ser alterado ao baixar um lançamento." });
  });
export type SettleInput = z.input<typeof settleSchema>;
