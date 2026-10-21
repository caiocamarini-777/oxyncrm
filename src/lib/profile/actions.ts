"use server";

import { revalidatePath } from "next/cache";
import { validatePassword } from "@/lib/auth/password";
import { requireUser } from "@/lib/auth/session";
import { translateDbError, type ActionResult } from "@/lib/db-errors";
import { createServerClient } from "@/lib/supabase/server";
import { AVATAR_ERROR, AVATAR_MAX_BYTES, AVATAR_TYPES } from "./avatar";

export async function updateProfile(input: { fullName: string }): Promise<ActionResult> {
  const user = await requireUser();
  const fullName = input.fullName.trim();
  if (!fullName) {
    return { ok: false, error: "Informe o nome.", fieldErrors: { fullName: "Informe o nome." } };
  }
  if (fullName.length > 120) {
    const message = "O nome pode ter no máximo 120 caracteres.";
    return { ok: false, error: message, fieldErrors: { fullName: message } };
  }
  const supabase = await createServerClient();
  const { error } = await supabase.from("profiles").update({ full_name: fullName }).eq("id", user.id);
  if (error) return { ok: false, error: translateDbError(error) };
  revalidatePath("/", "layout");
  return { ok: true, data: undefined };
}

export async function uploadAvatar(file: File): Promise<ActionResult<{ url: string }>> {
  const user = await requireUser();
  const ext = AVATAR_TYPES[file?.type as keyof typeof AVATAR_TYPES];
  if (!(file instanceof File) || !ext || file.size > AVATAR_MAX_BYTES || file.size === 0) {
    return { ok: false, error: AVATAR_ERROR };
  }
  const supabase = await createServerClient();
  const path = `${user.id}/${Date.now()}.${ext}`;
  const { error: upErr } = await supabase.storage
    .from("avatars")
    .upload(path, file, { contentType: file.type, upsert: false });
  if (upErr) return { ok: false, error: "Não foi possível enviar a foto. Tente novamente." };
  const { data } = supabase.storage.from("avatars").getPublicUrl(path);
  const { error } = await supabase
    .from("profiles")
    .update({ avatar_url: data.publicUrl })
    .eq("id", user.id);
  if (error) {
    await supabase.storage.from("avatars").remove([path]);
    return { ok: false, error: translateDbError(error) };
  }
  revalidatePath("/", "layout");
  return { ok: true, data: { url: data.publicUrl } };
}

export async function changePassword(input: {
  password: string;
  confirm: string;
}): Promise<ActionResult> {
  await requireUser();
  const invalid = validatePassword(input.password, input.confirm);
  if (invalid) return { ok: false, error: invalid };
  const supabase = await createServerClient();
  const { error } = await supabase.auth.updateUser({ password: input.password });
  if (error) return { ok: false, error: "Não foi possível alterar a senha. Tente novamente." };
  return { ok: true, data: undefined };
}
