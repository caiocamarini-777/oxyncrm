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

// ---------------------------------------------------------------------------
// Contratos, despesas recorrentes e configurações (Task 12)
// ---------------------------------------------------------------------------

const blank = (v: unknown) => v === "" || v === undefined || v === null;

/** Inteiro opcional vindo de formulário ("" vira null). */
const optInt = (min: number, max: number, invalid: string) =>
  z.preprocess(
    (v) => (blank(v) ? null : typeof v === "string" ? Number(v.trim()) : v),
    z
      .number({ message: invalid })
      .int(invalid)
      .min(min, invalid)
      .max(max, invalid)
      .nullable(),
  );

/** Percentual de 0 a 100 (até 3 casas); vazio vale `empty`. */
const pct = (empty: number | null) =>
  z.preprocess(
    (v) => (blank(v) ? empty : typeof v === "string" ? (parseBRL(v) ?? Number.NaN) : v),
    z
      .number({ message: "Informe um percentual válido." })
      .refine((n) => Number.isFinite(n) && n >= 0 && n <= 100, "O percentual vai de 0 a 100.")
      .nullable(),
  );

const optText = (max: number) =>
  z.preprocess(
    (v) => (typeof v === "string" ? (v.trim() === "" ? null : v.trim()) : (v ?? null)),
    z.string().max(max, `Use no máximo ${max} caracteres.`).nullable(),
  );

/** "YYYY-MM" (ou "YYYY-MM-01") vira o primeiro dia do mês. */
const monthStart = (required: string) =>
  z
    .string({ message: required })
    .regex(/^\d{4}-(0[1-9]|1[0-2])(-01)?$/, required)
    .transform((s) => `${s.slice(0, 7)}-01`);

export const END_RULES = ["ends", "auto_renew", "renew_adjust", "confirm"] as const;
export const ADJUST_KINDS = ["none", "percent", "index"] as const;
export const ADJUST_INDEXES = ["IPCA", "IGP-M", "INPC"] as const;

export const contractSchema = z
  .object({
    title: z.string().trim().min(1, "Informe o título.").max(200, "Use no máximo 200 caracteres."),
    organizationId: optionalUuid,
    dueDay: optInt(1, 31, "O dia de vencimento vai de 1 a 31."),
    retentionRate: pct(0).transform((v) => v ?? 0),
    accountId: optionalUuid,
    endRule: z.preprocess((v) => (blank(v) ? null : v), z.enum(END_RULES, { message: "Escolha a regra de fim." }).nullable()),
    renewalMonths: optInt(1, 120, "A renovação vai de 1 a 120 meses."),
    adjustKind: z.enum(ADJUST_KINDS, { message: "Escolha o tipo de reajuste." }),
    adjustIndex: z.preprocess((v) => (blank(v) ? null : v), z.enum(ADJUST_INDEXES, { message: "Informe o índice." }).nullable()),
    adjustRate: pct(0).transform((v) => v ?? 0),
    notes: optText(2000),
  })
  .superRefine((v, ctx) => {
    if (v.adjustKind === "index" && !v.adjustIndex)
      ctx.addIssue({ code: "custom", path: ["adjustIndex"], message: "Informe o índice." });
  });
export type ContractInput = z.input<typeof contractSchema>;

export const LINE_KINDS = ["setup", "recurring", "commission"] as const;

const optMoney = z.preprocess(
  (v) => (blank(v) ? null : v),
  brl("Informe um valor válido.")
    .refine((n) => Number.isFinite(n) && n >= 0, "Informe um valor válido.")
    .refine((n) => Number.isInteger(Math.round(n * 1e6) / 1e4), "Use no máximo 2 casas decimais.")
    .nullable(),
);

export const contractLineSchema = z
  .object({
    id: optionalUuid,
    kind: z.enum(LINE_KINDS, { message: "Escolha o tipo da linha." }),
    description: z.string().trim().min(1, "Informe a descrição.").max(200, "Use no máximo 200 caracteres."),
    serviceCategoryId: optionalUuid,
    amount: z.unknown().optional(),
    firstMonth: monthStart("Informe o mês inicial."),
    installments: z.preprocess(
      (v) => (blank(v) ? 1 : typeof v === "string" ? Number(v.trim()) : v),
      z.number({ message: "Informe as parcelas (1 a 60)." }).int("Informe as parcelas (1 a 60).").min(1, "Informe as parcelas (1 a 60).").max(60, "Informe as parcelas (1 a 60)."),
    ),
    months: z.preprocess(
      (v) => (blank(v) ? null : typeof v === "string" ? Number(v.trim()) : v),
      z.number({ message: "Informe a duração em meses." }).int("Informe a duração em meses.").min(1, "A duração vai de 1 a 120 meses.").max(120, "A duração vai de 1 a 120 meses.").nullable(),
    ),
    setupRate: pct(null),
    recurringRate: pct(null),
    estimatedMonthly: optMoney,
  })
  .superRefine((v, ctx) => {
    if (v.kind !== "commission") {
      const r = money.safeParse(v.amount);
      if (!r.success) ctx.addIssue({ code: "custom", path: ["amount"], message: r.error.issues[0].message });
    }
    if (v.kind !== "setup" && v.months === null)
      ctx.addIssue({ code: "custom", path: ["months"], message: "Informe a duração em meses." });
    if (v.kind === "commission" && v.setupRate === null && v.recurringRate === null)
      ctx.addIssue({ code: "custom", path: ["setupRate"], message: "Informe ao menos um percentual." });
  })
  .transform((v) => {
    const commission = v.kind === "commission";
    return {
      id: v.id,
      kind: v.kind,
      description: v.description,
      serviceCategoryId: v.serviceCategoryId,
      amount: commission ? null : (money.parse(v.amount) as number),
      firstMonth: v.firstMonth,
      installments: v.kind === "setup" ? v.installments : 1,
      months: v.kind === "setup" ? null : v.months,
      setupRate: commission ? v.setupRate : null,
      recurringRate: commission ? v.recurringRate : null,
      estimatedMonthly: commission ? v.estimatedMonthly : null,
    };
  });
export type ContractLineInput = z.input<typeof contractLineSchema>;

/** Item recorrente de entrada ou saída; início e fim são obrigatórios. */
export const recurringItemSchema = z
  .object({
    direction: z.enum(ENTRY_DIRECTIONS, { message: "Escolha entrada ou saída." }).default("out"),
    description: z.string().trim().min(1, "Informe a descrição.").max(200, "Use no máximo 200 caracteres."),
    payee: optText(200),
    organizationId: optionalUuid,
    incomeCategoryId: optionalUuid,
    serviceCategoryId: optionalUuid,
    expenseCategoryId: z.preprocess((v) => (blank(v) ? null : v), z.string().uuid("Escolha a categoria da despesa.").nullable()),
    nature: z.preprocess((v) => (blank(v) ? null : v), z.enum(ENTRY_NATURES, { message: "Escolha a natureza da despesa." }).nullable()),
    amount: money,
    frequency: z.enum(["monthly", "quarterly", "yearly"], { message: "Escolha a frequência." }).default("monthly"),
    dueDay: z.preprocess(
      (v) => (typeof v === "string" ? Number(v.trim()) : v),
      z.number({ message: "O dia de vencimento vai de 1 a 31." }).int("O dia de vencimento vai de 1 a 31.").min(1, "O dia de vencimento vai de 1 a 31.").max(31, "O dia de vencimento vai de 1 a 31."),
    ),
    startMonth: monthStart("Informe o mês inicial."),
    endMonth: z.preprocess((v) => (blank(v) ? undefined : v), monthStart("Informe o fim.")),
    installments: optInt(1, 360, "As parcelas vão de 1 a 360."),
    adjustRate: pct(0).transform((v) => v ?? 0),
    adjustMonth: optInt(1, 12, "O mês de reajuste vai de 1 a 12."),
    accountId: optionalUuid,
  })
  .superRefine((v, ctx) => {
    if (v.endMonth < v.startMonth)
      ctx.addIssue({ code: "custom", path: ["endMonth"], message: "O fim não pode ser antes do início." });
    if (v.direction === "out") {
      if (!v.expenseCategoryId)
        ctx.addIssue({ code: "custom", path: ["expenseCategoryId"], message: "Escolha a categoria da despesa." });
      if (!v.nature) ctx.addIssue({ code: "custom", path: ["nature"], message: "Escolha a natureza da despesa." });
    } else if (!v.incomeCategoryId && !v.serviceCategoryId) {
      ctx.addIssue({ code: "custom", path: ["incomeCategoryId"], message: "Escolha a categoria da receita." });
    }
  })
  .transform((v) =>
    v.direction === "out"
      ? { ...v, incomeCategoryId: null, serviceCategoryId: null }
      : { ...v, expenseCategoryId: null, nature: null },
  );
export type RecurringItemInput = z.input<typeof recurringItemSchema>;

const name80 = z.string().trim().min(1, "Informe o nome.").max(80, "Use no máximo 80 caracteres.");

export const accountSchema = z.object({ name: name80, bank: optText(80) });
export type AccountInput = z.input<typeof accountSchema>;

export const incomeCategorySchema = z.object({ name: name80 });
export type IncomeCategoryInput = z.input<typeof incomeCategorySchema>;

export const expenseCategorySchema = z.object({
  name: name80,
  defaultNature: z.enum(ENTRY_NATURES, { message: "Escolha a natureza padrão." }),
});
export type ExpenseCategoryInput = z.input<typeof expenseCategorySchema>;

export const balanceSnapshotSchema = z.object({
  asOf: isoDate,
  balance: brl("Informe um valor válido.")
    .refine((n) => Number.isFinite(n), "Informe um valor válido.")
    .refine((n) => Number.isInteger(Math.round(n * 1e6) / 1e4), "Use no máximo 2 casas decimais.")
    .refine((n) => Math.abs(n) < 1e12, "Valor muito alto."),
  note: optText(200),
});
export type BalanceSnapshotInput = z.input<typeof balanceSnapshotSchema>;
