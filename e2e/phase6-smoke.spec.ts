import { expect, test, type Page } from "@playwright/test";
import { admin, createTestUser, deleteTestUser, login } from "./helpers/auth";

const stamp = Date.now();
const password = "oxyn-test-123";
const slug = `tst-e2e-p6-${stamp}`;
const sdrEmail = `tst-e2e-p6-sdr-${stamp}@oxyn.test`;
const managerEmail = `tst-e2e-p6-gestor-${stamp}@oxyn.test`;
const personName = `Pessoa P6 ${stamp}`;
const leadTitle = `Lead P6 ${stamp}`;
const emailLeadTitle = `Lead e-mail P6 ${stamp}`;
const dealTitle = `Negócio P6 ${stamp}`;
const dashName = `Painel fase 6 ${stamp}`;
const FUNNEL = "Funil de reuniões por canal";
const REVENUE = "Receita mês a mês";
const WON_VALUE = 2500;
const GOAL_TARGET = 10_000;

let sdrId = "";
let managerId = "";
let companyId = "";
let leadId = "";
let emailLeadId = "";
let dealId = "";
let dashboardId = "";

test.describe.configure({ mode: "serial" });
test.setTimeout(120_000);

/** Primeiro dia do mês corrente em São Paulo (AAAA-MM-01), como o banco conta a meta mensal. */
const monthStart = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Sao_Paulo" }).format(new Date()).slice(0, 8) + "01";

const planned = (page: Page, subject: string) => page.getByTestId("planned-activity").filter({ hasText: subject });
const widget = (page: Page, title: string) => page.getByRole("article", { name: title });

async function signIn(page: Page, email: string) {
  await login(page, email, password);
  await page.waitForURL((u) => !u.pathname.startsWith("/entrar"));
}

type Funnel = { attempts: number; booked: number; held: number; opportunities: number; won: number };

/** Lê a linha do LinkedIn de uma tabela do funil (página do relatório ou widget); canal ausente conta zero. */
async function linkedinRow(scope: Page | ReturnType<typeof widget>): Promise<Funnel> {
  const row = scope.getByRole("row").filter({ hasText: "LinkedIn" });
  if ((await row.count()) === 0) return { attempts: 0, booked: 0, held: 0, opportunities: 0, won: 0 };
  const cells = await row.first().getByRole("cell").allInnerTexts();
  const n = (i: number) => Number(cells[i]!.trim().replace(/\./g, ""));
  return { attempts: n(1), booked: n(2), held: n(3), opportunities: n(4), won: n(5) };
}

async function funnelReport(page: Page): Promise<Funnel> {
  await page.goto(`/${slug}/relatorios/prontos/channel_funnel`);
  await expect(page.getByRole("heading", { level: 1, name: FUNNEL })).toBeVisible();
  // Sem dados a tabela nem aparece; espera a tabela ou o aviso de vazio.
  await expect(page.getByRole("columnheader", { name: "Tentativas" }).or(page.getByText("Sem dados no período"))).toBeVisible();
  return linkedinRow(page);
}

/** Texto da tabela do widget de receita (o gráfico em linha não tem números legíveis no DOM). */
async function revenueTable(page: Page): Promise<string> {
  const w = widget(page, REVENUE);
  await w.getByRole("button", { name: "Ver tabela" }).click();
  await expect(w.getByRole("row").nth(1)).toBeVisible();
  return ((await w.getByRole("table").innerText()) ?? "").replace(/\s/g, " ");
}

async function workLead(page: Page, id: string, subject: string, channel: string) {
  await page.goto(`/${slug}/leads/${id}`);
  await page.getByRole("tab", { name: "Atividade", exact: true }).click();
  await page.getByLabel("Assunto").fill(subject);
  await page.getByLabel("Canal").selectOption({ label: channel });
  await page.getByRole("button", { name: "Salvar atividade" }).click();
  await expect(planned(page, subject)).toBeVisible();
  await planned(page, subject).getByRole("button", { name: /^Concluir/ }).click();
}

test.beforeAll(async () => {
  sdrId = await createTestUser({ email: sdrEmail, password, fullName: "Sara SDR", superAdmin: true });
  managerId = await createTestUser({ email: managerEmail, password, fullName: "Gil Gestor", superAdmin: true });
  const a = admin();
  const c = await a.from("companies").insert({ name: `Fase 6 E2E ${stamp}`, slug }).select("id").single();
  if (c.error) throw c.error;
  companyId = c.data.id;

  const p = await a.from("persons").insert({ company_id: companyId, owner_id: sdrId, full_name: personName }).select("id").single();
  if (p.error) throw p.error;
  const l = await a
    .from("leads")
    .insert({ company_id: companyId, owner_id: sdrId, title: leadTitle, person_id: p.data.id })
    .select("id")
    .single();
  if (l.error) throw l.error;
  leadId = l.data.id;
  const l2 = await a.from("leads").insert({ company_id: companyId, owner_id: sdrId, title: emailLeadTitle }).select("id").single();
  if (l2.error) throw l2.error;
  emailLeadId = l2.data.id;

  // Meta mensal de valor ganho da empresa, criada antes do ganho.
  const g = await a.from("goals").insert({
    company_id: companyId,
    target_kind: "company",
    metric: "won_value",
    period: "month",
    starts_on: monthStart(),
    target_value: GOAL_TARGET,
    created_by: managerId,
  });
  if (g.error) throw g.error;
});

test.afterAll(async () => {
  const a = admin();
  if (managerId) await a.from("dashboards").delete().eq("owner_id", managerId);
  if (companyId) {
    await a.from("goals").delete().eq("company_id", companyId);
    const del = await a.from("companies").delete().eq("id", companyId);
    if (del.error) console.error("limpeza da empresa:", del.error.message);
  }
  if (sdrId) await deleteTestUser(sdrId).catch(() => {});
  if (managerId) await deleteTestUser(managerId).catch(() => {});
});

let before: Funnel;

test("o gestor anota o funil e a meta antes da jornada", async ({ page }) => {
  await signIn(page, managerEmail);
  before = await funnelReport(page);
  await page.goto(`/${slug}/relatorios/metas`);
  const row = page.getByRole("listitem").filter({ hasText: "Valor ganho" });
  await expect(row).toContainText("0,0%");
});

test("SDR registra tentativas no LinkedIn e por e-mail, agenda e realiza a reunião, converte e ganha", async ({ page }) => {
  await signIn(page, sdrEmail);

  // Tentativa por e-mail em outro lead: não pode entrar na linha do LinkedIn.
  await workLead(page, emailLeadId, `Contato e-mail P6 ${stamp}`, "E-mail");
  await page.getByRole("radio", { name: "Sem resposta" }).click();
  await page.getByRole("button", { name: "Concluir", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // Tentativa no LinkedIn que agenda a reunião; a reunião é realizada.
  const subject = `Contato LinkedIn P6 ${stamp}`;
  await workLead(page, leadId, subject, "LinkedIn");
  await page.getByRole("radio", { name: "Reunião agendada" }).click();
  await page.getByLabel("Data e hora da reunião").fill("2031-03-10T14:30");
  await page.getByRole("button", { name: "Concluir", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const meeting = planned(page, `Reunião com ${personName}`);
  await expect(meeting).toContainText("LinkedIn");
  await meeting.getByRole("button", { name: /^Concluir/ }).click();
  await page.getByRole("radio", { name: "Realizada" }).click();
  await page.getByRole("button", { name: "Concluir", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(planned(page, `Reunião com ${personName}`)).toHaveCount(0);

  // Conversão em negócio.
  await page.goto(`/${slug}/leads/${leadId}`);
  await page.getByRole("button", { name: "Converter em negócio" }).click();
  const dlg = page.getByRole("dialog");
  await dlg.getByLabel("Título do negócio").fill(dealTitle);
  await dlg.getByRole("button", { name: "Converter", exact: true }).click();
  await page.waitForURL(new RegExp(`/${slug}/negocios/[0-9a-f-]{36}$`));
  dealId = page.url().split("/").pop()!;

  // Valor do negócio e ganho pela interface.
  const set = await admin().from("deals").update({ setup_total: WON_VALUE, setup_first_due: "2026-12-01" }).eq("id", dealId);
  if (set.error) throw set.error;
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: dealTitle })).toBeVisible();
  await page.getByRole("button", { name: "Ganho", exact: true }).click();
  await expect(page.getByTestId("deal-status")).toHaveText("Ganho");
});

test("o gestor vê o LinkedIn avançar um passo em cada etapa do funil", async ({ page }) => {
  await signIn(page, managerEmail);
  const after = await funnelReport(page);
  expect(after).toEqual({
    attempts: before.attempts + 1,
    booked: before.booked + 1,
    held: before.held + 1,
    opportunities: before.opportunities + 1,
    won: before.won + 1,
  });
  // A tentativa por e-mail aparece na própria linha e não altera o LinkedIn.
  await expect(page.getByRole("row").filter({ hasText: "E-mail" }).first().getByRole("cell").nth(1)).toHaveText("1");
});

let internal = "";
let funnelInternal: Funnel;
let publicPath = "";

test("o gestor cria o dashboard com os dois widgets e gera o link público", async ({ page }) => {
  await signIn(page, managerEmail);
  await page.goto(`/${slug}/relatorios/dashboards`);
  await page.getByRole("button", { name: "Novo dashboard" }).click();
  await page.getByLabel("Nome").fill(dashName);
  await page.getByRole("button", { name: "Criar" }).click();
  await expect(page.getByRole("heading", { level: 1, name: dashName })).toBeVisible();
  dashboardId = page.url().split("/").pop()!.split("?")[0]!;

  for (const name of [FUNNEL, REVENUE]) {
    await page.getByRole("button", { name: "Adicionar widget" }).click();
    await page.getByRole("radio", { name }).check();
    await page.getByRole("button", { name: "Adicionar", exact: true }).click();
    await expect(widget(page, name)).toBeVisible();
  }
  await expect(widget(page, FUNNEL).getByRole("columnheader", { name: "Tentativas" })).toBeVisible();
  funnelInternal = await linkedinRow(widget(page, FUNNEL));
  expect(funnelInternal.won).toBe(before.won + 1);
  await expect(widget(page, REVENUE).getByRole("alert")).toHaveCount(0);
  internal = await revenueTable(page);

  await page.getByRole("button", { name: "Compartilhar" }).click();
  const dialog = page.getByRole("dialog", { name: "Compartilhar dashboard" });
  await dialog.getByRole("tab", { name: "Link público" }).click();
  await dialog.getByRole("button", { name: "Criar link" }).click();
  const url = await dialog.getByLabel("URL do link").inputValue();
  expect(url).toMatch(/\/d\/[A-Za-z0-9_-]{43}$/);
  publicPath = new URL(url).pathname;
});

test("a página pública, sem sessão, mostra os mesmos números", async ({ browser }) => {
  const anon = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  try {
    const p = await anon.newPage();
    const res = await p.goto(publicPath);
    expect(res?.status()).toBe(200);
    await expect(p.getByRole("heading", { level: 1, name: dashName })).toBeVisible();
    await expect(widget(p, FUNNEL).getByRole("columnheader", { name: "Tentativas" })).toBeVisible();
    expect(await linkedinRow(widget(p, FUNNEL))).toEqual(funnelInternal);
    await expect(widget(p, REVENUE).getByRole("alert")).toHaveCount(0);
    expect(await revenueTable(p)).toBe(internal);
    expect(p.url()).not.toContain("/entrar");
  } finally {
    await anon.close();
  }
});

test("a meta de Valor ganho avançou", async ({ page }) => {
  await signIn(page, managerEmail);
  await page.goto(`/${slug}/relatorios/metas`);
  const row = page.getByRole("listitem").filter({ hasText: "Valor ganho" });
  await expect(row).toContainText("25,0%");
  await expect(row).toContainText(/Realizado R\$\s2\.500,00 de R\$\s10\.000,00/);
  await expect(row.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "25");
});
