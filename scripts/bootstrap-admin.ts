// Cria (ou promove) o primeiro admin geral.
// Uso: pnpm bootstrap:admin <email> "<Nome>"
// Os módulos do app importam "server-only"; o script roda com
// --conditions=react-server para que esse import resolva para um no-op.
import { createAdminClient } from "@/lib/supabase/admin";
import { createAuthLink } from "@/lib/auth/links";
import { sendEmail } from "@/lib/email/send";
import { inviteEmail } from "@/lib/email/templates";
import { loadEnv } from "./load-env";

loadEnv();

const REQUIRED = [
  "NEXT_PUBLIC_SUPABASE_URL",
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
  const email = rawEmail.trim().toLowerCase();
  const admin = createAdminClient();

  const { data: existing, error: lookupError } = await admin
    .from("profiles")
    .select("id")
    .eq("email", email)
    .maybeSingle();
  if (lookupError) throw lookupError;

  let userId = existing?.id as string | undefined;
  const existed = Boolean(userId);

  if (!userId) {
    const { link, userId: createdId } = await createAuthLink("invite", email, {
      fullName: fullName.trim(),
    });
    userId = createdId;
    await sendEmail({ to: email, ...inviteEmail({ fullName: fullName.trim(), link }) });
  }

  const { error } = await admin
    .from("profiles")
    .update({ is_super_admin: true })
    .eq("id", userId);
  if (error) throw error;

  console.log(
    `Admin geral pronto: ${email}. ${existed ? "Usuário já existia." : "Convite enviado."}`,
  );
}

main().catch((err) => {
  console.error(`Falha ao preparar o admin geral: ${(err as Error).message}`);
  process.exit(1);
});
