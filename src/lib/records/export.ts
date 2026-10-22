import "server-only";
import type { CompanyScope } from "@/lib/companies/pure";
import { ORGANIZATION_SORTS } from "@/lib/organizations/queries";
import { ORGANIZATION_EXPORT_COLUMNS, exportOrganizations } from "@/lib/organizations/export";
import type { ListQuery, RecordEntity } from "./types";

export type EntityExporter = {
  /** Prefixo do arquivo: `<prefixo>-<slug>-<aaaa-mm-dd>.csv`. */
  filePrefix: string;
  allowedSorts: string[];
  columns: { key: string; header: string }[];
  /** `companyIds`: empresas em que o usuário pode exportar (o RLS continua valendo). */
  fetchRows: (scope: CompanyScope, query: ListQuery, companyIds: string[]) => Promise<Record<string, unknown>[]>;
};

/** Segmento da URL (`/exportar/<segmento>`) para a entidade. */
export const EXPORT_SEGMENTS: Record<string, RecordEntity> = {
  organizacoes: "organizations",
  pessoas: "persons",
  leads: "leads",
};

/**
 * Registro das entidades exportáveis. Tasks 7 e 9 acrescentam `persons` e `leads`
 * com o mesmo formato (colunas + busca de linhas); sem entrada, a rota responde 404.
 */
export const EXPORTERS: Partial<Record<RecordEntity, EntityExporter>> = {
  organizations: {
    filePrefix: "organizacoes",
    allowedSorts: ORGANIZATION_SORTS,
    columns: ORGANIZATION_EXPORT_COLUMNS,
    fetchRows: exportOrganizations,
  },
};
