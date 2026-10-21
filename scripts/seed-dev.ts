// Seed de desenvolvimento (idempotente): admin geral e empresas oxyn e volt.
import { createClient } from "@supabase/supabase-js";
import { loadEnv } from "./load-env";

loadEnv();

const ADMIN_EMAIL = "admin@oxyn.test";
const ADMIN_PASSWORD = "oxyn-dev-123";

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórios em .env.local.");
    process.exit(1);
  }
  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let userId: string | undefined;
  for (let page = 1; !userId; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    userId = data.users.find((u) => u.email === ADMIN_EMAIL)?.id;
    if (data.users.length < 200) break;
  }

  if (!userId) {
    const { data, error } = await admin.auth.admin.createUser({
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: "Admin Oxyn" },
    });
    if (error) throw error;
    userId = data.user.id;
  }

  const { error: profileError } = await admin
    .from("profiles")
    .update({ is_super_admin: true })
    .eq("id", userId);
  if (profileError) throw profileError;

  const { error: companiesError } = await admin.from("companies").upsert(
    [
      { slug: "oxyn", name: "Oxyn" },
      { slug: "volt", name: "Volt" },
    ],
    { onConflict: "slug" },
  );
  if (companiesError) throw companiesError;

  console.log("Seed concluído: admin@oxyn.test, empresas oxyn e volt.");
}

main().catch((err) => {
  console.error((err as Error).message);
  process.exit(1);
});
