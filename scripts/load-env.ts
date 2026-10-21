import { existsSync } from "node:fs";
import { resolve } from "node:path";

export function loadEnv(): void {
  const file = resolve(process.cwd(), ".env.local");
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
