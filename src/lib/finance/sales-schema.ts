import { z } from "zod";
import { parseBRL } from "@/lib/records/format";

const blank = (v: unknown) => v === "" || v === undefined || v === null;

/** Valor em reais (≥ 0, 2 casas); vazio vale 0. */
const money = z.preprocess(
  (v) => (blank(v) ? 0 : typeof v === "string" ? (parseBRL(v) ?? 0) : v),
  z
    .number({ message: "Informe um valor válido." })
    .refine((n) => Number.isFinite(n) && n >= 0, "Informe um valor válido.")
    .refine((n) => Number.isInteger(Math.round(n * 1e6) / 1e4), "Use no máximo 2 casas decimais.")
    .refine((n) => n < 1e12, "Valor muito alto."),
);

const isoDate = z
  .string({ message: "Informe a data da venda." })
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Informe a data da venda.")
  .refine((s) => {
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }, "Informe uma data válida.");

/** "YYYY-MM" (ou "YYYY-MM-01") vira "YYYY-MM-01"; vazio vira null. */
const optMonth = z.preprocess(
  (v) => (blank(v) ? null : v),
  z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])(-01)?$/, "Informe um mês válido.")
    .transform((s) => `${s.slice(0, 7)}-01`)
    .nullable(),
);

const int = (min: number, max: number, msg: string) =>
  z.preprocess(
    (v) => (blank(v) ? null : typeof v === "string" ? Number(v.trim()) : v),
    z.number({ message: msg }).int(msg).min(min, msg).max(max, msg),
  );

export const saleSchema = z
  .object({
    contractLineId: z.string({ message: "Escolha o contrato." }).uuid("Escolha o contrato."),
    buyer: z.string().trim().min(1, "Informe o cliente final.").max(120, "Use no máximo 120 caracteres."),
    soldOn: isoDate,
    setupValue: money,
    setupInstallments: z.preprocess(
      (v) => (blank(v) ? 1 : v),
      int(1, 60, "As parcelas vão de 1 a 60."),
    ),
    setupFirstMonth: optMonth,
    recurringValue: money,
    recurringStart: optMonth,
    recurringMonths: z.preprocess(
      (v) => (blank(v) ? null : v),
      int(1, 120, "Os meses vão de 1 a 120.").nullable(),
    ),
    note: z.preprocess(
      (v) => (typeof v === "string" ? (v.trim() === "" ? null : v.trim()) : (v ?? null)),
      z.string().max(500, "Use no máximo 500 caracteres.").nullable(),
    ),
  })
  .superRefine((v, ctx) => {
    if (v.setupValue === 0 && v.recurringValue === 0) {
      ctx.addIssue({ code: "custom", path: ["setupValue"], message: "Informe o valor do setup ou da recorrência." });
      return;
    }
    if (v.setupValue > 0 && !v.setupFirstMonth)
      ctx.addIssue({ code: "custom", path: ["setupFirstMonth"], message: "Informe o mês do primeiro recebimento do setup." });
    if (v.recurringValue > 0 && (!v.recurringStart || v.recurringMonths === null))
      ctx.addIssue({ code: "custom", path: ["recurringStart"], message: "Informe início e meses da recorrência." });
  });
export type SaleInput = z.input<typeof saleSchema>;
export type SaleValues = z.output<typeof saleSchema>;
