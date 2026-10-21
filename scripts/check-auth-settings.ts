// Falha se o cadastro aberto estiver ligado no projeto Supabase.
import { assertSignupDisabled } from "@/lib/auth/settings-check";
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
  console.log("Cadastro aberto desligado.");
}

main().catch((err) => {
  console.error((err as Error).message);
  process.exit(1);
});
