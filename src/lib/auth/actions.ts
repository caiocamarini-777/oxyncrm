"use server";

import { redirect } from "next/navigation";
import { createAuthLink } from "@/lib/auth/links";
import { recoveryEmail } from "@/lib/email/templates";
import { sendEmail } from "@/lib/email/send";
import { createServerClient } from "@/lib/supabase/server";

/** Nunca revela se o e-mail existe e nunca lança erro ao cliente. */
export async function requestPasswordReset(email: string): Promise<void> {
  try {
    const clean = email.trim().toLowerCase();
    if (!clean) return;
    const { link } = await createAuthLink("recovery", clean);
    await sendEmail({ to: clean, ...recoveryEmail({ link }) });
  } catch (err) {
    // "user not found" e falhas de envio são engolidas de propósito.
    console.error("requestPasswordReset falhou", err instanceof Error ? err.message : err);
  }
}

export async function signOut(): Promise<void> {
  const supabase = await createServerClient();
  await supabase.auth.signOut();
  redirect("/entrar");
}
