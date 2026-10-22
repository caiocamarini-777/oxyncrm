import { notFound } from "next/navigation";
import { RoleEditor } from "@/components/settings/role-editor";
import { requireSuperAdmin } from "@/lib/auth/session";
import { permissionsSchema } from "@/lib/permissions/schema";
import { createServerClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/uuid";

export const instant = false;

export default async function RolePage({ params }: { params: Promise<{ id: string }> }) {
  await requireSuperAdmin();
  const { id } = await params;
  if (!isUuid(id)) notFound();
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
