import type { ActivityCatalog } from "@/lib/activities/queries";
import type { RecordActivityData } from "@/lib/activities/record-context";
import type { AssignableOwner } from "@/lib/records/types";

export type CompanyCtx = {
  id: string;
  slug: string;
  name: string;
  catalog: ActivityCatalog;
  owners: AssignableOwner[];
  canCreate: boolean;
  canEdit: boolean;
  canReassign: boolean;
};

/** Dados serializáveis que a página de atividades passa às visões (lista, semana, mês). */
export type PageCtx = {
  companies: CompanyCtx[];
  currentUserId: string;
  nowIso: string;
  /** Visão "Todas as empresas": mostra a empresa de cada atividade. */
  allCompanies: boolean;
};

/** Dados no formato que o `CompleteDialog` espera, sem registro de origem (a atividade traz os vínculos). */
export function completeDataFor(ctx: PageCtx, company: CompanyCtx): RecordActivityData {
  return {
    companyId: company.id,
    entity: "leads",
    recordId: "",
    links: { leadId: null, dealId: null, personId: null, organizationId: null },
    partyName: "",
    open: [],
    catalog: company.catalog,
    owners: company.owners,
    currentUserId: ctx.currentUserId,
    canCreate: company.canCreate,
    canEdit: company.canEdit,
    canReassign: company.canReassign,
    nowIso: ctx.nowIso,
  };
}
