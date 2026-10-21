import { RolesTable, type RoleListItem } from "@/components/settings/roles-table";
import { requireSuperAdmin } from "@/lib/auth/session";
import { createServerClient } from "@/lib/supabase/server";

export const instant = false;

export default async function RolesSettingsPage() {
  await requireSuperAdmin();
  const supabase = await createServerClient();
  const [{ data: roles }, { data: memberships }] = await Promise.all([
    supabase.from("roles").select("id, name, description, is_system").order("name"),
    supabase.from("memberships").select("role_id"),
  ]);
  const counts = new Map<string, number>();
  for (const m of memberships ?? []) {
    counts.set(m.role_id, (counts.get(m.role_id) ?? 0) + 1);
  }
  const items: RoleListItem[] = (roles ?? []).map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    isSystem: r.is_system,
    usage: counts.get(r.id) ?? 0,
  }));
  return <RolesTable roles={items} />;
}
