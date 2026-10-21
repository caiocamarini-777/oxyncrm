import { z } from "zod";

export const accessSchema = z.object({
  companyId: z.string().uuid("Escolha a empresa."),
  roleId: z.string().uuid("Escolha o papel."),
});
export type Access = z.infer<typeof accessSchema>;

export const accessListSchema = z.array(accessSchema).superRefine((list, ctx) => {
  const seen = new Set<string>();
  list.forEach((a, i) => {
    if (seen.has(a.companyId)) {
      ctx.addIssue({
        code: "custom",
        message: "Esta empresa já foi adicionada.",
        path: [i, "companyId"],
      });
    }
    seen.add(a.companyId);
  });
});

export const inviteSchema = z
  .object({
    email: z.string().trim().toLowerCase().email("Informe um e-mail válido."),
    fullName: z
      .string()
      .trim()
      .min(2, "Informe o nome (mínimo 2 caracteres).")
      .max(80, "Use no máximo 80 caracteres."),
    isSuperAdmin: z.boolean(),
    access: accessListSchema,
    teamIds: z.array(z.string().uuid()),
  })
  .superRefine((v, ctx) => {
    if (!v.isSuperAdmin && v.access.length === 0) {
      ctx.addIssue({
        code: "custom",
        message: "Libere o acesso a pelo menos uma empresa.",
        path: ["access"],
      });
    }
  });
export type InviteInput = z.input<typeof inviteSchema>;
