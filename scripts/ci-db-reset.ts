// Recria do zero o banco do projeto Supabase de testes (oxyncrm-testes) e aplica as migrations desta branch.
// Uso manual: APAGA os dados de teste do site (o CI não usa mais este script; ele sobe um Supabase local).
// Trava: só roda quando SUPABASE_DB_URL é do projeto em SUPABASE_TEST_PROJECT_REF. A produção nunca bate com
// esse ref, então o script se recusa a apagar qualquer outro banco.
import { spawnSync } from "node:child_process";
import { isTestProjectUrl } from "./test-project";

function fail(msg: string): never {
  console.error(msg);
  process.exit(1);
}

const url = process.env.SUPABASE_DB_URL;
const ref = process.env.SUPABASE_TEST_PROJECT_REF?.trim();
if (!url) fail("SUPABASE_DB_URL ausente.");
if (!ref) fail("SUPABASE_TEST_PROJECT_REF ausente.");

if (!isTestProjectUrl(url, ref)) fail("SUPABASE_DB_URL não é do projeto de testes: nada foi apagado.");

console.log("Recriando o banco de testes e aplicando as migrations...");
const result = spawnSync("pnpm", ["exec", "supabase", "db", "reset", "--db-url", url, "--no-seed", "--yes"], {
  stdio: ["ignore", "inherit", "inherit"],
});
process.exit(result.status ?? 1);
