import { z } from "zod";

export const CONTACT_LABELS = ["Trabalho", "Pessoal", "Celular", "Outro"] as const;
export type ContactLabel = (typeof CONTACT_LABELS)[number];
export type ContactEntry = { label: ContactLabel; value: string };

const labelSchema = z.enum(CONTACT_LABELS, { message: "Rótulo inválido." });
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Linhas em branco (valor vazio) são descartadas antes de validar. */
function dropBlank(v: unknown): unknown {
  if (!Array.isArray(v)) return v;
  return v.filter((e) => !(e && typeof e === "object" && String((e as { value?: unknown }).value ?? "").trim() === ""));
}

const emailsSchema = z
  .preprocess(
    dropBlank,
    z
      .array(
        z.object({
          label: labelSchema,
          value: z
            .string()
            .trim()
            .toLowerCase()
            .max(254, "E-mail muito longo.")
            .refine((v) => EMAIL_RE.test(v), "E-mail inválido."),
        }),
      )
      .max(10, "Use no máximo 10 e-mails."),
  )
  .default([])
  .superRefine((list, ctx) => {
    const seen = new Set<string>();
    list.forEach((e, i) => {
      if (seen.has(e.value)) ctx.addIssue({ code: "custom", path: [i, "value"], message: "E-mail repetido." });
      seen.add(e.value);
    });
  });

const phonesSchema = z
  .preprocess(
    dropBlank,
    z
      .array(
        z.object({
          label: labelSchema,
          value: z
            .string()
            .transform((v) => v.replace(/\D/g, ""))
            .refine((v) => v.length >= 10 && v.length <= 13, "Telefone deve ter de 10 a 13 dígitos."),
        }),
      )
      .max(10, "Use no máximo 10 telefones."),
  )
  .default([])
  .superRefine((list, ctx) => {
    const seen = new Set<string>();
    list.forEach((e, i) => {
      if (seen.has(e.value)) ctx.addIssue({ code: "custom", path: [i, "value"], message: "Telefone repetido." });
      seen.add(e.value);
    });
  });

function isLinkedinUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    const host = u.hostname.toLowerCase();
    return u.protocol === "https:" && (host === "linkedin.com" || host.endsWith(".linkedin.com"));
  } catch {
    return false;
  }
}

export const personSchema = z.object({
  fullName: z.string().trim().min(1, "Informe o nome.").max(200, "Use no máximo 200 caracteres."),
  jobTitle: z
    .string()
    .trim()
    .max(120, "Use no máximo 120 caracteres.")
    .optional()
    .nullable()
    .transform((v) => (v ? v : null)),
  organizationId: z
    .string()
    .uuid()
    .optional()
    .nullable()
    .transform((v) => v ?? null),
  emails: emailsSchema,
  phones: phonesSchema,
  linkedinUrl: z
    .string()
    .trim()
    .max(300, "Use no máximo 300 caracteres.")
    .optional()
    .nullable()
    .transform((v) => (v ? v : null))
    .refine((v) => v === null || isLinkedinUrl(v), "Use um endereço https:// do linkedin.com."),
  ownerId: z.string().uuid().optional(),
  customFields: z.record(z.string(), z.unknown()).default({}),
});
export type PersonInput = z.input<typeof personSchema>;
export type PersonData = z.output<typeof personSchema>;

/** Celular rotulado, ou 11 dígitos com 9 depois do DDD. */
export function isWhatsappPhone(p: ContactEntry): boolean {
  const d = p.value.replace(/\D/g, "");
  if (p.label === "Celular") return d.length >= 10;
  return d.length === 11 && d[2] === "9";
}

export function whatsappHref(value: string): string {
  const d = value.replace(/\D/g, "");
  const full = d.length >= 12 && d.startsWith("55") ? d : `55${d}`;
  return `https://wa.me/${full}`;
}
