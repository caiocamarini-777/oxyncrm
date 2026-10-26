import { expect, test, type Locator, type Page } from "@playwright/test";
import { admin, createTestUser, deleteTestUser, login } from "./helpers/auth";
import { runSql } from "./helpers/db";

const stamp = Date.now();
const password = "oxyn-test-123";
const slug = `tst-e2e-db-${stamp}`;
const adminEmail = `tst-e2e-db-admin-${stamp}@oxyn.test`;
const plainEmail = `tst-e2e-db-plain-${stamp}@oxyn.test`;
const slug2 = `tst-e2e-db2-${stamp}`;
const recvEmail = `tst-e2e-db-recv-${stamp}@oxyn.test`;
const roleName = `tst-e2e-db-sem-dashboards-${stamp}`;
const recvRoleName = `tst-e2e-db-sem-relatorios-${stamp}`;
const reportName = `Total de negócios ${stamp}`;
const dashName = `Painel comercial ${stamp}`;

let companyId = "";
let adminId = "";
let plainId = "";
let roleId = "";
let recvId = "";
let recvRoleId = "";
let company2Id = "";
let dashboardId = "";

test.describe.configure({ mode: "serial" });

async function insert(table: string, row: Record<string, unknown>): Promise<string> {
  const r = await admin().from(table).insert(row).select("id").single();
  if (r.error) throw r.error;
  return r.data.id as string;
}

test.beforeAll(async () => {
  adminId = await createTestUser({ email: adminEmail, password, fullName: "Ada Dashboards", superAdmin: true });
  plainId = await createTestUser({ email: plainEmail, password, fullName: "Paulo Plain" });
  companyId = await insert("companies", { name: `Dashboards E2E ${stamp}`, slug });

  // Papel de teste com relatórios, mas sem criar dashboards.
  const rows = await runSql<{ id: string }>(
    `insert into public.roles (name, description, permissions, is_system)
       select '${roleName}', 'Papel de teste', jsonb_set(jsonb_set(permissions, '{settings,view_reports}', 'true'), '{settings,create_dashboards}', 'false'), false
       from public.roles where is_system returning id`,
  );
  roleId = rows[0]!.id;
  await insert("memberships", { user_id: plainId, company_id: companyId, role_id: roleId });

  // Destinatário sem view_reports: só abre dashboards compartilhados.
  recvId = await createTestUser({ email: recvEmail, password, fullName: "Rita Receptora" });
  const recvRows = await runSql<{ id: string }>(
    `insert into public.roles (name, description, permissions, is_system)
       select '${recvRoleName}', 'Papel de teste', jsonb_set(jsonb_set(permissions, '{settings,view_reports}', 'false'), '{settings,create_dashboards}', 'false'), false
       from public.roles where is_system returning id`,
  );
  recvRoleId = recvRows[0]!.id;
  await insert("memberships", { user_id: recvId, company_id: companyId, role_id: recvRoleId });

  // Segunda empresa com negócios: o escopo da primeira não pode contá-los.
  company2Id = await insert("companies", { name: `Dashboards E2E B ${stamp}`, slug: slug2 });
  const pipeline2 = await insert("pipelines", { company_id: company2Id, name: `Funil DB2 ${stamp}`, position: -1 });
  const stage2 = await insert("stages", { company_id: company2Id, pipeline_id: pipeline2, name: "Etapa DB2", position: 0, probability: 50 });
  for (const k of [1, 2]) {
    await insert("deals", {
      company_id: company2Id,
      owner_id: adminId,
      pipeline_id: pipeline2,
      stage_id: stage2,
      position: k * 1024,
      title: `B${k} ${stamp}`,
      setup_total: 100,
      setup_first_due: "2026-12-01",
    });
  }

  const pipelineId = await insert("pipelines", { company_id: companyId, name: `Funil DB ${stamp}`, position: -1 });
  const stageId = await insert("stages", { company_id: companyId, pipeline_id: pipelineId, name: "Etapa DB", position: 0, probability: 50 });
  // Dois negócios recentes e um antigo: o período "Últimos 30 dias" tira o antigo da contagem.
  let pos = 0;
  for (const [key, createdAt] of [["N1", null], ["N2", null], ["N3", "2020-01-15T12:00:00Z"]] as const) {
    pos += 1024;
    await insert("deals", {
      company_id: companyId,
      owner_id: adminId,
      pipeline_id: pipelineId,
      stage_id: stageId,
      position: pos,
      title: `${key} ${stamp}`,
      setup_total: 100,
      setup_first_due: "2026-12-01",
      ...(createdAt ? { created_at: createdAt } : {}),
    });
  }
  await insert("reports", {
    owner_id: adminId,
    company_id: companyId,
    name: reportName,
    spec: { kind: "custom", base: "deals", metric: { op: "count" }, chart: "number" },
  });
});

test.afterAll(async () => {
  await admin().from("dashboards").delete().eq("owner_id", adminId);
  await admin().from("reports").delete().eq("owner_id", adminId);
  if (companyId) await admin().from("companies").delete().eq("id", companyId);
  if (company2Id) await admin().from("companies").delete().eq("id", company2Id);
  if (recvId) await deleteTestUser(recvId).catch(() => {});
  if (recvRoleId) await runSql(`delete from public.roles where id = '${recvRoleId}' and not is_system`);
  if (adminId) await deleteTestUser(adminId).catch(() => {});
  if (plainId) await deleteTestUser(plainId).catch(() => {});
  if (roleId) await runSql(`delete from public.roles where id = '${roleId}' and not is_system`);
});

const widget = (page: Page, title: string) => page.getByRole("article", { name: title });
const titles = (page: Page) => page.getByTestId("widget").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")));

/** Nenhum widget em erro e todos com conteúdo além do cabeçalho. */
async function expectHealthyWidgets(page: Page, count: number) {
  const all = page.getByTestId("widget");
  await expect(all).toHaveCount(count);
  for (let i = 0; i < count; i++) {
    const w = all.nth(i);
    await expect(w.getByRole("status")).toHaveCount(0); // carregamento terminou
    await expect(w.getByRole("alert")).toHaveCount(0);
    await expect.poll(async () => (await w.locator("div.overflow-auto").first().innerText()).trim().length).toBeGreaterThan(0);
  }
}

async function drag(page: Page, handle: Locator, target: Locator) {
  await handle.scrollIntoViewIfNeeded();
  const s = await handle.boundingBox();
  const t = await target.boundingBox();
  if (!s || !t) throw new Error("sem caixa");
  await page.mouse.move(s.x + s.width / 2, s.y + s.height / 2);
  await page.mouse.down();
  await page.mouse.move(s.x + s.width / 2 + 12, s.y + s.height / 2 + 12, { steps: 4 });
  await page.mouse.move(t.x + 20, t.y + 20, { steps: 20 });
  await page.mouse.move(t.x + 22, t.y + 22, { steps: 2 });
  await expect(page.locator('[id^="DndLiveRegion"]')).toHaveText(/^Widget .* na posição 1 de 2/);
  await page.mouse.up();
}

test("cria dashboard, adiciona widgets, reordena, redimensiona e persiste", async ({ page }) => {
  await login(page, adminEmail, password);
  await page.waitForURL((u) => !u.pathname.startsWith("/entrar"));
  await page.goto(`/${slug}/relatorios/dashboards`);
  await expect(page.getByRole("heading", { level: 1, name: "Dashboards" })).toBeVisible();
  await page.getByRole("button", { name: "Novo dashboard" }).click();
  await page.getByLabel("Nome").fill(dashName);
  await page.getByRole("button", { name: "Criar" }).click();
  await expect(page.getByRole("heading", { level: 1, name: dashName })).toBeVisible();
  dashboardId = page.url().split("/").pop()!.split("?")[0]!;

  await page.getByRole("button", { name: "Adicionar widget" }).click();
  await page.getByRole("radio", { name: /Visão do funil/ }).check();
  await page.getByLabel("Título").fill("Pipeline geral");
  await page.getByRole("button", { name: "Adicionar", exact: true }).click();
  await expect(widget(page, "Pipeline geral")).toBeVisible();

  await page.getByRole("button", { name: "Adicionar widget" }).click();
  await page.getByRole("radio", { name: reportName }).check();
  await page.getByRole("button", { name: "Adicionar", exact: true }).click();
  await expect(widget(page, reportName)).toBeVisible();
  expect(await titles(page)).toEqual(["Pipeline geral", reportName]);
  await expectHealthyWidgets(page, 2);

  // Arrasta o segundo para a primeira posição.
  await drag(page, page.getByRole("button", { name: `Mover widget ${reportName}` }), widget(page, "Pipeline geral"));
  await expect.poll(() => titles(page)).toEqual([reportName, "Pipeline geral"]);

  // Aumenta a largura do primeiro pela alça (uma coluna para a direita).
  const first = widget(page, reportName);
  await expect(first).toHaveAttribute("data-col-span", "2");
  const handle = first.getByTestId("widget-resize");
  const box = (await handle.boundingBox())!;
  const card = (await first.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + card.width / 2, box.y + box.height / 2, { steps: 10 });
  await page.mouse.up();
  await expect(first).toHaveAttribute("data-col-span", "3");

  // Atalho de teclado: seta para baixo aumenta a altura.
  const second = widget(page, "Pipeline geral");
  await second.getByTestId("widget-resize").focus();
  await page.keyboard.press("ArrowDown");
  await expect(second).toHaveAttribute("data-row-span", "2");

  await expect
    .poll(async () => {
      const r = await admin().from("dashboard_widgets").select("title, position, col_span, row_span").eq("dashboard_id", dashboardId).order("position");
      return JSON.stringify(r.data);
    })
    .toBe(
      JSON.stringify([
        { title: reportName, position: 0, col_span: 3, row_span: 1 },
        { title: "Pipeline geral", position: 1, col_span: 2, row_span: 2 },
      ]),
    );

  await page.reload();
  expect(await titles(page)).toEqual([reportName, "Pipeline geral"]);
  await expect(widget(page, reportName)).toHaveAttribute("data-col-span", "3");
  await expect(widget(page, "Pipeline geral")).toHaveAttribute("data-row-span", "2");
  await expectHealthyWidgets(page, 2);
});

test("o período global recalcula o widget e a URL inválida não quebra", async ({ page }) => {
  await login(page, adminEmail, password);
  await page.waitForURL((u) => !u.pathname.startsWith("/entrar"));
  const url = `/${slug}/relatorios/dashboards/${dashboardId}`;
  await page.goto(url);
  const number = widget(page, reportName).getByRole("img");
  await expect(number).toContainText("3"); // só a empresa do escopo: os 2 negócios da outra ficam de fora
  await expectHealthyWidgets(page, 2);

  await page.getByLabel("Período").selectOption({ label: "Últimos 30 dias" });
  await expect(page).toHaveURL(/de=\d{4}-\d{2}-\d{2}&ate=\d{4}-\d{2}-\d{2}/);
  await expect(widget(page, reportName).getByRole("img")).toContainText("2");

  const res = await page.goto(`${url}?de=lixo&ate=2026-01-01&empresa=nao-existe`);
  expect(res?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1, name: dashName })).toBeVisible();
  await expect(widget(page, reportName).getByRole("img")).toContainText("3");

  // Escopo de uma empresa: não há filtro de empresa.
  const filters = page.getByRole("group", { name: "Filtros do dashboard" });
  await expect(filters.getByLabel("Empresa")).toHaveCount(0);

  // Escopo "Todas as empresas": o filtro de empresa aparece e vai para a URL.
  await page.goto(`/todas/relatorios/dashboards/${dashboardId}`);
  await filters.getByLabel("Empresa").selectOption({ label: `Dashboards E2E ${stamp}` });
  await expect(page).toHaveURL(new RegExp(`empresa=${slug}`));
  await expect(widget(page, reportName).getByRole("img")).toContainText("3");
  await filters.getByLabel("Empresa").selectOption({ label: `Dashboards E2E B ${stamp}` });
  await expect(page).toHaveURL(new RegExp(`empresa=${slug2}`));
  // O relatório salvo é da empresa A: na B ele não conta nada (nem os 2 negócios dela).
  await expect(widget(page, reportName).getByRole("img")).toContainText("0");

  // Escopo único da segunda empresa: mesma regra, e nada da A vaza.
  await page.goto(`/${slug2}/relatorios/dashboards/${dashboardId}`);
  await expect(widget(page, reportName).getByRole("img")).toContainText("0");
});

test("usuário sem create_dashboards não vê Novo dashboard", async ({ page }) => {
  await login(page, plainEmail, password);
  await page.waitForURL((u) => !u.pathname.startsWith("/entrar"));
  await page.goto(`/${slug}/relatorios/dashboards`);
  await expect(page.getByRole("heading", { level: 1, name: "Dashboards" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Novo dashboard" })).toHaveCount(0);
  await expect(page.getByText("Nenhum dashboard foi compartilhado com você.")).toBeVisible();
  // O dashboard alheio não aparece nem abre.
  const res = await page.goto(`/${slug}/relatorios/dashboards/${dashboardId}`);
  expect(res?.status()).toBe(404);
});

test("dashboard compartilhado aparece em Compartilhados comigo e abre somente leitura", async ({ page }) => {
  const shared = await admin().from("dashboard_shares").insert({ dashboard_id: dashboardId, user_id: plainId });
  if (shared.error) throw shared.error;
  await login(page, plainEmail, password);
  await page.waitForURL((u) => !u.pathname.startsWith("/entrar"));
  await page.goto(`/${slug}/relatorios/dashboards`);
  await page.getByRole("link", { name: new RegExp(dashName) }).click();
  await expect(page.getByRole("heading", { level: 1, name: dashName })).toBeVisible();
  await expect(widget(page, "Pipeline geral")).toBeVisible();
  await expect(widget(page, reportName).getByRole("img")).toContainText("3");
  await expect(page.getByRole("button", { name: "Adicionar widget" })).toHaveCount(0);
  await expect(page.getByTestId("widget-resize")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Mover widget/ })).toHaveCount(0);
});

test("destinatário sem view_reports chega ao dashboard compartilhado pelo menu", async ({ page }) => {
  await login(page, recvEmail, password);
  await page.waitForURL((u) => !u.pathname.startsWith("/entrar"));

  // Sem view_reports e sem compartilhamento, Relatórios fica desativado.
  await page.goto(`/${slug}/inicio`);
  const nav = page.getByRole("navigation", { name: "Principal" });
  await expect(nav.getByLabel("Relatórios")).toHaveAttribute("aria-disabled", "true");

  // Com um dashboard compartilhado, o item leva direto aos dashboards.
  const shared = await admin().from("dashboard_shares").insert({ dashboard_id: dashboardId, user_id: recvId });
  if (shared.error) throw shared.error;
  await page.reload();
  const item = nav.getByRole("link", { name: "Relatórios" });
  await expect(item).toHaveAttribute("href", `/${slug}/relatorios/dashboards`);
  await item.click();
  await page.waitForURL(`**/${slug}/relatorios/dashboards`);
  await expect(page.getByRole("heading", { level: 1, name: "Dashboards" })).toBeVisible();
  await expect(item).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("heading", { name: "Meus dashboards" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Novo dashboard" })).toHaveCount(0);
  await page.getByRole("link", { name: new RegExp(dashName) }).click();

  await expect(page.getByRole("heading", { level: 1, name: dashName })).toBeVisible();
  await expectHealthyWidgets(page, 2);
  await expect(widget(page, reportName).getByRole("img")).toContainText("3");
  await expect(page.getByRole("button", { name: "Adicionar widget" })).toHaveCount(0);

  // Quem não tem acesso nenhum continua recebendo 404.
  const other = await admin().from("dashboards").insert({ owner_id: adminId, name: `Privado ${stamp}` }).select("id").single();
  if (other.error) throw other.error;
  const res = await page.goto(`/${slug}/relatorios/dashboards/${other.data.id}`);
  expect(res?.status()).toBe(404);
});
