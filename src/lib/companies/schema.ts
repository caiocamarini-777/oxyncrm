import { z } from "zod";
import { isValidCnpj, onlyDigits } from "./cnpj";

export const SLUG_REGEX = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export const companySchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Informe o nome (mínimo 2 caracteres).")
    .max(80, "Use no máximo 80 caracteres."),
  slug: z
    .string()
    .trim()
    .regex(SLUG_REGEX, "Use apenas letras minúsculas, números e hífen.")
    .refine((s) => s !== "todas", "Este endereço é reservado."),
  legalName: z
    .string()
    .trim()
    .max(160, "Use no máximo 160 caracteres.")
    .optional()
    .transform((v) => (v ? v : undefined)),
  cnpj: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? v : undefined))
    .refine((v) => v === undefined || isValidCnpj(v), "CNPJ inválido.")
    .transform((v) => (v === undefined ? undefined : onlyDigits(v))),
});

export type CompanyInput = z.input<typeof companySchema>;
