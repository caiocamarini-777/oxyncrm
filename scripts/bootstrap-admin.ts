// Cria (ou promove) o primeiro admin geral.
// Uso: pnpm bootstrap:admin <email> "<Nome>"
// Os módulos do app importam "server-only"; o script roda com
// --conditions=react-server para que esse import resolva para um no-op.
import { assertSignupDisabled } from "@/lib/auth/settings-check";
import { createAdminClient } from "@/lib/supabase/admin";
import { createAuthLink } from "@/lib/auth/links";
import { sendEmail } from "@/lib/email/send";
import { inviteEmail } from "@/lib/email/templates";
import { loadEnv } from "./load-env";

loadEnv();

const REQUIRED = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "NEXT_PUBLIC_SITE_URL",
] as const;

async function main() {
  const [rawEmail, fullName] = process.argv.slice(2);
  if (!rawEmail || !fullName?.trim()) {
    console.error('Uso: pnpm bootstrap:admin <email> "<Nome>"');
    process.exit(1);
  }
  for (const name of REQUIRED) {
    if (!process.env[name]) {
      console.error(`Variável de ambiente ausente: ${name}.`);
      process.exit(1);
    }
  }
  await assertSignupDisabled(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
  const email = rawEmail.trim().toLowerCase();
  const admin = createAdminClient();

  const { data: existing, error: lookupError } = await admin
    .from("profiles")
    .select("id")
    .eq("email", email)
    .maybeSingle();
  if (lookupError) throw lookupError;

  const name = fullName.trim();
  const markAdmin = async (id: string) => {
    const { error } = await admin
      .from("profiles")
      .update({ is_super_admin: true })
      .eq("id", id);
    if (error) throw error;
  };

  let userId = existing?.id as string | undefined;
  let outcome: string;

  if (!userId) {
    const { link, userId: createdId } = await createAuthLink("invite", email, {
      fullName: name,
    });
    userId = createdId;
    await markAdmin(userId);
    try {
      await sendEmail({ to: email, ...inviteEmail({ fullName: name, link }) });
    } catch (err) {
      console.error(
        `O usuário foi criado, mas o e-mail não foi enviado (${(err as Error).message}). Rode o comando novamente para reenviar o convite.`,
      );
      process.exit(1);
    }
    outcome = "Convite enviado.";
  } else {
    await markAdmin(userId);
    const { data: u, error: userError } = await admin.auth.admin.getUserById(userId);
    if (userError) throw userError;
    if (u.user?.email_confirmed_at) {
      outcome = "Usuário já existia.";
    } else {
      const { link } = await createAuthLink("recovery", email);
      try {
        await sendEmail({ to: email, ...inviteEmail({ fullName: name, link }) });
      } catch (err) {
        console.error(
          `O e-mail não foi enviado (${(err as Error).message}). Rode o comando novamente para reenviar o convite.`,
        );
        process.exit(1);
      }
      outcome = "Convite reenviado.";
    }
  }

  console.log(`Admin geral pronto: ${email}. ${outcome}`);
}

main().catch((err) => {
  console.error(`Falha ao preparar o admin geral: ${(err as Error).message}`);
  process.exit(1);
});
