import { expect, test } from "@playwright/test";
import { admin, createTestUser, deleteTestUser, login } from "./helpers/auth";
import { runSql } from "./helpers/db";

const stamp = Date.now();
const password = "oxyn-test-123";
const slug = `tst-e2e-rp-${stamp}`;
const adminEmail = `tst-e2e-rp-admin-${stamp}@oxyn.test`;
const plainEmail = `tst-e2e-rp-plain-${stamp}@oxyn.test`;
const roleName = `tst-e2e-rp-sem-relatorios-${stamp}`;
const reportName = `Receita por etapa ${stamp}`;

let companyId = "";
let adminId = "";
let plainId = "";
let roleId = "";
let pipelineId = "";
const stage: Record<string, string> = {};

test.describe.configure({ mode: "serial" });

async function insert(table: string, row: Record<string, unknown>): Promise<string> {
  const r = await admin().from(table).insert(row).select("id").single();
  if (r.error) throw r.error;
  return r.data.id as string;
}

test.beforeAll(async () => {
  adminId = await createTestUser({ email: adminEmail, password, fullName: "Ada Relatórios", superAdmin: true });
  plainId = await createTestUser({ email: plainEmail, password, fullName: "Paulo Plain" });
  companyId = await insert("companies", { name: `Relatórios E2E ${stamp}`, slug });

  // Papel de teste sem view_reports: cópia do papel padrão, removido no fim.
  const rows = await runSql<{ id: string }>(
    `insert into public.roles (name, description, permissions, is_system)
       select '${roleName}', 'Papel de teste', jsonb_set(permissions, '{settings,view_reports}', 'false'), false
       from public.roles where is_system returning id`,
  );
  roleId = rows[0]!.id;
  await insert("memberships", { user_id: plainId, company_id: companyId, role_id: roleId });

  pipelineId = await insert("pipelines", { company_id: companyId, name: `Funil RP ${stamp}`, position: -1 });
  const mkStage = async (key: string, name: string, position: number) => {
    stage[key] = await insert("stages", { company_id: companyId, pipeline_id: pipelineId, name, position, probability: 50 });
  };
  await mkStage("a", "Proposta RP", 0);
  await mkStage("b", "Negociação RP", 1);
  let pos = 0;
  const deal = async (key: string, stageKey: string, setup: number) => {
    pos += 1024;
    await insert("deals", {
      company_id: companyId,
      owner_id: adminId,
      pipeline_id: pipelineId,
      stage_id: stage[stageKey],
      position: pos,
      title: `${key} ${stamp}`,
      setup_total: setup,
      setup_first_due: "2026-12-01",
    });
  };
  await deal("N1", "a", 1000);
  await deal("N2", "a", 3000);
  await deal("N3", "b", 500);

  // Três tentativas concluídas no LinkedIn, ligadas a um lead.
  const a = admin();
  const [type, channel, outcome] = await Promise.all([
    a.from("activity_types").select("id").eq("company_id", companyId).eq("name", "Tarefa").single(),
    a.from("activity_channels").select("id").eq("company_id", companyId).eq("name", "LinkedIn").single(),
    a.from("activity_outcomes").select("id").eq("company_id", companyId).limit(1).single(),
  ]);
  if (type.error) throw type.error;
  if (channel.error) throw channel.error;
  if (outcome.error) throw outcome.error;
  const leadId = await insert("leads", { company_id: companyId, owner_id: adminId, title: `Lead RP ${stamp}` });
  for (let i = 1; i <= 3; i++) {
    await insert("activities", {
      company_id: companyId,
      owner_id: adminId,
      type_id: type.data.id,
      channel_id: channel.data.id,
      lead_id: leadId,
      subject: `Tentativa ${i} ${stamp}`,
      due_at: new Date(Date.now() - 3_600_000).toISOString(),
      done: true,
      completed_at: new Date().toISOString(),
      outcome_id: outcome.data.id,
    });
  }
});

test.afterAll(async () => {
  await admin().from("reports").delete().eq("owner_id", adminId);
  if (companyId) await admin().from("companies").delete().eq("id", companyId);
  if (adminId) await deleteTestUser(adminId).catch(() => {});
  if (plainId) await deleteTestUser(plainId).catch(() => {});
  if (roleId) await runSql(`delete from public.roles where id = '${roleId}' and not is_system`);
});

test("admin vê os relatórios prontos e abre o funil por canal", async ({ page }) => {
  await login(page, adminEmail, password);
  await page.waitForURL((u) => !u.pathname.startsWith("/entrar"));
  await page.goto(`/${slug}/relatorios`);
  await expect(page.getByRole("heading", { level: 1, name: "Relatórios" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Funil de reuniões por canal/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /Motivos de perda/ })).toBeVisible();

  await page.getByRole("link", { name: /Funil de reuniões por canal/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Funil de reuniões por canal" })).toBeVisible();
  await expect(
    page.getByText("Um lead com reuniões de canais diferentes conta em cada canal; as linhas não somam."),
  ).toBeVisible();
  const row = page.getByRole("row").filter({ hasText: "LinkedIn" });
  await expect(row).toBeVisible();
  await expect(row.getByRole("cell").nth(1)).toHaveText("3");
});

test("monta, salva e lista um relatório personalizado", async ({ page }) => {
  await login(page, adminEmail, password);
  await page.waitForURL((u) => !u.pathname.startsWith("/entrar"));
  await page.goto(`/${slug}/relatorios/novo`);
  await expect(page.getByRole("heading", { level: 1, name: "Novo relatório" })).toBeVisible();

  await page.getByLabel("Nome").fill(reportName);
  await page.getByLabel("Base", { exact: true }).selectOption("deals");
  await page.getByLabel("Métrica", { exact: true }).selectOption("sum");
  await page.getByLabel("Campo da métrica").selectOption("setup_total");
  await page.getByLabel("Agrupar por").selectOption("stage");
  await page.getByLabel("Gráfico").selectOption("bar");
  // Filtro sem valor é omitido da consulta: a pré-visualização continua válida.
  await page.getByRole("button", { name: "Adicionar filtro" }).click();
  await expect(page.getByTestId("filter-row")).toHaveCount(1);

  const preview = page.getByText("Pré-visualização").locator("..");
  await expect(preview.getByRole("img")).toBeVisible();
  await preview.getByRole("button", { name: "Ver tabela" }).click();
  // Intl usa espaço sem quebra; o texto do DOM é comparado depois de normalizar o espaço.
  const money = (n: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n).replace(/\s/g, " ");
  const rowText = async (name: string) =>
    ((await preview.getByRole("row").filter({ hasText: name }).innerText()) ?? "").replace(/\s/g, " ");
  await expect(preview.getByRole("row").filter({ hasText: "Proposta RP" })).toBeVisible();
  expect(await rowText("Proposta RP")).toContain(money(4000));
  expect(await rowText("Negociação RP")).toContain(money(500));

  await page.getByRole("button", { name: "Salvar" }).click();
  await expect(page).toHaveURL(new RegExp(`/${slug}/relatorios$`));
  await expect(page.getByRole("link", { name: new RegExp(reportName) })).toBeVisible();

  // Reabrir e salvar de novo mantém a empresa do relatório.
  await page.getByRole("link", { name: new RegExp(reportName) }).click();
  await expect(page.getByLabel("Nome")).toHaveValue(reportName);
  await page.getByRole("button", { name: "Salvar" }).click();
  await expect(page).toHaveURL(new RegExp(`/${slug}/relatorios$`));
  const saved = await admin().from("reports").select("company_id").eq("name", reportName).single();
  expect(saved.data?.company_id).toBe(companyId);
});

test("usuário sem view_reports vê Relatórios desativado e recebe 404", async ({ page }) => {
  await login(page, plainEmail, password);
  await page.waitForURL((u) => !u.pathname.startsWith("/entrar"));
  await page.goto(`/${slug}/inicio`);
  await expect(page.getByRole("link", { name: "Atividades" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Relatórios" })).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "Principal" }).getByLabel("Relatórios")).toHaveAttribute(
    "aria-disabled",
    "true",
  );
  await page.getByRole("navigation", { name: "Principal" }).getByLabel("Relatórios").hover();
  await expect(page.getByRole("tooltip", { name: "Sem permissão para relatórios" })).toBeVisible();
  const res = await page.goto(`/${slug}/relatorios`);
  expect(res?.status()).toBe(404);
  const res2 = await page.goto(`/${slug}/relatorios/novo`);
  expect(res2?.status()).toBe(404);
});
