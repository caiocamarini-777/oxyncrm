// Falha se o cadastro aberto estiver ligado ou se o login por e-mail estiver desligado no projeto Supabase.
import { assertEmailLoginEnabled, assertSignupDisabled } from "@/lib/auth/settings-check";
import { loadEnv } from "./load-env";

loadEnv();

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    console.error("NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY são obrigatórias.");
    process.exit(1);
  }
  await assertSignupDisabled(url, key);
  await assertEmailLoginEnabled(url, key);
  console.log("Cadastro aberto desligado e login por e-mail ligado.");
}

main().catch((err) => {
  console.error((err as Error).message);
  process.exit(1);
});
