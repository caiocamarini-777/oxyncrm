"use server";

import { revalidatePath } from "next/cache";
import { requireSuperAdmin } from "@/lib/auth/session";
import { createAuthLink } from "@/lib/auth/links";
import { inviteEmail } from "@/lib/email/templates";
import { sendEmail } from "@/lib/email/send";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerClient } from "@/lib/supabase/server";
import { translateDbError, type ActionResult } from "@/lib/db-errors";
import { z } from "zod";
import { accessListSchema, inviteSchema, type Access, type InviteInput } from "./schema";

export type UserRow = {
  id: string;
  fullName: string;
  email: string;
  avatarUrl: string | null;
  isSuperAdmin: boolean;
  active: boolean;
  pending: boolean;
  access: { companyId: string; companyName: string; roleId: string; roleName: string }[];
  teams: { id: string; name: string }[];
};

const EXISTS = "Já existe um usuário com este e-mail.";
const GENERIC = "Não foi possível concluir. Tente novamente.";
const REFRESH = () => revalidatePath("/configuracoes/usuarios");

function isEmailExists(err: unknown): boolean {
  const e = err as { code?: string; message?: string } | null;
  const msg = (e?.message ?? "").toLowerCase();
  return e?.code === "email_exists" || msg.includes("already been registered") || msg.includes("already exists");
}

export async function inviteUser(input: InviteInput): Promise<ActionResult<{ userId: string }>> {
  await requireSuperAdmin();
  const parsed = inviteSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "");
      if (key && !fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    return { ok: false, error: "Corrija os campos destacados.", fieldErrors };
  }
  const v = parsed.data;

  let link: string;
  let userId: string;
  try {
    ({ link, userId } = await createAuthLink("invite", v.email, { fullName: v.fullName }));
  } catch (err) {
    if (isEmailExists(err)) {
      return { ok: false, error: EXISTS, fieldErrors: { email: EXISTS } };
    }
    return { ok: false, error: GENERIC };
  }

  const admin = createAdminClient();
  const rollback = async (error: string): Promise<ActionResult<never>> => {
    await admin.auth.admin.deleteUser(userId).catch(() => {});
    return { ok: false, error };
  };

  const supabase = await createServerClient();
  if (v.isSuperAdmin) {
    const { error } = await supabase
      .from("profiles")
      .update({ is_super_admin: true })
      .eq("id", userId);
    if (error) return rollback(translateDbError(error));
  }
  if (v.access.length > 0) {
    const { error } = await supabase.from("memberships").insert(
      v.access.map((a) => ({ user_id: userId, company_id: a.companyId, role_id: a.roleId })),
    );
    if (error) return rollback(translateDbError(error));
  }
  if (v.teamIds.length > 0) {
    const { error } = await supabase
      .from("team_members")
      .insert(v.teamIds.map((team_id) => ({ team_id, user_id: userId })));
    if (error) return rollback(translateDbError(error));
  }

  try {
    await sendEmail({ to: v.email, ...inviteEmail({ fullName: v.fullName, link }) });
  } catch {
    return rollback("Não foi possível enviar o e-mail de convite. Tente novamente.");
  }
  REFRESH();
  return { ok: true, data: { userId } };
}

export async function setUserAccess(userId: string, access: Access[]): Promise<ActionResult> {
  await requireSuperAdmin();
  const parsed = accessListSchema.safeParse(access);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const uid = z.string().uuid().safeParse(userId);
  if (!uid.success) return { ok: false, error: GENERIC };
  const supabase = await createServerClient();
  const { data: current, error: readError } = await supabase
    .from("memberships")
    .select("id, company_id, role_id")
    .eq("user_id", userId);
  if (readError) return { ok: false, error: translateDbError(readError) };
  const wanted = new Map(parsed.data.map((a) => [a.companyId, a.roleId]));
  const existing = new Map((current ?? []).map((m) => [m.company_id, m]));

  const removeIds = (current ?? []).filter((m) => !wanted.has(m.company_id)).map((m) => m.id);
  if (removeIds.length > 0) {
    const { error } = await supabase.from("memberships").delete().in("id", removeIds);
    if (error) return { ok: false, error: translateDbError(error) };
  }
  for (const [companyId, roleId] of wanted) {
    const row = existing.get(companyId);
    if (row && row.role_id !== roleId) {
      const { error } = await supabase.from("memberships").update({ role_id: roleId }).eq("id", row.id);
      if (error) return { ok: false, error: translateDbError(error) };
    }
  }
  const toAdd = [...wanted].filter(([c]) => !existing.has(c));
  if (toAdd.length > 0) {
    const { error } = await supabase
      .from("memberships")
      .insert(toAdd.map(([company_id, role_id]) => ({ user_id: userId, company_id, role_id })));
    if (error) return { ok: false, error: translateDbError(error) };
  }
  REFRESH();
  return { ok: true, data: undefined };
}

export async function setUserTeams(userId: string, teamIds: string[]): Promise<ActionResult> {
  await requireSuperAdmin();
  const wanted = z.array(z.string().uuid()).safeParse(teamIds);
  if (!wanted.success || !z.string().uuid().safeParse(userId).success) {
    return { ok: false, error: GENERIC };
  }
  const want = new Set(wanted.data);
  const supabase = await createServerClient();
  const { data: current, error: readError } = await supabase
    .from("team_members")
    .select("team_id")
    .eq("user_id", userId);
  if (readError) return { ok: false, error: translateDbError(readError) };
  const existing = new Set((current ?? []).map((r) => r.team_id));
  const toRemove = [...existing].filter((t) => !want.has(t));
  const toAdd = [...want].filter((t) => !existing.has(t));
  if (toRemove.length > 0) {
    const { error } = await supabase
      .from("team_members")
      .delete()
      .eq("user_id", userId)
      .in("team_id", toRemove);
    if (error) return { ok: false, error: translateDbError(error) };
  }
  if (toAdd.length > 0) {
    const { error } = await supabase
      .from("team_members")
      .insert(toAdd.map((team_id) => ({ team_id, user_id: userId })));
    if (error) return { ok: false, error: translateDbError(error) };
  }
  REFRESH();
  return { ok: true, data: undefined };
}

export async function setSuperAdmin(userId: string, value: boolean): Promise<ActionResult> {
  await requireSuperAdmin();
  if (!z.string().uuid().safeParse(userId).success) return { ok: false, error: GENERIC };
  const supabase = await createServerClient();
  const { error } = await supabase
    .from("profiles")
    .update({ is_super_admin: value })
    .eq("id", userId);
  if (error) return { ok: false, error: translateDbError(error) };
  REFRESH();
  return { ok: true, data: undefined };
}

export async function setUserActive(userId: string, active: boolean): Promise<ActionResult> {
  const me = await requireSuperAdmin();
  if (userId === me.id) {
    return { ok: false, error: "Você não pode alterar o seu próprio acesso." };
  }
  if (!z.string().uuid().safeParse(userId).success) return { ok: false, error: GENERIC };
  const supabase = await createServerClient();
  const { error } = await supabase.from("profiles").update({ active }).eq("id", userId);
  if (error) return { ok: false, error: translateDbError(error) };
  const { error: banError } = await createAdminClient().auth.admin.updateUserById(userId, {
    ban_duration: active ? "none" : "876000h",
  });
  if (banError) {
    await supabase.from("profiles").update({ active: !active }).eq("id", userId);
    return { ok: false, error: GENERIC };
  }
  REFRESH();
  return { ok: true, data: undefined };
}

export async function resendInvite(userId: string): Promise<ActionResult> {
  await requireSuperAdmin();
  if (!z.string().uuid().safeParse(userId).success) return { ok: false, error: GENERIC };
  const supabase = await createServerClient();
  const { data: profile } = await supabase
    .from("profiles")
    .select("email, full_name")
    .eq("id", userId)
    .maybeSingle();
  if (!profile) return { ok: false, error: GENERIC };
  try {
    const { link } = await createAuthLink("recovery", profile.email);
    await sendEmail({
      to: profile.email,
      ...inviteEmail({ fullName: profile.full_name, link }),
    });
  } catch {
    return { ok: false, error: "Não foi possível reenviar o convite. Tente novamente." };
  }
  return { ok: true, data: undefined };
}

export async function listUsers(): Promise<UserRow[]> {
  await requireSuperAdmin();
  const supabase = await createServerClient();
  const [profiles, memberships, teamMembers] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, full_name, email, avatar_url, is_super_admin, active")
      .order("full_name"),
    supabase.from("memberships").select("user_id, company_id, role_id, companies(name), roles(name)"),
    supabase.from("team_members").select("user_id, team_id, teams(name)"),
  ]);

  const pendingIds = new Set<string>();
  const admin = createAdminClient();
  for (let page = 1; page < 50; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error || !data) break;
    for (const u of data.users) if (!u.email_confirmed_at) pendingIds.add(u.id);
    if (data.users.length < 200) break;
  }

  return (profiles.data ?? []).map((p) => ({
    id: p.id,
    fullName: p.full_name,
    email: p.email,
    avatarUrl: p.avatar_url,
    isSuperAdmin: p.is_super_admin,
    active: p.active,
    pending: pendingIds.has(p.id),
    access: (memberships.data ?? [])
      .filter((m) => m.user_id === p.id)
      .map((m) => ({
        companyId: m.company_id,
        companyName: (m.companies as unknown as { name: string } | null)?.name ?? "",
        roleId: m.role_id,
        roleName: (m.roles as unknown as { name: string } | null)?.name ?? "",
      })),
    teams: (teamMembers.data ?? [])
      .filter((t) => t.user_id === p.id)
      .map((t) => ({
        id: t.team_id,
        name: (t.teams as unknown as { name: string } | null)?.name ?? "",
      })),
  }));
}
