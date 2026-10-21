import { TeamsManager, type TeamItem, type PersonOption } from "@/components/settings/team-form";
import { requireSuperAdmin } from "@/lib/auth/session";
import { createServerClient } from "@/lib/supabase/server";

export const instant = false;

export default async function TeamsSettingsPage() {
  await requireSuperAdmin();
  const supabase = await createServerClient();
  const [{ data: teams }, { data: members }, { data: profiles }] = await Promise.all([
    supabase.from("teams").select("id, name").order("name"),
    supabase.from("team_members").select("team_id, user_id"),
    supabase
      .from("profiles")
      .select("id, full_name, email, avatar_url")
      .eq("active", true)
      .order("full_name"),
  ]);
  const people: PersonOption[] = (profiles ?? []).map((p) => ({
    id: p.id,
    name: p.full_name,
    email: p.email,
    avatarUrl: p.avatar_url,
  }));
  const byId = new Map(people.map((p) => [p.id, p]));
  const items: TeamItem[] = (teams ?? []).map((t) => ({
    id: t.id,
    name: t.name,
    members: (members ?? [])
      .filter((m) => m.team_id === t.id)
      .map((m) => byId.get(m.user_id))
      .filter((p): p is PersonOption => Boolean(p)),
  }));
  return <TeamsManager teams={items} people={people} />;
}
