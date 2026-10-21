"use server";

import { after } from "next/server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { validatePassword } from "@/lib/auth/password";
import { createAuthLink } from "@/lib/auth/links";
import { recoveryEmail } from "@/lib/email/templates";
import { sendEmail } from "@/lib/email/send";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerClient } from "@/lib/supabase/server";

const WINDOW = "15 minutes";

async function allow(key: string, max: number): Promise<boolean> {
  const { data, error } = await createAdminClient().rpc("consume_email_quota", {
    p_key: key,
    p_max: max,
    p_window: WINDOW,
  });
  return !error && data === true;
}

/** Nunca revela se o e-mail existe, nunca lança erro e responde em tempo constante. */
export async function requestPasswordReset(email: string): Promise<void> {
  const clean = email.trim().toLowerCase();
  if (!clean) return;
  const h = await headers();
  const ip =
    h.get("x-vercel-forwarded-for")?.split(",")[0]?.trim() ||
    h.get("x-real-ip")?.trim() ||
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    null;

  after(async () => {
    try {
      if (!(await allow(`recovery:email:${clean}`, 3))) return;
      // Sem cabeçalho de IP (ex.: dev local) só vale o limite por e-mail.
      if (ip && !(await allow(`recovery:ip:${ip}`, 10))) return;
      const { link } = await createAuthLink("recovery", clean);
      await sendEmail({ to: clean, ...recoveryEmail({ link }) });
    } catch (err) {
      // "user not found" e falhas de envio são engolidas de propósito.
      console.error("requestPasswordReset falhou", err instanceof Error ? err.message : err);
    }
  });
}

export async function signOut(): Promise<void> {
  const supabase = await createServerClient();
  await supabase.auth.signOut();
  redirect("/entrar");
}

export type SetPasswordState = { error: string | null };

export async function setPassword(
  _prev: SetPasswordState,
  formData: FormData,
): Promise<SetPasswordState> {
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");
  const invalid = validatePassword(password, confirm);
  if (invalid) return { error: invalid };
  const supabase = await createServerClient();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { error: "Não foi possível salvar a senha. Tente novamente." };
  redirect("/");
}
