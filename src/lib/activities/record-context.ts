import "server-only";
import { connection } from "next/server";
import { getCurrentProfile } from "@/lib/auth/session";
import { listAssignableOwners } from "@/lib/records/owners";
import { getEntityPermissions } from "@/lib/records/permissions";
import type { AssignableOwner, RecordEntity } from "@/lib/records/types";
import {
  getActivitiesFor,
  getActivityCatalog,
  getCalendarSyncEnabled,
  getRecordPersonHasEmail,
  type ActivityCatalog,
  type ActivityRow,
} from "./queries";

export type RecordLinks = {
  leadId: string | null;
  dealId: string | null;
  personId: string | null;
  organizationId: string | null;
};

/** Tudo que a aba Atividade e a seção Planejado precisam; serializável para os componentes de cliente. */
export type RecordActivityData = {
  companyId: string;
  entity: RecordEntity;
  recordId: string;
  links: RecordLinks;
  /** Pessoa ou organização do registro, para sugerir "Reunião com ...". */
  partyName: string;
  /**
   * A pessoa do registro tem e-mail: a da página da pessoa, ou a do negócio ou do lead (a reunião sem pessoa convida
   * a pessoa do registro pela Agenda).
   */
  personHasEmail: boolean;
  /** A empresa sincroniza com a Agenda do Google (mostra o aviso do convite no formulário). */
  calendarSync: boolean;
  open: ActivityRow[];
  catalog: ActivityCatalog;
  owners: AssignableOwner[];
  currentUserId: string;
  canCreate: boolean;
  canEdit: boolean;
  canReassign: boolean;
  nowIso: string;
};

const LINK_KEY = {
  leads: "leadId",
  deals: "dealId",
  persons: "personId",
  organizations: "organizationId",
} as const;

/** Carrega as atividades abertas do registro e o catálogo da empresa (só ativos entram nos formulários). */
export async function loadRecordActivity(input: {
  entity: RecordEntity;
  recordId: string;
  companyId: string;
  partyName: string;
  /** Na página da pessoa: ela tem e-mail. */
  personHasEmail?: boolean;
  owners?: AssignableOwner[];
}): Promise<RecordActivityData> {
  await connection();
  const now = new Date();
  const recordPerson =
    input.personHasEmail !== undefined || (input.entity !== "deals" && input.entity !== "leads")
      ? Promise.resolve(input.personHasEmail ?? false)
      : getRecordPersonHasEmail(input.entity, input.recordId);
  const [profile, perms, activities, catalog, calendarSync, owners, personHasEmail] = await Promise.all([
    getCurrentProfile(),
    getEntityPermissions(input.companyId, input.entity),
    getActivitiesFor(input.entity, input.recordId, now),
    getActivityCatalog(input.companyId),
    getCalendarSyncEnabled(input.companyId),
    input.owners ? Promise.resolve(input.owners) : listAssignableOwners(input.companyId),
    recordPerson,
  ]);
  const links: RecordLinks = { leadId: null, dealId: null, personId: null, organizationId: null };
  links[LINK_KEY[input.entity]] = input.recordId;
  return {
    companyId: input.companyId,
    entity: input.entity,
    recordId: input.recordId,
    links,
    partyName: input.partyName,
    personHasEmail,
    calendarSync,
    open: activities.open,
    catalog,
    owners,
    currentUserId: profile?.id ?? "",
    canCreate: perms.create,
    canEdit: perms.edit,
    canReassign: perms.reassign,
    nowIso: now.toISOString(),
  };
}
