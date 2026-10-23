import { expect, test } from "@playwright/test";
import { admin, createTestUser, deleteTestUser, login } from "./helpers/auth";
import { runSql } from "./helpers/db";

const stamp = Date.now();
const password = "oxyn-test-123";
const slug = `tst-e2e-mt-${stamp}`;
const adminEmail = `tst-e2e-mt-admin-${stamp}@oxyn.test`;
const plainEmail = `tst-e2e-mt-plain-${stamp}@oxyn.test`;
const roleName = `tst-e2e-mt-leitor-${stamp}`;
const dashName = `Painel de metas ${stamp}`;
const widgetTitle = "Progresso de metas";

let companyId = "";
let adminId = "";
let plainId = "";
let roleId = "";
let dealId = "";

test.describe.configure({ mode: "serial" });

async function insert(table: string, row: Record<string, unknown>): Promise<string> {
  const r = await admin().from(table).insert(row).select("id").single();
  if (r.error) throw r.error;
  return r.data.id as string;
}

test.beforeAll(async () => {
  adminId = await createTestUser({ email: adminEmail, password, fullName: "Ada Metas", superAdmin: true });
  plainId = await createTestUser({ email: plainEmail, password, fullName: "Paulo Leitor" });
  companyId = await insert("companies", { name: `Metas E2E ${stamp}`, slug });
  const rows = await runSql<{ id: string }>(
    `insert into public.roles (name, description, permissions, is_system)
       select '${roleName}', 'Papel de teste', jsonb_set(jsonb_set(permissions, '{settings,view_reports}', 'true'), '{visibility,deals}', '"company"'), false
       from public.roles where is_system returning id`,
  );
  roleId = rows[0]!.id;
  await insert("memberships", { user_id: plainId, company_id: companyId, role_id: roleId });

  // Negócio ganho agora (won_at = now() via SQL, sem depender da data): valor de contrato 2500, ou 25% de 10000.
  const pipelineId = await insert("pipelines", { company_id: companyId, name: `Funil MT ${stamp}`, position: -1 });
  const stageId = await insert("stages", { company_id: companyId, pipeline_id: pipelineId, name: "Etapa MT", position: 0, probability: 50 });
  dealId = await insert("deals", {
    company_id: companyId,
    owner_id: adminId,
    pipeline_id: pipelineId,
    stage_id: stageId,
    position: 1024,
    title: `Ganho ${stamp}`,
    setup_total: 2500,
    setup_first_due: "2026-12-01",
  });
  await runSql(`update public.deals set status = 'won', won_at = now() where id = '${dealId}'`);

  const dashId = await insert("dashboards", { owner_id: adminId, name: dashName });
  await insert("dashboard_widgets", { dashboard_id: dashId, title: widgetTitle, position: 0, spec: { kind: "goal_progress", chart: "table" } });
});

test.afterAll(async () => {
  await admin().from("dashboards").delete().eq("owner_id", adminId);
  if (companyId) {
    await admin().from("goals").delete().eq("company_id", companyId);
    await admin().from("companies").delete().eq("id", companyId);
  }
  if (adminId) await deleteTestUser(adminId).catch(() => {});
  if (plainId) await deleteTestUser(plainId).catch(() => {});
  if (roleId) await runSql(`delete from public.roles where id = '${roleId}' and not is_system`);
});

test("o admin cria a meta mensal de valor ganho e vê o realizado e a porcentagem exatos", async ({ page }) => {
  await login(page, adminEmail, password);
  await page.waitForURL((u) => !u.pathname.startsWith("/entrar"));
  await page.goto(`/${slug}/relatorios/metas`);
  await expect(page.getByRole("heading", { level: 1, name: "Metas" })).toBeVisible();
  await page.getByRole("button", { name: "Nova meta" }).click();
  const dialog = page.getByRole("dialog", { name: "Nova meta" });
  await expect(dialog.getByLabel("Empresa")).toHaveValue(companyId);
  await dialog.getByLabel("Alvo", { exact: true }).selectOption("company");
  await dialog.getByLabel("Métrica").selectOption({ label: "Valor ganho" });
  await dialog.getByLabel("Período").selectOption({ label: "Mensal" });
  // Um início no meio do mês é alinhado ao dia 1.
  await dialog.getByLabel("Início").fill("2026-10-17");
  await expect(dialog.getByLabel("Início")).toHaveValue("2026-10-01");
  await dialog.getByLabel("Início").fill(new Date().toISOString().slice(0, 8) + "15");
  await expect(dialog.getByLabel("Início")).toHaveValue(/-01$/);
  await dialog.getByLabel("Valor-alvo").fill("10000");
  await dialog.getByRole("button", { name: "Criar meta" }).click();
  await expect(dialog).toBeHidden();

  const row = page.getByRole("listitem").filter({ hasText: "Valor ganho" });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("25,0%");
  await expect(row).toContainText(/Realizado R\$\s2\.500,00 de R\$\s10\.000,00/);
  await expect(row).toContainText("Período de ");
  await expect(row.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "25");
});

test("o usuário padrão vê a meta mas não vê Nova meta", async ({ page }) => {
  await login(page, plainEmail, password);
  await page.waitForURL((u) => !u.pathname.startsWith("/entrar"));
  await page.goto(`/${slug}/relatorios/metas`);
  const row = page.getByRole("listitem").filter({ hasText: "Valor ganho" });
  await expect(row).toContainText("25,0%");
  await expect(page.getByRole("button", { name: "Nova meta" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Excluir meta/ })).toHaveCount(0);
});

test("o widget Progresso de metas de um dashboard mostra a mesma porcentagem", async ({ page }) => {
  await login(page, adminEmail, password);
  await page.waitForURL((u) => !u.pathname.startsWith("/entrar"));
  const dash = await admin().from("dashboards").select("id").eq("owner_id", adminId).single();
  await page.goto(`/${slug}/relatorios/dashboards/${dash.data!.id}`);
  const widget = page.getByRole("article", { name: widgetTitle });
  await expect(widget).toContainText("25,0%");
  await expect(widget.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "25");
});
