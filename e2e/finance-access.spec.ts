import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { admin, createTestUser, deleteTestUser, login } from "./helpers/auth";

const stamp = Date.now();
const password = "oxyn-test-123";
const slug = `tst-e2e-fin-${stamp}`;
const adminEmail = `tst-e2e-fin-admin-${stamp}@oxyn.test`;
const plainEmail = `tst-e2e-fin-plain-${stamp}@oxyn.test`;
const viewerEmail = `tst-e2e-fin-viewer-${stamp}@oxyn.test`;
const roleNames = [`Sem financeiro ${stamp}`, `Vê financeiro ${stamp}`];

let companyId = "";
const userIds: string[] = [];

/** O gatilho de ativação exige sessão de admin geral: entra como o admin do teste e atualiza como ele. */
async function setFinanceEnabled(enabled: boolean) {
  const c = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const si = await c.auth.signInWithPassword({ email: adminEmail, password });
  if (si.error) throw si.error;
  const r = await c.from("companies").update({ finance_enabled: enabled }).eq("id", companyId).select("id");
  if (r.error) throw r.error;
  if (!r.data?.length) throw new Error("empresa não atualizada");
}

function permissions(extra: Record<string, boolean>) {
  return {
    visibility: { leads: "own", deals: "own", persons: "own", organizations: "own", activities: "own" },
    actions: { create: true, edit: true, delete: false, export: false, reassign_owner: false },
    settings: {
      manage_pipelines: false,
      manage_custom_fields: false,
      manage_products: false,
      view_reports: false,
      create_dashboards: false,
      share_dashboards: false,
      ...extra,
    },
  };
}

async function member(email: string, fullName: string, roleName: string, extra: Record<string, boolean>) {
  const a = admin();
  const id = await createTestUser({ email, password, fullName });
  userIds.push(id);
  const role = await a.from("roles").insert({ name: roleName, permissions: permissions(extra) }).select("id").single();
  if (role.error) throw role.error;
  const m = await a.from("memberships").insert({ user_id: id, company_id: companyId, role_id: role.data.id });
  if (m.error) throw m.error;
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  const a = admin();
  userIds.push(await createTestUser({ email: adminEmail, password, fullName: "Ada Financeiro", superAdmin: true }));
  const c = await a.from("companies").insert({ name: `Financeiro E2E ${stamp}`, slug }).select("id").single();
  if (c.error) throw c.error;
  companyId = c.data.id;
  await member(plainEmail, "Tst Sem Financeiro", roleNames[0], {});
  await member(viewerEmail, "Tst Vê Financeiro", roleNames[1], { view_finance: true });
  await setFinanceEnabled(true);
});

test.afterAll(async () => {
  const a = admin();
  if (companyId) {
    await a.from("memberships").delete().eq("company_id", companyId);
    await a.from("companies").delete().eq("id", companyId);
  }
  await a.from("roles").delete().in("name", roleNames);
  for (const id of userIds) await deleteTestUser(id).catch(() => {});
});

async function signIn(page: import("@playwright/test").Page, email: string) {
  await login(page, email, password);
  await page.waitForURL((u) => !u.pathname.startsWith("/entrar"));
}

test("sem view_finance: sem menu e 404 na rota", async ({ page }) => {
  await signIn(page, plainEmail);
  await page.goto(`/${slug}/inicio`);
  await expect(page.getByRole("link", { name: "Leads" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Financeiro" })).toHaveCount(0);
  const res = await page.goto(`/${slug}/financeiro`);
  expect(res?.status()).toBe(404);
});

test("admin com a empresa ativada vê menu e abas, inclusive Configurações", async ({ page }) => {
  await signIn(page, adminEmail);
  await page.goto(`/${slug}/inicio`);
  await expect(page.getByRole("link", { name: "Financeiro" })).toBeVisible();
  const res = await page.goto(`/${slug}/financeiro`);
  expect(res?.status()).toBe(200);
  const tabs = page.getByRole("navigation", { name: "Financeiro" });
  for (const t of ["Mês", "Projeção", "Clientes", "Serviços", "Custos", "Lançamentos", "Contratos", "Despesas", "Vendas", "Configurações"]) {
    await expect(tabs.getByRole("link", { name: t, exact: true })).toBeVisible();
  }
});

test("escopo Todas as empresas: sem menu e 404", async ({ page }) => {
  await signIn(page, adminEmail);
  await page.goto("/todas/inicio");
  await expect(page.getByRole("link", { name: "Financeiro" })).toHaveCount(0);
  const res = await page.goto("/todas/financeiro");
  expect(res?.status()).toBe(404);
});

test("com view_finance mas sem manage_finance: abas sem Configurações", async ({ page }) => {
  await signIn(page, viewerEmail);
  await page.goto(`/${slug}/financeiro`);
  const tabs = page.getByRole("navigation", { name: "Financeiro" });
  await expect(tabs.getByRole("link", { name: "Lançamentos", exact: true })).toBeVisible();
  await expect(tabs.getByRole("link", { name: "Configurações", exact: true })).toHaveCount(0);
});

test("empresa com Financeiro desligado: nem o admin vê o menu", async ({ page }) => {
  await setFinanceEnabled(false);
  await signIn(page, adminEmail);
  await page.goto(`/${slug}/inicio`);
  await expect(page.getByRole("link", { name: "Leads" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Financeiro" })).toHaveCount(0);
  const res = await page.goto(`/${slug}/financeiro`);
  expect(res?.status()).toBe(404);
});
