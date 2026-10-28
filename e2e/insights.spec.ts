import { expect, test } from "@playwright/test";
import { admin, createTestUser, deleteTestUser, login } from "./helpers/auth";

const stamp = Date.now();
const password = "oxyn-test-123";
const slug = `tst-e2e-ins-${stamp}`;
const email = `tst-e2e-ins-${stamp}@oxyn.test`;
const reportName = `Leads por canal ${stamp}`;

let companyId = "";
let userId = "";

test.describe.configure({ mode: "serial" });

async function insert(table: string, row: Record<string, unknown>): Promise<string> {
  const r = await admin().from(table).insert(row).select("id").single();
  if (r.error) throw r.error;
  return r.data.id as string;
}

test.beforeAll(async () => {
  userId = await createTestUser({ email, password, fullName: "Ina Insights", superAdmin: true });
  companyId = await insert("companies", { name: `Insights E2E ${stamp}`, slug });
  const jitter = await insert("lead_sources", { company_id: companyId, name: "Jitterbit E2E" });
  const prosp = await insert("lead_sources", { company_id: companyId, name: "Prospecção E2E" });
  // 3 leads neste mês: 2 Jitterbit, 1 Prospecção
  for (const [i, source] of [jitter, jitter, prosp].entries()) {
    await insert("leads", { company_id: companyId, owner_id: userId, title: `Lead ${i} ${stamp}`, source_id: source });
  }
});

test.afterAll(async () => {
  if (companyId) await admin().from("companies").delete().eq("id", companyId);
  if (userId) await deleteTestUser(userId).catch(() => {});
});

test("cria relatório, segmenta, troca a cor, salva e monta o painel", async ({ page, browser }) => {
  await login(page, email, password);
  await page.waitForURL((u) => !u.pathname.startsWith("/entrar"));
  await page.goto(`/${slug}/relatorios`);
  await expect(page.getByRole("heading", { name: "Insights" })).toBeVisible();

  // Criar › Relatório › Lead › Desempenho
  await page.getByRole("complementary", { name: "Insights" }).getByRole("button", { name: /Criar/ }).click();
  await page.getByRole("menuitem", { name: "Relatório" }).click();
  const dialog = page.getByRole("dialog", { name: "Adicionar novo relatório" });
  await dialog.getByRole("button", { name: "Lead" }).click();
  await dialog.getByRole("button", { name: /Desempenho/ }).click();
  await dialog.getByRole("button", { name: "Continuar" }).click();
  await page.waitForURL(/\/relatorios\/r\/novo/);
  await expect(page.getByText("1 filtro aplicado")).toBeVisible();

  // Ver por canal e segmentar por status
  await page.getByRole("combobox", { name: "Ver por" }).click();
  await page.getByPlaceholder("Buscar", { exact: true }).last().fill("Canal de origem");
  await page.getByRole("option", { name: /Canal de origem/ }).first().click();
  await page.getByRole("combobox", { name: "Segmentar por" }).click();
  await page.getByPlaceholder("Buscar", { exact: true }).last().fill("Status do lead");
  await page.getByRole("option", { name: /Status do lead/ }).first().click();
  await expect(page.getByRole("region", { name: "Gráfico" }).getByText("Jitterbit E2E")).toBeVisible();
  await expect(page.getByRole("region", { name: "Registros" }).getByText("3 registros")).toBeVisible();

  // Resumo: a tabela dinâmica soma 3
  await page.getByRole("tab", { name: "Resumo" }).click();
  await expect(page.getByRole("region", { name: "Registros" }).getByRole("row", { name: /^Total \d/ })).toContainText("3");

  // Cor do segmento "Aberto"
  await page.getByRole("button", { name: "Configurações do gráfico" }).click();
  await page.getByRole("menuitem", { name: "Personalizar cores do gráfico" }).click();
  const colors = page.getByRole("dialog", { name: "Personalizar cores" });
  await colors.getByRole("button", { name: "#e34948" }).click();
  await colors.getByRole("button", { name: "Salvar" }).click();
  await expect(colors).toHaveCount(0);

  // Nome, salvar e mandar para um painel novo
  await page.getByRole("textbox", { name: "Nome do relatório" }).fill(reportName);
  await page.getByRole("button", { name: "Adicionar ao painel" }).click();
  await page.getByRole("menuitem", { name: "Novo painel" }).click();
  await page.waitForURL(/\/relatorios\/r\/[0-9a-f-]{36}$/);
  await expect(page.getByText("Relatório adicionado ao painel.")).toBeVisible();
  const saved = await admin().from("insight_reports").select("colors, chart_type").eq("name", reportName).single();
  expect(saved.data?.colors).toEqual({ open: "#e34948" });

  // Painel: o widget aparece e o filtro rápido de período muda o chip
  await page.getByRole("link", { name: "Novo painel" }).click();
  await page.waitForURL(/\/relatorios\/paineis\//);
  const widget = page.getByRole("article", { name: reportName });
  await expect(widget).toBeVisible();
  await expect(widget.getByText("ESTE MÊS")).toBeVisible();
  await page.getByRole("button", { name: /Período/ }).click();
  await page.getByRole("button", { name: "Mês passado" }).click();
  await expect(widget.getByText("MÊS PASSADO")).toBeVisible();
  await expect(widget.getByText("Os resultados não podem ser exibidos com as opções de filtro ou agrupamento atuais.")).toBeVisible();

  // Link público
  await page.getByRole("button", { name: "Ações do painel" }).click();
  await page.getByRole("menuitem", { name: /Compartilhar/ }).click();
  const share = page.getByRole("dialog", { name: "Compartilhar painel" });
  await share.getByRole("button", { name: "Gerar link" }).click();
  const link = share.getByRole("textbox", { name: "Link público" });
  await expect(link).toHaveValue(/\/d\//);
  const url = await link.inputValue();
  expect(url).toMatch(/\/d\/[A-Za-z0-9_-]{43}$/);
  const anon = await browser.newPage();
  await anon.goto(url);
  await expect(anon.getByRole("heading", { name: "Novo painel" })).toBeVisible();
  await expect(anon.getByRole("article", { name: reportName })).toBeVisible();
  await anon.close();
});
