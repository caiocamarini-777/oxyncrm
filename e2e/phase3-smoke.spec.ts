import { expect, test, type Browser, type Locator, type Page } from "@playwright/test";
import { admin, createTestUser, deleteTestUser, login } from "./helpers/auth";
import { dragCard } from "./helpers/kanban";

const stamp = Date.now();
const password = "oxyn-test-123";
const slug = `tst-e2e-p3-${stamp}`;
const companyName = `Tst Fase 3 ${stamp}`;
const adminEmail = `tst-e2e-p3-admin-${stamp}@oxyn.test`;
const sdrEmail = `tst-e2e-p3-sdr-${stamp}@oxyn.test`;
const closerEmail = `tst-e2e-p3-closer-${stamp}@oxyn.test`;
const roleName = `tst-e2e-p3-closer-${stamp}`;
const productName = `Plataforma ${stamp}`;
const leadTitle = `Lead Funil ${stamp}`;
const dealTitle = `Negócio Funil ${stamp}`;
const PIPELINE = "Funil de vendas";

let companyId = "";
let adminId = "";
let sdrId = "";
let closerId = "";
let pipelineId = "";
let leadId = "";
let dealId = "";

// Meses futuros fixos para o cronograma (ano que vem, janeiro a março).
const startYear = new Date().getFullYear() + 1;
const MONTHS = [`${startYear}-01`, `${startYear}-02`, `${startYear}-03`];

test.describe.configure({ mode: "serial" });
test.setTimeout(120_000);

test.beforeAll(async () => {
  const a = admin();
  adminId = await createTestUser({ email: adminEmail, password, fullName: "Admin Funil", superAdmin: true });
  sdrId = await createTestUser({ email: sdrEmail, password, fullName: "SDR Funil" });
  closerId = await createTestUser({ email: closerEmail, password, fullName: "Closer Funil" });
  const c = await a.from("companies").insert({ name: companyName, slug }).select("id").single();
  if (c.error) throw c.error;
  companyId = c.data.id;

  const std = await a.from("roles").select("id").eq("name", "Usuário padrão").single();
  if (std.error) throw std.error;
  const m1 = await a.from("memberships").insert({ user_id: sdrId, company_id: companyId, role_id: std.data.id });
  if (m1.error) throw m1.error;

  const role = await a
    .from("roles")
    .insert({
      name: roleName,
      permissions: {
        visibility: { leads: "company", deals: "company", persons: "company", organizations: "company", activities: "own" },
        actions: { create: true, edit: true, delete: true, export: true, reassign_owner: true },
        settings: {
          manage_pipelines: false,
          manage_custom_fields: false,
          manage_products: false,
          view_reports: true,
          create_dashboards: true,
          share_dashboards: false,
        },
      },
    })
    .select("id")
    .single();
  if (role.error) throw role.error;
  const m2 = await a.from("memberships").insert({ user_id: closerId, company_id: companyId, role_id: role.data.id });
  if (m2.error) throw m2.error;

  const p = await a.from("pipelines").select("id").eq("company_id", companyId).eq("name", PIPELINE).single();
  if (p.error) throw p.error;
  pipelineId = p.data.id;

  // O lead do SDR (a captura de leads já foi coberta na fase 2).
  const l = await a
    .from("leads")
    .insert({ company_id: companyId, owner_id: sdrId, title: leadTitle, estimated_value: 5000 })
    .select("id")
    .single();
  if (l.error) throw l.error;
  leadId = l.data.id;
});

test.afterAll(async () => {
  const a = admin();
  const errors: string[] = [];
  if (companyId) {
    const r = await a.from("companies").delete().eq("id", companyId);
    if (r.error) errors.push(`empresa: ${r.error.message}`);
  }
  const r = await a.from("roles").delete().eq("name", roleName);
  if (r.error) errors.push(`papel: ${r.error.message}`);
  for (const id of [adminId, sdrId, closerId].filter(Boolean)) {
    await deleteTestUser(id).catch((e) => errors.push(`usuário ${id}: ${String(e?.message ?? e)}`));
  }
  if (errors.length) {
    console.error("Falha na limpeza do E2E da fase 3:", errors);
    throw new Error(`Limpeza incompleta: ${errors.join("; ")}`);
  }
});

async function loggedIn(browser: Browser, email: string): Promise<Page> {
  const ctx = await browser.newContext({ baseURL: "http://localhost:3000" });
  const page = await ctx.newPage();
  await login(page, email, password);
  await page.waitForURL((u) => !u.pathname.startsWith("/entrar"));
  return page;
}

const column = (page: Page, name: string) => page.locator(`[data-testid="kanban-column"][aria-label="${name}"]`);
const card = (scope: Page | Locator, title: string) => scope.getByTestId("deal-card").filter({ hasText: title });

/** Arrasta com o mouse em passos (o sensor de ponteiro só ativa depois de 6 px). */
test("admin configura o funil (etapa exige contrato) e cria um produto recorrente", async ({ browser }) => {
  const page = await loggedIn(browser, adminEmail);

  await page.goto(`/configuracoes/funis?empresa=${slug}`);
  await page.getByRole("button", { name: `Editar ${PIPELINE}` }).click();
  const stage = page.locator('[data-testid="stage-row"][data-stage-name="Proposta"]');
  await expect(stage).toBeVisible();
  await stage.getByText("Campos obrigatórios").click();
  await stage.getByLabel("Condições de contrato").check();
  await stage.getByRole("button", { name: "Salvar etapa Proposta" }).click();
  await expect
    .poll(async () => {
      const { data } = await admin().from("stages").select("required_fields").eq("pipeline_id", pipelineId).eq("name", "Proposta").single();
      return data?.required_fields;
    })
    .toEqual(["contract"]);

  await page.goto(`/configuracoes/produtos?empresa=${slug}`);
  await page.getByLabel("Novo produto").fill(productName);
  await page.getByLabel("Tipo", { exact: true }).selectOption("recurring");
  await page.getByLabel("Preço padrão").fill("1.500,00");
  await page.getByRole("button", { name: "Adicionar produto" }).click();
  await expect(page.getByTestId("product-row").filter({ hasText: productName })).toContainText("Recorrente");
  await page.context().close();
});

test("SDR converte o lead em negócio", async ({ browser }) => {
  const page = await loggedIn(browser, sdrEmail);
  await page.goto(`/${slug}/leads/${leadId}`);
  await page.getByRole("button", { name: "Converter em negócio" }).click();
  const dlg = page.getByRole("dialog");
  await dlg.getByLabel("Título do negócio").fill(dealTitle);
  await dlg.getByLabel("Etapa").selectOption({ label: "Qualificação" });
  await dlg.getByRole("button", { name: "Converter", exact: true }).click();
  await page.waitForURL(new RegExp(`/${slug}/negocios/[0-9a-f-]{36}$`));
  dealId = page.url().split("/").pop()!;
  await expect(page.getByRole("heading", { level: 1, name: dealTitle })).toBeVisible();
  const d = await admin().from("deals").select("owner_id, status").eq("id", dealId).single();
  expect(d.data).toEqual({ owner_id: sdrId, status: "open" });
  await page.context().close();
});

test("closer arrasta pelas etapas, preenche o contrato, adiciona o produto e ganha", async ({ browser }) => {
  const page = await loggedIn(browser, closerEmail);
  await page.goto(`/${slug}/negocios?funil=${pipelineId}`);
  await expect(page.getByTestId("kanban-column").first()).toBeVisible();

  // Qualificação para Reunião.
  await expect(card(column(page, "Qualificação"), dealTitle)).toBeVisible();
  await dragCard(page, card(page, dealTitle), () => column(page, "Reunião"), { announce: "Sobre a etapa Reunião." });
  await expect(card(column(page, "Reunião"), dealTitle)).toBeVisible();
  await expect
    .poll(async () => (await admin().from("deals").select("stage_id, stages(name)").eq("id", dealId).single()).data?.stages)
    .toMatchObject({ name: "Reunião" });

  // Reunião para Proposta, sem recarregar: o card destrava assim que o movimento anterior termina.
  // A etapa exige contrato e o modal pede.
  await expect(card(column(page, "Reunião"), dealTitle)).toHaveAttribute("data-draggable", "true");
  await dragCard(page, card(page, dealTitle), () => column(page, "Proposta"), { announce: "Sobre a etapa Proposta." });
  const dialog = page.getByRole("dialog", { name: "Campos obrigatórios" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Condições de contrato");
  await dialog.getByLabel("MRR (R$)", { exact: true }).fill("1000");
  await dialog.getByLabel("Início do MRR").fill(MONTHS[0]);
  await dialog.getByLabel("Duração (meses)").fill("3");
  await dialog.getByRole("button", { name: "Salvar e mover" }).click();
  await expect(dialog).toBeHidden();
  await expect(card(column(page, "Proposta"), dealTitle)).toBeVisible();

  // Detalhe: adiciona o produto recorrente (datas do contrato já salvas).
  await page.goto(`/${slug}/negocios/${dealId}`);
  await expect(page.getByRole("heading", { level: 1, name: dealTitle })).toBeVisible();
  await page.getByRole("button", { name: "Adicionar produto" }).click();
  const add = page.getByRole("dialog");
  await add.getByLabel("Produto", { exact: true }).selectOption({ label: `${productName} (Recorrente)` });
  await add.getByRole("button", { name: "Adicionar", exact: true }).click();
  await expect(page.getByTestId("item-row")).toHaveCount(1);
  await expect(page.getByTestId("items-mrr")).toHaveText(/R\$\s*1\.500,00/);

  // Ganho: o cronograma mostra as três parcelas.
  await page.getByRole("button", { name: "Ganho", exact: true }).click();
  await expect(page.getByTestId("deal-status")).toHaveText("Ganho");
  const table = page.getByTestId("revenue-table");
  await expect(table.locator("tbody tr")).toHaveCount(3);
  for (const month of MONTHS) {
    await expect(table.locator(`tr[data-month="${month}"]`)).toContainText(/R\$\s*1\.500,00/);
  }
  await expect(page.getByTestId("revenue-table-total")).toContainText(/R\$\s*4\.500,00/);
  const sched = await admin().from("deal_revenue_schedule").select("month, mrr").eq("deal_id", dealId).order("month");
  expect(sched.data?.map((r) => r.month.slice(0, 7))).toEqual(MONTHS);
  expect(sched.data?.every((r) => Number(r.mrr) === 1500)).toBe(true);
  await page.context().close();
});

test("forecast não mostra mais o negócio e a lista de ganhos mostra", async ({ browser }) => {
  const page = await loggedIn(browser, closerEmail);
  await page.goto(`/${slug}/negocios?funil=${pipelineId}&visao=forecast`);
  await expect(page.getByRole("heading", { level: 1, name: "Negócios" })).toBeVisible();
  await expect(page.getByTestId("forecast-column").first()).toBeVisible();
  await expect(page.getByText(dealTitle)).toHaveCount(0);

  await page.goto(`/${slug}/negocios?funil=${pipelineId}&visao=lista`);
  await expect(page.getByRole("link", { name: dealTitle })).toHaveCount(0);
  await page.getByRole("link", { name: "Ganhos" }).click();
  await page.waitForURL(/status=won/);
  await expect(page.getByRole("link", { name: dealTitle })).toBeVisible();
  await page.context().close();
});
