import "server-only";
import { getCurrentProfile } from "@/lib/auth/session";
import { createServerClient } from "@/lib/supabase/server";
import type { EntityPermissions, RecordEntity } from "./types";

const NONE: EntityPermissions = { create: false, edit: false, delete: false, export: false, reassign: false };

/** Só para esconder botões; o banco continua sendo a barreira. */
export async function getEntityPermissions(
  companyId: string,
  // As permissões de ação são por papel/empresa; `entity` fica na assinatura para evoluir.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _entity: RecordEntity,
): Promise<EntityPermissions> {
  const profile = await getCurrentProfile();
  if (!profile || !profile.active) return NONE;
  if (profile.isSuperAdmin) return { create: true, edit: true, delete: true, export: true, reassign: true };
  const supabase = await createServerClient();
  const { data } = await supabase.rpc("role_permissions", { p_company: companyId });
  const actions = (data as { actions?: Record<string, unknown> } | null)?.actions;
  if (!actions) return NONE;
  return {
    create: actions.create === true,
    edit: actions.edit === true,
    delete: actions.delete === true,
    export: actions.export === true,
    reassign: actions.reassign_owner === true,
  };
}

/** Empresas onde o usuário pode criar registros da entidade (admin geral: todas). */
export async function listCompaniesWithCreate(
  companyIds: string[],
  entity: RecordEntity,
): Promise<string[]> {
  const out: string[] = [];
  for (const id of companyIds) {
    if ((await getEntityPermissions(id, entity)).create) out.push(id);
  }
  return out;
}
