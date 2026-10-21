import { notFound } from "next/navigation";
import { RoleEditor } from "@/components/settings/role-editor";
import { requireSuperAdmin } from "@/lib/auth/session";
import { permissionsSchema } from "@/lib/permissions/schema";
import { createServerClient } from "@/lib/supabase/server";

export const instant = false;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function RolePage({ params }: { params: Promise<{ id: string }> }) {
  await requireSuperAdmin();
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const supabase = await createServerClient();
  const { data: role } = await supabase
    .from("roles")
    .select("id, name, description, is_system, permissions")
    .eq("id", id)
    .maybeSingle();
  if (!role) notFound();
  const permissions = permissionsSchema.parse(role.permissions);
  return (
    <RoleEditor
      key={`${role.id}`}
      role={{
        id: role.id,
        name: role.name,
        description: role.description ?? "",
        isSystem: role.is_system,
        permissions,
      }}
    />
  );
}
