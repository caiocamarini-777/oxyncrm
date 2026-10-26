import { z } from "zod";

/** Item cru do Pipedrive (formato da API v1). Os campos são lidos de forma defensiva pelos mapeadores. */
export type PdItem = Record<string, unknown>;

export const PD_ENTITIES = ["organizations", "persons", "leads", "deals", "activities", "notes", "products"] as const;
export type PdEntity = (typeof PD_ENTITIES)[number];

export type PdPage = { items: PdItem[]; nextStart: number | null };

export type PdFieldDef = {
  key: string;
  name: string;
  field_type: string;
  options?: { id: number | string; label: string }[];
};

const uuid = z.string().uuid();

export const ImportMappings = z.object({
  pipelines: z.record(
    z.string(),
    z.object({
      companyId: uuid,
      /** null = criar um funil com o mesmo nome */
      pipelineId: uuid.nullable(),
      /** null = etapa sem destino (o negócio nela vira erro) */
      stages: z.record(z.string(), uuid.nullable()),
    }),
  ),
  users: z.record(z.string(), uuid),
  fallbackOwnerId: uuid,
  leadLabelCompany: z.record(z.string(), uuid),
  defaultCompanyId: uuid,
  customFields: z.record(
    z.string(),
    z.object({
      target: z.enum(["native:setup_total", "native:mrr", "native:contract_months", "custom"]),
      customFieldKey: z.string().min(1).optional(),
    }),
  ),
  ignorePipelines: z.array(z.string()),
});
export type ImportMappings = z.infer<typeof ImportMappings>;
