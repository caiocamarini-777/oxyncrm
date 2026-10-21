import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

export async function createAuthLink(
  type: "invite" | "recovery",
  email: string,
  opts?: { fullName?: string },
): Promise<{ link: string; userId: string }> {
  const site = process.env.NEXT_PUBLIC_SITE_URL;
  if (!site) throw new Error("NEXT_PUBLIC_SITE_URL não configurado");
  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.generateLink({
    type,
    email,
    options: {
      data: type === "invite" ? { full_name: opts?.fullName ?? "" } : undefined,
    },
  } as Parameters<typeof admin.auth.admin.generateLink>[0]);
  if (error || !data) throw error ?? new Error("Não foi possível gerar o link.");
  const link = `${site}/auth/confirm?token_hash=${data.properties.hashed_token}&type=${type}&next=/definir-senha`;
  return { link, userId: data.user.id };
}
