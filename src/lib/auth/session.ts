import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { createServerClient } from "@/lib/supabase/server";

export type Profile = {
  id: string;
  fullName: string;
  email: string;
  avatarUrl: string | null;
  isSuperAdmin: boolean;
  active: boolean;
};

export async function getCurrentProfile(): Promise<Profile | null> {
  await connection(); // leitura de sessão é sempre em tempo de requisição
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase
    .from("profiles")
    .select("id, full_name, email, avatar_url, is_super_admin, active")
    .eq("id", user.id)
    .maybeSingle();
  if (!data) return null;
  return {
    id: data.id,
    fullName: data.full_name,
    email: data.email,
    avatarUrl: data.avatar_url,
    isSuperAdmin: data.is_super_admin,
    active: data.active,
  };
}

export async function requireUser(): Promise<Profile> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/entrar");
  if (!profile.active) {
    const supabase = await createServerClient();
    await supabase.auth.signOut();
    redirect("/entrar?erro=inativo");
  }
  return profile;
}

export async function requireSuperAdmin(): Promise<Profile> {
  const profile = await requireUser();
  if (!profile.isSuperAdmin) notFound();
  return profile;
}
