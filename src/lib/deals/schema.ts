import { z } from "zod";
import { parseBRL } from "@/lib/records/format";

export const DEAL_STATUSES = ["open", "won", "lost"] as const;
export type DealStatus = (typeof DEAL_STATUSES)[number];

/** Aba ativa: primeiro `status` válido da URL; padrão `open`. */
export function dealStatusOf(query: { status: string[] }): DealStatus {
  const s = query.status.find((v): v is DealStatus => (DEAL_STATUSES as readonly string[]).includes(v));
  return s ?? "open";
}

const optionalUuid = z
  .string()
  .uuid()
  .optional()
  .nullable()
  .transform((v) => v ?? null);

/** Aceita número ou texto BRL; vazio vira null; no máximo 2 casas. */
function moneyField(max = 1e12) {
  return z
    .preprocess((v) => {
      if (v === undefined || v === null) return null;
      if (typeof v === "string") return parseBRL(v);
      return v;
    }, z.number({ message: "Informe um valor válido." }).nullable())
    .refine((v) => v === null || v >= 0, "O valor não pode ser negativo.")
    .refine((v) => v === null || Number.isInteger(Math.round(v * 1e6) / 1e4), "Use no máximo 2 casas decimais.")
    .refine((v) => v === null || v < max, "Valor muito alto.");
}

/** Número inteiro opcional vindo de texto ou número; vazio vira null. */
function optionalInt(min: number, max: number, label: string) {
  return z.preprocess(
    (v) => (v === "" || v === undefined || v === null ? null : typeof v === "string" ? Number(v.trim()) : v),
    z
      .number({ message: "Informe um número válido." })
      .int("Use um número inteiro.")
      .min(min, `${label} vai de ${min} a ${max}.`)
      .max(max, `${label} vai de ${min} a ${max}.`)
      .nullable(),
  );
}

const month = z
  .preprocess(
    (v) => (v === "" || v === undefined ? null : v),
    z
      .string()
      .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Informe um mês válido.")
      .nullable(),
  )
  .default(null);

const isoDate = z
  .preprocess(
    (v) => (v === "" || v === undefined ? null : v),
    z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Informe uma data válida.")
      .refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)), "Informe uma data válida.")
      .nullable(),
  )
  .default(null);

export const dealSchema = z.object({
  title: z.string().trim().min(1, "Informe o título.").max(200, "Use no máximo 200 caracteres."),
  /** Só na criação: funil e etapa de entrada. */
  pipelineId: optionalUuid,
  stageId: optionalUuid,
  personId: optionalUuid,
  organizationId: optionalUuid,
  estimatedValue: moneyField().default(null),
  expectedCloseDate: isoDate,
  ownerId: z.string().uuid().optional(),
  customFields: z.record(z.string(), z.unknown()).default({}),
});
export type DealInput = z.input<typeof dealSchema>;
export type DealData = z.output<typeof dealSchema>;

export const MSG_SETUP_DATE = "Informe o mês da primeira parcela.";
export const MSG_MRR_DATES = "Informe o mês de início e a duração do contrato.";

export const contractSchema = z
  .object({
    setupTotal: moneyField(1e13).transform((v) => v ?? 0),
    setupInstallments: z
      .preprocess(
        (v) => (v === "" || v === undefined || v === null ? 1 : typeof v === "string" ? Number(v.trim()) : v),
        z
          .number({ message: "Informe um número válido." })
          .int("Use um número inteiro.")
          .min(1, "O número de parcelas vai de 1 a 60.")
          .max(60, "O número de parcelas vai de 1 a 60."),
      ),
    setupFirstDue: month,
    mrr: moneyField(1e13).transform((v) => v ?? 0),
    mrrStart: month,
    contractMonths: optionalInt(1, 120, "A duração").default(null),
  })
  .superRefine((v, ctx) => {
    if (v.setupTotal > 0 && !v.setupFirstDue) {
      ctx.addIssue({ code: "custom", path: ["setupFirstDue"], message: MSG_SETUP_DATE });
    }
    if (v.mrr > 0 && (!v.mrrStart || v.contractMonths === null)) {
      ctx.addIssue({
        code: "custom",
        path: [v.mrrStart ? "contractMonths" : "mrrStart"],
        message: MSG_MRR_DATES,
      });
    }
  });
export type ContractInput = z.input<typeof contractSchema>;
export type ContractData = z.output<typeof contractSchema>;

const itemBase = z.object({
  productId: z.string({ message: "Escolha um produto." }).uuid("Escolha um produto."),
  quantity: z.preprocess(
    (v) => (typeof v === "string" ? parseBRL(v) : v),
    z
      .number({ message: "Informe a quantidade." })
      .gt(0, "A quantidade precisa ser maior que zero.")
      .lt(1e8, "Quantidade muito alta.")
      .refine((v) => Number.isInteger(Math.round(v * 1e6) / 1e4), "Use no máximo 2 casas decimais."),
  ),
  unitPrice: moneyField().transform((v) => v ?? 0),
  discount: moneyField().transform((v) => v ?? 0),
});

function checkDiscount(v: { quantity: number; unitPrice: number; discount: number }, ctx: z.RefinementCtx) {
  if (Math.round(v.discount * 100) > Math.round(v.quantity * v.unitPrice * 100)) {
    ctx.addIssue({ code: "custom", path: ["discount"], message: "O desconto não pode passar do subtotal." });
  }
}

export const dealItemSchema = itemBase.superRefine(checkDiscount);
/** Edição de item: o produto não muda. */
export const dealItemUpdateSchema = itemBase.omit({ productId: true }).superRefine(checkDiscount);
export type DealItemInput = z.input<typeof dealItemSchema>;
export type DealItemData = z.output<typeof dealItemSchema>;
export type DealItemUpdateInput = z.input<typeof dealItemUpdateSchema>;

export const lostSchema = z.object({
  reasonId: z.string({ message: "Escolha um motivo." }).uuid("Escolha um motivo."),
  note: z
    .string()
    .trim()
    .max(1000, "Use no máximo 1.000 caracteres.")
    .optional()
    .nullable()
    .transform((v) => (v ? v : null)),
});
export type LostInput = z.input<typeof lostSchema>;

export type ContractDates = {
  mrrStart: string | null;
  contractMonths: number | null;
  setupFirstDue: string | null;
};

/**
 * Datas que o contrato precisa ter antes do primeiro item de um tipo (CHECKs do banco):
 * "mrr" (início + duração), "setup" (primeira parcela) ou null quando já bastam.
 */
export function contractDatesNeeded(deal: ContractDates, kind: "setup" | "recurring"): "mrr" | "setup" | null {
  if (kind === "recurring") return deal.mrrStart && deal.contractMonths !== null ? null : "mrr";
  return deal.setupFirstDue ? null : "setup";
}

/** "YYYY-MM" para o primeiro dia do mês no banco. */
export function monthToDate(m: string | null): string | null {
  return m ? `${m}-01` : null;
}
/** "YYYY-MM-DD" do banco para "YYYY-MM". */
export function dateToMonth(d: string | null): string | null {
  return d ? d.slice(0, 7) : null;
}
