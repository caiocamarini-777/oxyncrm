import "server-only";
import { cache } from "react";
import { fail } from "./list-helpers";
import { createServerClient } from "@/lib/supabase/server";
import type { AssignableOwner } from "./types";

/** Membros da empresa e admins gerais visíveis por RLS; ativos primeiro, depois por nome. */
export const listAssignableOwners = cache(async (companyId: string): Promise<AssignableOwner[]> => {
  const supabase = await createServerClient();
  const { data: members, error: membersError } = await supabase
    .from("memberships")
    .select("user_id")
    .eq("company_id", companyId);
  if (membersError) fail("configurações", "responsáveis", membersError);
  const ids = (members ?? []).map((m) => m.user_id);
  const filter = ids.length > 0 ? `id.in.(${ids.join(",")}),is_super_admin.eq.true` : "is_super_admin.eq.true";
  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, avatar_url, active")
    .or(filter);
  if (error) fail("configurações", "responsáveis", error);
  return (data ?? [])
    .map((p) => ({ id: p.id, fullName: p.full_name, avatarUrl: p.avatar_url, active: p.active }))
    .sort((a, b) => Number(b.active) - Number(a.active) || a.fullName.localeCompare(b.fullName, "pt-BR"));
});
