import { expect, test } from "@playwright/test";
import { admin, createTestUser, deleteTestUser, login } from "./helpers/auth";
import { runSql } from "./helpers/db";

const stamp = Date.now();
const password = "oxyn-test-123";
const slug = `tst-e2e-ds-${stamp}`;
const managerEmail = `tst-e2e-ds-gestor-${stamp}@oxyn.test`;
const sellerEmail = `tst-e2e-ds-vendedor-${stamp}@oxyn.test`;
const managerName = "Gil Gestor";
const sellerName = `Vera Vendedora ${stamp}`;
const managerRole = `tst-e2e-ds-gestor-${stamp}`;
const sellerRole = `tst-e2e-ds-vendedor-${stamp}`;
const dashName = `Painel compartilhado ${stamp}`;
const ownDashName = `Painel da vendedora ${stamp}`;
const widgetTitle = `Negócios ${stamp}`;

let companyId = "";
let managerId = "";
let sellerId = "";
let managerRoleId = "";
let sellerRoleId = "";
let dashboardId = "";
let ownDashboardId = "";
let publicPath = "";

test.describe.configure({ mode: "serial" });

async function insert(table: string, row: Record<string, unknown>): Promise<string> {
  const r = await admin().from(table).insert(row).select("id").single();
  if (r.error) throw r.error;
  return r.data.id as string;
}

async function role(name: string, visibility: "company" | "own", share: boolean): Promise<string> {
  const rows = await runSql<{ id: string }>(
    `insert into public.roles (name, description, permissions, is_system)
       select '${name}', 'Papel de teste',
         jsonb_set(jsonb_set(permissions, '{settings,share_dashboards}', '${share}'),
           '{visibility,deals}', '"${visibility}"'),
         false
       from public.roles where is_system returning id`,
  );
  return rows[0]!.id;
}

test.beforeAll(async () => {
  managerId = await createTestUser({ email: managerEmail, password, fullName: managerName });
  sellerId = await createTestUser({ email: sellerEmail, password, fullName: sellerName });
  companyId = await insert("companies", { name: `Compartilhamento E2E ${stamp}`, slug });
  managerRoleId = await role(managerRole, "company", true);
  sellerRoleId = await role(sellerRole, "own", false);
  await insert("memberships", { user_id: managerId, company_id: companyId, role_id: managerRoleId });
  await insert("memberships", { user_id: sellerId, company_id: companyId, role_id: sellerRoleId });

  const pipelineId = await insert("pipelines", { company_id: companyId, name: `Funil DS ${stamp}`, position: -1 });
  const stageId = await insert("stages", { company_id: companyId, pipeline_id: pipelineId, name: "Etapa DS", position: 0, probability: 50 });
  // Gestor: 3 negócios. Vendedora: 1. O gestor (visibilidade da empresa) conta 4; a vendedora, sozinha, contaria 1.
  let pos = 0;
  for (const [key, owner] of [["G1", managerId], ["G2", managerId], ["G3", managerId], ["V1", sellerId]] as const) {
    pos += 1024;
    await insert("deals", {
      company_id: companyId,
      owner_id: owner,
      pipeline_id: pipelineId,
      stage_id: stageId,
      position: pos,
      title: `${key} ${stamp}`,
      setup_total: 100,
      setup_first_due: "2026-12-01",
    });
  }

  dashboardId = await insert("dashboards", { owner_id: managerId, name: dashName });
  await insert("dashboard_widgets", {
    dashboard_id: dashboardId,
    title: widgetTitle,
    position: 0,
    spec: { kind: "custom", base: "deals", metric: { op: "count" }, chart: "number" },
  });
  ownDashboardId = await insert("dashboards", { owner_id: sellerId, name: ownDashName });
});

test.afterAll(async () => {
  await admin().from("dashboards").delete().in("owner_id", [managerId, sellerId].filter(Boolean));
  if (companyId) await admin().from("companies").delete().eq("id", companyId);
  if (managerId) await deleteTestUser(managerId).catch(() => {});
  if (sellerId) await deleteTestUser(sellerId).catch(() => {});
  if (managerRoleId) await runSql(`delete from public.roles where id = '${managerRoleId}' and not is_system`);
  if (sellerRoleId) await runSql(`delete from public.roles where id = '${sellerRoleId}' and not is_system`);
});

test("o gestor compartilha com a vendedora, que vê o mesmo número sem controles de edição", async ({ page, browser }) => {
  await login(page, managerEmail, password);
  await page.waitForURL((u) => !u.pathname.startsWith("/entrar"));
  await page.goto(`/${slug}/relatorios/dashboards/${dashboardId}`);
  await expect(page.getByRole("heading", { level: 1, name: dashName })).toBeVisible();
  await expect(page.getByRole("article", { name: widgetTitle })).toContainText("4");

  await page.getByRole("button", { name: "Compartilhar" }).click();
  const dialog = page.getByRole("dialog", { name: "Compartilhar dashboard" });
  // O dono nunca aparece na lista de pessoas.
  await expect(dialog.getByRole("button", { name: `Adicionar ${managerName}` })).toHaveCount(0);
  await dialog.getByLabel("Buscar pessoa").fill("Vera");
  await dialog.getByRole("button", { name: `Adicionar ${sellerName}` }).click();
  await expect(dialog.getByRole("button", { name: `Remover ${sellerName}` })).toBeVisible();
  await expect.poll(async () => {
    const r = await admin().from("dashboard_shares").select("user_id").eq("dashboard_id", dashboardId);
    return (r.data ?? []).map((s) => s.user_id);
  }).toEqual([sellerId]);

  const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  try {
    const seller = await ctx.newPage();
    await login(seller, sellerEmail, password);
    await seller.waitForURL((u) => !u.pathname.startsWith("/entrar"));
    await seller.goto(`/${slug}/relatorios/dashboards`);
    const shared = seller.getByRole("region", { name: "Compartilhados comigo" });
    await shared.getByRole("link", { name: new RegExp(dashName) }).click();
    await expect(seller.getByRole("heading", { level: 1, name: dashName })).toBeVisible();
    await expect(seller.getByRole("article", { name: widgetTitle })).toContainText("4");
    await expect(seller.getByRole("button", { name: "Adicionar widget" })).toHaveCount(0);
    await expect(seller.getByRole("button", { name: "Compartilhar" })).toHaveCount(0);
    await expect(seller.getByRole("button", { name: `Mover widget ${widgetTitle}` })).toHaveCount(0);

    // Quem não tem share_dashboards não vê Compartilhar nem no próprio dashboard.
    await seller.goto(`/${slug}/relatorios/dashboards/${ownDashboardId}`);
    await expect(seller.getByRole("heading", { level: 1, name: ownDashName })).toBeVisible();
    await expect(seller.getByRole("button", { name: "Compartilhar" })).toHaveCount(0);
  } finally {
    await ctx.close();
  }
});

test("link público: abre sem sessão e deixa de abrir depois de revogado", async ({ page, browser }) => {
  await login(page, managerEmail, password);
  await page.waitForURL((u) => !u.pathname.startsWith("/entrar"));
  await page.goto(`/${slug}/relatorios/dashboards/${dashboardId}`);
  await page.getByRole("button", { name: "Compartilhar" }).click();
  const dialog = page.getByRole("dialog", { name: "Compartilhar dashboard" });
  await dialog.getByRole("tab", { name: "Link público" }).click();
  await dialog.getByRole("button", { name: "Criar link" }).click();
  const url = await dialog.getByLabel("URL do link").inputValue();
  expect(url).toMatch(/\/d\/[A-Za-z0-9_-]{43}$/);
  publicPath = new URL(url).pathname;
  await expect(dialog.getByRole("button", { name: "Copiar" })).toBeVisible();
  await expect(dialog.getByRole("listitem").filter({ hasText: "Ativo" })).toHaveCount(1);

  const anon = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  try {
    const p = await anon.newPage();
    const res = await p.goto(publicPath);
    expect(res?.status()).toBe(200);
    await expect(p.getByRole("heading", { level: 1, name: dashName })).toBeVisible();
    await expect(p.getByRole("article", { name: widgetTitle })).toContainText("4");
    await expect(p.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
    await expect(p.locator('meta[name="referrer"]')).toHaveAttribute("content", "no-referrer");
    expect(p.url()).not.toContain("/entrar");

    await dialog.getByRole("button", { name: "Revogar link" }).click();
    await expect(dialog.getByRole("listitem").filter({ hasText: "Revogado" })).toHaveCount(1);

    const after = await p.goto(publicPath);
    expect(after?.status()).toBe(404);
  } finally {
    await anon.close();
  }
});

test("token com formato inválido dá 404 sem sessão", async ({ browser }) => {
  const anon = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  try {
    const p = await anon.newPage();
    const res = await p.goto("/d/token-invalido");
    expect(res?.status()).toBe(404);
    const unknown = await p.goto(`/d/${"a".repeat(43)}`);
    expect(unknown?.status()).toBe(404);
  } finally {
    await anon.close();
  }
});
