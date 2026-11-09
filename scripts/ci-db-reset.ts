// Recria do zero o banco do projeto Supabase de testes (oxyncrm-testes) e aplica as migrations desta branch.
// Roda no CI antes dos testes de banco e dos e2e: cada execução começa limpa e testa as migrations do PR.
// Trava: só roda quando SUPABASE_DB_URL é do projeto em SUPABASE_TEST_PROJECT_REF. A produção nunca bate com
// esse ref, então o script se recusa a apagar qualquer outro banco.
import { spawnSync } from "node:child_process";

function fail(msg: string): never {
  console.error(msg);
  process.exit(1);
}

const url = process.env.SUPABASE_DB_URL;
const ref = process.env.SUPABASE_TEST_PROJECT_REF?.trim();
if (!url) fail("SUPABASE_DB_URL ausente.");
if (!ref || !/^[a-z0-9]{20}$/.test(ref)) fail("SUPABASE_TEST_PROJECT_REF ausente ou inválido.");

let host: string;
let user: string;
try {
  const u = new URL(url);
  host = u.hostname;
  user = decodeURIComponent(u.username);
} catch {
  fail("SUPABASE_DB_URL inválida.");
}
// Pooler: usuário postgres.<ref>; conexão direta: host db.<ref>.supabase.co.
const isTestProject = user === `postgres.${ref}` || host === `db.${ref}.supabase.co`;
if (!isTestProject) fail("SUPABASE_DB_URL não é do projeto de testes: nada foi apagado.");

console.log("Recriando o banco de testes e aplicando as migrations...");
const result = spawnSync("pnpm", ["exec", "supabase", "db", "reset", "--db-url", url, "--no-seed", "--yes"], {
  stdio: ["ignore", "inherit", "inherit"],
});
process.exit(result.status ?? 1);
