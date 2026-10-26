"use server";

import { revalidatePath } from "next/cache";
import { getCurrentProfile } from "@/lib/auth/session";
import { translateDbError, type ActionResult } from "@/lib/db-errors";
import { createServerClient } from "@/lib/supabase/server";

const NO_PERMISSION = "Você não tem permissão para esta ação.";

export async function markNotificationRead(id: number): Promise<ActionResult> {
  if (!Number.isSafeInteger(id) || id <= 0) return { ok: false, error: "Dados inválidos." };
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, error: NO_PERMISSION };
  const supabase = await createServerClient();
  const { error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", id)
    .is("read_at", null);
  if (error) return { ok: false, error: translateDbError(error) };
  revalidatePath("/", "layout");
  return { ok: true, data: undefined };
}

export async function markAllNotificationsRead(): Promise<ActionResult> {
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, error: NO_PERMISSION };
  const supabase = await createServerClient();
  const { error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("user_id", profile.id)
    .is("read_at", null);
  if (error) return { ok: false, error: translateDbError(error) };
  revalidatePath("/", "layout");
  return { ok: true, data: undefined };
}
