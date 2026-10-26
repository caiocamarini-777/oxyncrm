import { cache } from "react";
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

/** Memoizado por requisição: layouts e páginas chamam sem custo extra. */
export const getCurrentProfile = cache(async (): Promise<Profile | null> => {
  await connection(); // leitura de sessão é sempre em tempo de requisição
  const supabase = await createServerClient();
  // getClaims valida o JWT localmente (chaves assimétricas) em vez de ir ao Auth.
  // Usuário desativado continua barrado: abaixo, `profiles.active` via RLS.
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims.sub;
  if (!userId) return null;
  const { data } = await supabase
    .from("profiles")
    .select("id, full_name, email, avatar_url, is_super_admin, active")
    .eq("id", userId)
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
});

export const requireUser = cache(async (): Promise<Profile> => {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/entrar");
  if (!profile.active) {
    const supabase = await createServerClient();
    await supabase.auth.signOut();
    redirect("/entrar?erro=inativo");
  }
  return profile;
});

export const requireSuperAdmin = cache(async (): Promise<Profile> => {
  const profile = await requireUser();
  if (!profile.isSuperAdmin) notFound();
  return profile;
});
