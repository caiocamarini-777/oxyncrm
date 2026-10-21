// Aplica supabase/migrations/*.sql no projeto Supabase de dev (SUPABASE_DB_URL).
import { spawnSync } from "node:child_process";
import { loadEnv, requireDbUrl } from "./load-env";

loadEnv();
const dbUrl = requireDbUrl();

const result = spawnSync(
  "pnpm",
  ["exec", "supabase", "db", "push", "--db-url", dbUrl],
  { stdio: "inherit" },
);
process.exit(result.status ?? 1);
