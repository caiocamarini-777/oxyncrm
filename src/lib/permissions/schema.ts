import { z } from "zod";

export const ENTITIES = ["leads", "deals", "persons", "organizations", "activities"] as const;
export const VISIBILITY = ["own", "team", "company"] as const;
export const ACTIONS = ["create", "edit", "delete", "export", "reassign_owner"] as const;
export const SETTINGS = [
  "manage_pipelines",
  "manage_custom_fields",
  "manage_products",
  "view_reports",
  "create_dashboards",
  "share_dashboards",
] as const;

const visibilityEnum = z.enum(VISIBILITY);

// Espelha public.is_valid_permissions: chaves exatas, sem extras.
export const permissionsSchema = z
  .object({
    visibility: z
      .object({
        leads: visibilityEnum,
        deals: visibilityEnum,
        persons: visibilityEnum,
        organizations: visibilityEnum,
        activities: visibilityEnum,
      })
      .strict(),
    actions: z
      .object({
        create: z.boolean(),
        edit: z.boolean(),
        delete: z.boolean(),
        export: z.boolean(),
        reassign_owner: z.boolean(),
      })
      .strict(),
    settings: z
      .object({
        manage_pipelines: z.boolean(),
        manage_custom_fields: z.boolean(),
        manage_products: z.boolean(),
        view_reports: z.boolean(),
        create_dashboards: z.boolean(),
        share_dashboards: z.boolean(),
      })
      .strict(),
  })
  .strict();

export type Permissions = z.infer<typeof permissionsSchema>;

// Igual ao papel "Usuário padrão" criado na migration de acesso.
export const DEFAULT_PERMISSIONS: Permissions = {
  visibility: {
    leads: "own",
    deals: "own",
    persons: "own",
    organizations: "own",
    activities: "own",
  },
  actions: { create: true, edit: true, delete: false, export: false, reassign_owner: false },
  settings: {
    manage_pipelines: false,
    manage_custom_fields: false,
    manage_products: false,
    view_reports: true,
    create_dashboards: true,
    share_dashboards: false,
  },
};
