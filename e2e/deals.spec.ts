import { expect, test, type Browser, type Page } from "@playwright/test";
import { admin, createTestUser, deleteTestUser, login } from "./helpers/auth";
import { withoutTriggers } from "./helpers/db";

const stamp = Date.now();
const password = "oxyn-test-123";
const slug = `tst-e2e-dl-${stamp}`;
const slugOther = `tst-e2e-dl2-${stamp}`;
const adminEmail = `tst-e2e-dl-admin-${stamp}@oxyn.test`;
const userEmail = `tst-e2e-dl-padrao-${stamp}@oxyn.test`;

let companyId = "";
let otherCompanyId = "";
let adminId = "";
let userId = "";
let pipelineId = "";
const stage: Record<string, string> = {};
const deal: Record<string, string> = {};
const product: Record<string, string> = {};

test.describe.configure({ mode: "serial" });

async function insert(table: string, row: Record<string, unknown>): Promise<string> {
  const r = await admin().from(table).insert(row).select("id").single();
  if (r.error) throw r.error;
  return r.data.id as string;
}

async function mkDeal(key: string, row: Record<string, unknown> = {}) {
  deal[key] = await insert("deals", {
    company_id: companyId,
    owner_id: adminId,
    pipeline_id: pipelineId,
    stage_id: stage.Qualificação,
    title: `Detalhe ${key} ${stamp}`,
    ...row,
  });
}

test.beforeAll(async () => {
  adminId = await createTestUser({ email: adminEmail, password, fullName: "Ada Detalhe", superAdmin: true });
  userId = await createTestUser({ email: userEmail, password, fullName: "Paulo Detalhe" });
  companyId = await insert("companies", { name: `Detalhe E2E ${stamp}`, slug });
  otherCompanyId = await insert("companies", { name: `Detalhe E2E 2 ${stamp}`, slug: slugOther });
  const a = admin();
  const role = await a.from("roles").select("id").eq("name", "Usuário padrão").single();
  if (role.error) throw role.error;
  const m = await a.from("memberships").insert({ user_id: userId, company_id: companyId, role_id: role.data.id });
  if (m.error) throw m.error;

  // Funil padrão criado junto com a empresa.
  const p = await a.from("pipelines").select("id").eq("company_id", companyId).single();
  if (p.error) throw p.error;
  pipelineId = p.data.id;
  const stages = await a.from("stages").select("id, name").eq("pipeline_id", pipelineId);
  if (stages.error) throw stages.error;
  for (const s of stages.data) stage[s.name] = s.id;
  const req = await a.from("stages").update({ required_fields: ["expected_close_date"] }).eq("id", stage.Proposta);
  if (req.error) throw req.error;

  product.setup = await insert("products", { company_id: companyId, name: `Implantação ${stamp}`, kind: "setup", default_price: 6000 });
  product.mrr = await insert("products", { company_id: companyId, name: `Plataforma ${stamp}`, kind: "recurring", default_price: 1500 });
  product.old = await insert("products", { company_id: companyId, name: `Antigo ${stamp}`, kind: "recurring", default_price: 10, active: false });

  await mkDeal("contrato");
  await mkDeal("itens");
  await mkDeal("etapas");
  await mkDeal("status");
  await mkDeal("ganho", {
    mrr: 1000,
    mrr_start: "2026-01-01",
    contract_months: 12,
  });
  const won = await a.from("deals").update({ status: "won" }).eq("id", deal.ganho);
  if (won.error) throw won.error;
  const old = new Date(Date.now() - 5 * 86_400_000).toISOString();
  await withoutTriggers((sql) => sql`update public.deals set stage_entered_at = ${old} where id = ${deal.etapas}`);
});

test.afterAll(async () => {
  for (const id of [companyId, otherCompanyId]) if (id) await admin().from("companies").delete().eq("id", id);
  for (const id of [adminId, userId]) if (id) await deleteTestUser(id).catch(() => {});
});

async function newPage(browser: Browser, email = adminEmail): Promise<Page> {
  const ctx = await browser.newContext({ baseURL: "http://localhost:3000" });
  const page = await ctx.newPage();
  await login(page, email, password);
  await page.waitForURL((u) => !u.pathname.startsWith("/entrar"));
  return page;
}

async function open(page: Page, key: string, empresa = slug) {
  await page.goto(`/${empresa}/negocios/${deal[key]}`);
  await expect(page.getByRole("heading", { level: 1, name: `Detalhe ${key} ${stamp}` })).toBeVisible();
}

/** Texto da página 404, sem o avatar do usuário logado (iniciais diferentes por usuário). */
const notFoundText = (text: string) => text.slice(text.indexOf("404"));

const row = (page: Page, month: string) => page.getByTestId("revenue-table").locator(`tr[data-month="${month}"]`);

test("contrato gera o cronograma mês a mês", async ({ browser }) => {
  const page = await newPage(browser);
  await open(page, "contrato");
  await expect(page.getByTestId("revenue-table-empty")).toHaveText("Defina as condições do contrato para ver o cronograma.");

  await page.getByLabel("Setup total (R$)").fill("30000");
  await page.getByLabel("Parcelas", { exact: true }).fill("3");
  await page.getByLabel("Mês da 1ª parcela").fill("2026-03");
  await page.getByLabel("MRR (R$)", { exact: true }).fill("5000");
  await page.getByLabel("Início do MRR").fill("2026-04");
  await page.getByLabel("Duração (meses)").fill("12");

  // Prévia antes de salvar; nada gravado ainda.
  await expect(page.getByTestId("contract-total")).toHaveText(/R\$\s*90\.000,00/);
  await expect(page.getByTestId("schedule-preview").locator('tr[data-month="2026-06"]')).toContainText(/mai|jun/);
  await expect(page.getByTestId("schedule-preview-total")).toContainText(/R\$\s*90\.000,00/);
  expect((await admin().from("deal_revenue_schedule").select("month").eq("deal_id", deal.contrato)).data).toHaveLength(0);

  await page.getByRole("button", { name: "Salvar contrato" }).click();
  await expect(page.getByTestId("revenue-table")).toBeVisible();
  await expect(row(page, "2026-03")).toContainText("mar/2026");
  await expect(row(page, "2026-03")).toContainText(/R\$\s*10\.000,00/);
  await expect(row(page, "2026-04")).toContainText("abr/2026");
  await expect(row(page, "2026-04")).toContainText(/R\$\s*15\.000,00/);
  await expect(row(page, "2026-06")).toContainText("jun/2026");
  await expect(row(page, "2026-06")).toContainText(/R\$\s*5\.000,00/);
  await expect(page.getByTestId("revenue-table-total")).toContainText(/R\$\s*90\.000,00/);
  await page.context().close();
});

test("com produtos os totais vêm dos itens", async ({ browser }) => {
  const page = await newPage(browser);
  const dlg = page.getByRole("dialog");
  await open(page, "itens");

  await page.getByRole("button", { name: "Adicionar produto" }).click();
  // R3: produto inativo não aparece no seletor.
  const options = dlg.getByLabel("Produto", { exact: true }).locator("option");
  await expect(options.filter({ hasText: `Plataforma ${stamp}` })).toHaveCount(1);
  await expect(options.filter({ hasText: `Antigo ${stamp}` })).toHaveCount(0);

  // R5: primeiro item recorrente pede início e duração.
  await dlg.getByLabel("Produto", { exact: true }).selectOption({ label: `Plataforma ${stamp} (Recorrente)` });
  await expect(dlg.getByLabel("Preço unitário (R$)")).toHaveValue("1500");
  await dlg.getByLabel("Quantidade").fill("2");
  await dlg.getByLabel("Início do MRR").fill("2026-05");
  await dlg.getByLabel("Duração (meses)").fill("6");
  await dlg.getByRole("button", { name: "Adicionar", exact: true }).click();
  await expect(page.getByTestId("item-row")).toHaveCount(1);
  await expect(page.getByTestId("items-mrr")).toHaveText(/R\$\s*3\.000,00/);

  // R5: primeiro item de setup pede o mês da 1ª parcela.
  await page.getByRole("button", { name: "Adicionar produto" }).click();
  await dlg.getByLabel("Produto", { exact: true }).selectOption({ label: `Implantação ${stamp} (Setup)` });
  await dlg.getByLabel("Desconto (R$)").fill("500");
  await dlg.getByLabel("Mês da 1ª parcela").fill("2026-05");
  await dlg.getByRole("button", { name: "Adicionar", exact: true }).click();
  await expect(page.getByTestId("item-row")).toHaveCount(2);
  await expect(page.getByTestId("items-setup")).toHaveText(/R\$\s*5\.500,00/);

  // Totais do contrato são somente leitura e calculados.
  await expect(page.getByLabel("Setup total (R$)")).toHaveAttribute("readonly", "");
  await expect(page.getByLabel("MRR (R$)", { exact: true })).toHaveValue("3000");
  await expect(page.getByText("Calculado a partir dos produtos")).toHaveCount(2);
  await expect(page.getByTestId("contract-total")).toHaveText(/R\$\s*23\.500,00/);
  await expect(row(page, "2026-05")).toContainText(/R\$\s*8\.500,00/);
  await expect(page.getByTestId("revenue-table-total")).toContainText(/R\$\s*23\.500,00/);

  // Remover o item de setup zera o setup.
  await page.getByRole("button", { name: `Remover Implantação ${stamp}` }).click();
  await expect(page.getByTestId("item-row")).toHaveCount(1);
  await expect(page.getByTestId("items-setup")).toHaveText(/R\$\s*0,00/);
  await page.context().close();
});

test("barra de etapas move e pede campos obrigatórios", async ({ browser }) => {
  const page = await newPage(browser);
  await open(page, "etapas");
  const seg = (name: string) => page.getByRole("button", { name, exact: true });
  await expect(page.getByTestId("stage-days")).toHaveText("Há 5 dias nesta etapa");
  await expect(seg("Qualificação")).toHaveAttribute("aria-current", "step");

  await seg("Reunião").click();
  await expect(seg("Reunião")).toHaveAttribute("aria-current", "step");
  await expect(seg("Qualificação")).toHaveAttribute("data-state", "past");
  await expect(page.getByTestId("stage-days")).toHaveText("Entrou nesta etapa hoje");
  await expect.poll(async () => (await admin().from("deals").select("stage_id").eq("id", deal.etapas).single()).data?.stage_id).toBe(
    stage.Reunião,
  );

  // Proposta exige a data de fechamento esperada.
  await seg("Proposta").click();
  const dialog = page.getByRole("dialog", { name: "Campos obrigatórios" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("Data de fechamento esperada")).toBeVisible();
  await dialog.getByLabel("Data de fechamento esperada").fill("2026-12-15");
  await dialog.getByRole("button", { name: "Salvar e mover" }).click();
  await expect(dialog).toBeHidden();
  await expect(seg("Proposta")).toHaveAttribute("aria-current", "step");
  const saved = await admin().from("deals").select("stage_id, expected_close_date").eq("id", deal.etapas).single();
  expect(saved.data).toMatchObject({ stage_id: stage.Proposta, expected_close_date: "2026-12-15" });

  await expect(page.getByTestId("timeline-event").filter({ hasText: "Moveu de Qualificação para Reunião" })).toBeVisible();
  await expect(page.getByTestId("timeline-event").filter({ hasText: "Moveu de Reunião para Proposta" })).toBeVisible();
  await page.context().close();
});

test("marcar perdido exige motivo e reabrir volta para aberto", async ({ browser }) => {
  const page = await newPage(browser);
  await open(page, "status");
  const status = page.getByTestId("deal-status");
  await expect(status).toHaveText("Aberto");

  await page.getByRole("button", { name: "Ganho", exact: true }).click();
  await expect(status).toHaveText("Ganho");
  await expect(page.getByTestId("timeline-event").filter({ hasText: "Marcou como ganho" })).toBeVisible();
  await page.getByRole("button", { name: "Reabrir", exact: true }).click();
  await expect(status).toHaveText("Aberto");

  await page.getByRole("button", { name: "Perdido", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Marcar como perdido" });
  await dialog.getByRole("button", { name: "Marcar como perdido" }).click();
  await expect(dialog.getByRole("alert")).toHaveText("Escolha um motivo.");
  await dialog.getByLabel("Motivo").selectOption({ label: "Preço" });
  await dialog.getByRole("button", { name: "Marcar como perdido" }).click();
  await expect(status).toHaveText("Perdido");
  await expect(page.getByTestId("lost-info")).toContainText("Preço");
  await expect(page.getByTestId("timeline-event").filter({ hasText: "Marcou como perdido (Preço)" })).toBeVisible();
  // Negócio perdido não se move pela barra.
  await expect(page.getByRole("button", { name: "Reunião", exact: true })).toBeDisabled();

  await page.getByRole("button", { name: "Reabrir", exact: true }).click();
  await expect(status).toHaveText("Aberto");
  await expect(page.getByTestId("timeline-event").filter({ hasText: "Reabriu o negócio" }).first()).toBeVisible();
  const db = await admin().from("deals").select("status, lost_reason_id").eq("id", deal.status).single();
  expect(db.data).toMatchObject({ status: "open", lost_reason_id: null });
  await page.context().close();
});

test("editar contrato de negócio ganho recalcula o cronograma", async ({ browser }) => {
  const page = await newPage(browser);
  await open(page, "ganho");
  await expect(page.getByTestId("deal-status")).toHaveText("Ganho");
  await expect(page.getByTestId("revenue-table").locator("tbody tr")).toHaveCount(12);

  await page.getByLabel("Duração (meses)").fill("6");
  await page.getByRole("button", { name: "Salvar contrato" }).click();
  await expect(page.getByTestId("revenue-table").locator("tbody tr")).toHaveCount(6);
  await expect(page.getByTestId("revenue-table-total")).toContainText(/R\$\s*6\.000,00/);
  await expect(page.getByTestId("contract-total")).toHaveText(/R\$\s*6\.000,00/);
  const sched = await admin().from("deal_revenue_schedule").select("month").eq("deal_id", deal.ganho);
  expect(sched.data).toHaveLength(6);
  const db = await admin().from("deals").select("status, contract_months").eq("id", deal.ganho).single();
  expect(db.data).toMatchObject({ status: "won", contract_months: 6 });
  await page.context().close();
});

test("404 igual", async ({ browser }) => {
  const standard = await newPage(browser, userEmail);
  const noAccess = await standard.goto(`/${slug}/negocios/${deal.contrato}`);
  expect(noAccess?.status()).toBe(404);
  await expect(standard.getByText("This page could not be found.")).toBeVisible();
  const textNoAccess = notFoundText(await standard.locator("body").innerText());
  await standard.context().close();

  const page = await newPage(browser);
  const missing = await page.goto(`/${slug}/negocios/00000000-0000-4000-8000-000000000000`);
  expect(missing?.status()).toBe(404);
  await expect(page.getByText("This page could not be found.")).toBeVisible();
  const textMissing = notFoundText(await page.locator("body").innerText());
  const wrongSlug = await page.goto(`/${slugOther}/negocios/${deal.contrato}`);
  expect(wrongSlug?.status()).toBe(404);
  await expect(page.getByText("This page could not be found.")).toBeVisible();
  const textWrong = notFoundText(await page.locator("body").innerText());
  expect(textNoAccess).toBe(textMissing);
  expect(textWrong).toBe(textMissing);
  expect(textNoAccess).not.toContain(`Detalhe contrato ${stamp}`);
  await page.context().close();
});
