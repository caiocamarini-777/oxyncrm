// Aplica as migrations pendentes no banco do site de testes (projeto Supabase oxyncrm-testes), sem apagar nada.
// Trava: só roda quando SUPABASE_DB_URL é do projeto em SUPABASE_TEST_PROJECT_REF (a produção nunca bate).
import { spawnSync } from "node:child_process";
import { isTestProjectUrl } from "./test-project";

const url = process.env.SUPABASE_DB_URL;
const ref = process.env.SUPABASE_TEST_PROJECT_REF?.trim();
if (!url || !ref || !isTestProjectUrl(url, ref)) {
  console.error("SUPABASE_DB_URL não é do projeto de testes: nada foi aplicado.");
  process.exit(1);
}
const result = spawnSync("pnpm", ["exec", "supabase", "db", "push", "--db-url", url, "--include-all", "--yes"], {
  stdio: ["ignore", "inherit", "inherit"],
});
process.exit(result.status ?? 1);
