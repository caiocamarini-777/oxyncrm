import { z } from "zod";
import { parseBRL } from "@/lib/records/format";

export const LEAD_STATUSES = ["open", "disqualified", "archived"] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

const optionalUuid = z
  .string()
  .uuid()
  .optional()
  .nullable()
  .transform((v) => v ?? null);

/** Aceita número ou texto ("1500,25" / "1500.25"); vazio vira null; no máximo 2 casas. */
const estimatedValue = z
  .preprocess((v) => {
    if (v === undefined || v === null) return null;
    if (typeof v === "string") return parseBRL(v);
    return v;
  }, z.number({ message: "Informe um valor válido." }).nullable())
  .refine((v) => v === null || v >= 0, "O valor não pode ser negativo.")
  .refine((v) => v === null || Number.isInteger(Math.round(v * 1e6) / 1e4), "Use no máximo 2 casas decimais.")
  .refine((v) => v === null || v < 1e12, "Valor muito alto.");

export const leadSchema = z.object({
  title: z.string().trim().min(1, "Informe o título.").max(200, "Use no máximo 200 caracteres."),
  sourceId: optionalUuid,
  personId: optionalUuid,
  organizationId: optionalUuid,
  estimatedValue: estimatedValue.default(null),
  ownerId: z.string().uuid().optional(),
  customFields: z.record(z.string(), z.unknown()).default({}),
});
export type LeadInput = z.input<typeof leadSchema>;
export type LeadData = z.output<typeof leadSchema>;

export const disqualifySchema = z.object({
  reasonId: z.string({ message: "Escolha um motivo." }).uuid("Escolha um motivo."),
  note: z
    .string()
    .trim()
    .max(1000, "Use no máximo 1.000 caracteres.")
    .optional()
    .nullable()
    .transform((v) => (v ? v : null)),
});
export type DisqualifyInput = z.input<typeof disqualifySchema>;

/** Dias de calendário (America/Sao_Paulo, UTC-3) desde a criação: "hoje", "1 dia", "N dias". */
export function leadAgeDays(createdAt: string, now: Date = new Date()): number {
  const day = (d: Date) => Math.floor((d.getTime() - 3 * 3600_000) / 86_400_000);
  return Math.max(0, day(now) - day(new Date(createdAt)));
}

export function leadAgeLabel(createdAt: string, now: Date = new Date()): string {
  const n = leadAgeDays(createdAt, now);
  return n === 0 ? "hoje" : n === 1 ? "1 dia" : `${n} dias`;
}
