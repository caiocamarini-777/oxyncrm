import { z } from "zod";

// Formato da carga inicial do Financeiro (planilha → JSON → banco).
// O rascunho (draft) sai do extrator com lacunas (regra de fim de vigência, categoria de serviço e conta);
// o JSON final precisa de tudo preenchido antes do import.

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a data no formato AAAA-MM-DD.");
const isoMonth = z.string().regex(/^\d{4}-\d{2}-01$/, "Use o primeiro dia do mês (AAAA-MM-01).");
const money = z.number().finite().refine((v) => Math.round(v * 100) === Math.round(v * 1e6) / 1e4, {
  message: "Use no máximo 2 casas decimais.",
});
const positive = money.refine((v) => v > 0, { message: "O valor precisa ser maior que zero." });
const nonNegative = money.refine((v) => v >= 0, { message: "O valor não pode ser negativo." });

export const END_RULES = ["ends", "auto_renew", "renew_adjust", "confirm"] as const;
export const NATURES = ["fixed", "variable", "non_recurring"] as const;

const accountSchema = z.object({
  key: z.string().min(1),
  name: z.string().trim().min(1),
  bank: z.string().trim().min(1).optional(),
  balance: money.optional(),
  balanceDate: isoDate.optional(),
});

const lineSchema = z.object({
  kind: z.enum(["setup", "recurring"]),
  description: z.string().trim().min(1),
  serviceCategory: z.string().trim().min(1).nullable(),
  amount: positive,
  firstMonth: isoMonth,
  installments: z.number().int().min(1).max(60).optional(),
  months: z.number().int().min(1).max(120).optional(),
});

const contractSchema = z.object({
  key: z.string().min(1),
  title: z.string().trim().min(1),
  organizationName: z.string().trim().min(1),
  organizationId: z.string().uuid().optional(),
  dueDay: z.number().int().min(1).max(31),
  retentionRate: z.number().min(0).max(100),
  accountKey: z.string().min(1).nullable(),
  endRule: z.enum(END_RULES).nullable(),
  renewalMonths: z.number().int().min(1).max(120).optional(),
  adjustKind: z.enum(["none", "percent", "index"]),
  adjustIndex: z.enum(["IPCA", "IGP-M", "INPC"]).optional(),
  adjustRate: z.number(),
  lines: z.array(lineSchema).min(1),
});

const recurringSchema = z.object({
  key: z.string().min(1),
  description: z.string().trim().min(1),
  expenseCategory: z.string().trim().min(1),
  nature: z.enum(NATURES),
  amount: positive,
  frequency: z.enum(["monthly", "quarterly", "yearly"]),
  dueDay: z.number().int().min(1).max(31),
  startMonth: isoMonth,
  endMonth: isoMonth.optional(),
  installments: z.number().int().min(1).max(360).optional(),
  accountKey: z.string().min(1).nullable().optional(),
});

const entrySchema = z.object({
  key: z.string().min(1),
  direction: z.enum(["in", "out"]),
  status: z.enum(["settled", "open"]),
  date: isoDate,
  gross: nonNegative,
  retention: nonNegative,
  description: z.string().trim().min(1),
  organizationName: z.string().trim().min(1).optional(),
  serviceCategory: z.string().trim().min(1).nullable().optional(),
  incomeCategory: z.string().trim().min(1).optional(),
  expenseCategory: z.string().trim().min(1).optional(),
  nature: z.enum(NATURES).optional(),
  accountKey: z.string().min(1).nullable().optional(),
});

const checkSchema = z.record(
  z.string().regex(/^\d{4}-\d{2}$/),
  z.object({ in: z.number(), out: z.number() }),
);

const baseSchema = z.object({
  companySlug: z.string().min(1),
  accounts: z.array(accountSchema),
  contracts: z.array(contractSchema),
  recurringExpenses: z.array(recurringSchema),
  entries: z.array(entrySchema),
  check: checkSchema,
});

/** Rascunho do extrator: endRule, categoria de serviço e conta podem vir nulos; traz os avisos. */
export const financeImportDraftSchema = baseSchema.extend({
  companySlug: z.string(),
  warnings: z.array(z.string()),
});
export type FinanceImportDraft = z.infer<typeof financeImportDraftSchema>;

/** JSON final do import: tudo preenchido. */
export const financeImportSchema = baseSchema.superRefine((v, ctx) => {
  const accountKeys = new Set(v.accounts.map((a) => a.key));
  const dup = (items: { key: string }[], path: string) => {
    const seen = new Set<string>();
    items.forEach((it, i) => {
      if (seen.has(it.key)) ctx.addIssue({ code: "custom", path: [path, i, "key"], message: `Chave repetida: ${it.key}.` });
      seen.add(it.key);
    });
  };
  dup(v.accounts, "accounts");
  dup(v.contracts, "contracts");
  dup(v.recurringExpenses, "recurringExpenses");
  dup(v.entries, "entries");

  v.contracts.forEach((c, i) => {
    if (c.endRule === null) {
      ctx.addIssue({
        code: "custom",
        path: ["contracts", i, "endRule"],
        message: `Defina a regra de fim de vigência do contrato ${c.title}.`,
      });
    }
    if (!c.accountKey || !accountKeys.has(c.accountKey)) {
      ctx.addIssue({ code: "custom", path: ["contracts", i, "accountKey"], message: `Defina a conta do contrato ${c.title}.` });
    }
    c.lines.forEach((l, j) => {
      if (!l.serviceCategory) {
        ctx.addIssue({
          code: "custom",
          path: ["contracts", i, "lines", j, "serviceCategory"],
          message: `Defina a categoria de serviço do contrato ${c.title}.`,
        });
      }
      if (l.kind === "recurring" && !l.months) {
        ctx.addIssue({ code: "custom", path: ["contracts", i, "lines", j, "months"], message: `Defina os meses do contrato ${c.title}.` });
      }
    });
  });
  v.recurringExpenses.forEach((r, i) => {
    if (r.accountKey && !accountKeys.has(r.accountKey)) {
      ctx.addIssue({ code: "custom", path: ["recurringExpenses", i, "accountKey"], message: `Conta desconhecida: ${r.accountKey}.` });
    }
  });
  v.entries.forEach((e, i) => {
    if (e.accountKey && !accountKeys.has(e.accountKey)) {
      ctx.addIssue({ code: "custom", path: ["entries", i, "accountKey"], message: `Conta desconhecida: ${e.accountKey}.` });
    }
    if (e.direction === "out" && (!e.expenseCategory || !e.nature)) {
      ctx.addIssue({ code: "custom", path: ["entries", i], message: `Saída sem categoria ou natureza: ${e.key}.` });
    }
    if (e.direction === "in" && !e.incomeCategory && !e.serviceCategory) {
      ctx.addIssue({ code: "custom", path: ["entries", i], message: `Entrada sem categoria: ${e.key}.` });
    }
  });
});
export type FinanceImport = z.infer<typeof financeImportSchema>;
