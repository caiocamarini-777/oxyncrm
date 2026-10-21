import { createClient } from "@supabase/supabase-js";
import type { Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";

function loadEnv() {
  try {
    const txt = readFileSync(path.join(process.cwd(), ".env.local"), "utf8");
    for (const line of txt.split("\n")) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && process.env[m[1]] === undefined) {
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
      }
    }
  } catch {
    // variáveis podem vir do ambiente
  }
}

function admin() {
  loadEnv();
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

export async function login(page: Page, email: string, password: string) {
  await page.goto("/entrar");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(password);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
}

export async function createTestUser(opts: {
  email: string;
  password: string;
  fullName: string;
  superAdmin?: boolean;
}): Promise<string> {
  const a = admin();
  const { data, error } = await a.auth.admin.createUser({
    email: opts.email,
    password: opts.password,
    email_confirm: true,
    user_metadata: { full_name: opts.fullName },
  });
  if (error || !data.user) throw error ?? new Error("createUser falhou");
  if (opts.superAdmin) {
    const { error: e2 } = await a
      .from("profiles")
      .update({ is_super_admin: true })
      .eq("id", data.user.id);
    if (e2) throw e2;
  }
  return data.user.id;
}

export async function deleteTestUser(id: string): Promise<void> {
  const { error } = await admin().auth.admin.deleteUser(id);
  if (error) throw error;
}
