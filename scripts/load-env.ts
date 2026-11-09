import { existsSync } from "node:fs";
import { resolve } from "node:path";

/** Lê .env.local, ou o arquivo em ENV_FILE (por exemplo .env.ci para o projeto Supabase do CI). */
export function loadEnv(): void {
  const file = resolve(process.cwd(), process.env.ENV_FILE || ".env.local");
  if (existsSync(file)) process.loadEnvFile(file);
}

export function requireDbUrl(): string {
  const url = process.env.SUPABASE_DB_URL;
  if (!url) {
    console.error("SUPABASE_DB_URL ausente. Defina em .env.local.");
    process.exit(1);
  }
  return url;
}
