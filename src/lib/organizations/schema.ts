import { z } from "zod";
import { isValidCnpj, onlyDigits } from "@/lib/companies/cnpj";

export const BR_STATES = [
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA",
  "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO",
] as const;

const DOMAIN_RE = /^[a-z0-9.-]+\.[a-z]{2,}$/;

/** `https://www.Volt.com.br/contato` vira `volt.com.br`. */
export function normalizeDomain(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, "")
    .replace(/[/?#].*$/, "")
    .replace(/^www\./, "");
}

const optionalText = (max: number, message: string) =>
  z
    .string()
    .trim()
    .max(max, message)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null));

const addressSchema = z
  .object({
    street: optionalText(200, "Rua: use no máximo 200 caracteres."),
    number: optionalText(30, "Número: use no máximo 30 caracteres."),
    city: optionalText(120, "Cidade: use no máximo 120 caracteres."),
    state: z
      .string()
      .trim()
      .toUpperCase()
      .optional()
      .nullable()
      .transform((v) => (v ? v : null))
      .refine((v) => v === null || (BR_STATES as readonly string[]).includes(v), "UF inválida."),
    zip: z
      .string()
      .optional()
      .nullable()
      .transform((v) => (v ? onlyDigits(v) : null))
      .refine((v) => v === null || v.length === 8, "CEP deve ter 8 dígitos."),
  })
  .optional()
  .transform((a) => {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(a ?? {})) if (v) out[k] = v;
    return out;
  });

export const organizationSchema = z.object({
  name: z.string().trim().min(1, "Informe o nome.").max(200, "Use no máximo 200 caracteres."),
  legalName: optionalText(200, "Use no máximo 200 caracteres."),
  cnpj: z
    .string()
    .optional()
    .nullable()
    .transform((v) => (v ? onlyDigits(v) : null))
    .refine((v) => v === null || isValidCnpj(v), "CNPJ inválido."),
  domain: z
    .string()
    .optional()
    .nullable()
    .transform((v) => (v ? normalizeDomain(v) : null))
    .transform((v) => (v ? v : null))
    .refine((v) => v === null || DOMAIN_RE.test(v), "Domínio inválido."),
  segment: optionalText(120, "Use no máximo 120 caracteres."),
  address: addressSchema,
  ownerId: z.string().uuid().optional(),
  customFields: z.record(z.string(), z.unknown()).default({}),
});
export type OrganizationInput = z.input<typeof organizationSchema>;
export type OrganizationData = z.output<typeof organizationSchema>;
