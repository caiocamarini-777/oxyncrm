import { UsersTable } from "@/components/settings/users-table";
import { requireSuperAdmin } from "@/lib/auth/session";
import { createServerClient } from "@/lib/supabase/server";
import { listUsers } from "@/lib/users/actions";

export const instant = false;

export default async function UsersSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ convidar?: string }>;
}) {
  const me = await requireSuperAdmin();
  const { convidar } = await searchParams;
  const supabase = await createServerClient();
  const [users, companies, roles, teams] = await Promise.all([
    listUsers(),
    supabase.from("companies").select("id, name").is("archived_at", null).order("name"),
    supabase.from("roles").select("id, name").order("name"),
    supabase.from("teams").select("id, name").order("name"),
  ]);
  return (
    <UsersTable
      users={users}
      currentUserId={me.id}
      companies={companies.data ?? []}
      roles={roles.data ?? []}
      teams={teams.data ?? []}
      openInvite={convidar === "1"}
    />
  );
}
