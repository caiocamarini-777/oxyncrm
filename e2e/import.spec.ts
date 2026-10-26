import { expect, test, type Browser, type Page } from "@playwright/test";
import { admin, createTestUser, deleteTestUser, login } from "./helpers/auth";
import { buildFixture, startFakePipedrive, type FakePipedrive } from "./helpers/fake-pipedrive";
import { startTempNext, type TempNext } from "./helpers/temp-next";

// Assistente de importação do Pipedrive contra um servidor falso. O servidor de dev em :3000 não tem
// PIPEDRIVE_BASE_URL apontando para o falso, então o spec sobe um next dev temporário (outra porta, cópia do
// projeto) com o token e a URL falsos, e encerra os dois pelo PID no fim. Nada aqui fala com o Pipedrive real.

test.describe.configure({ mode: "serial" });

const stamp = Date.now();
const password = "senha-teste-123";
const adminEmail = `tst-e2e-import-admin-${stamp}@oxyn.test`;
const sellerEmail = `tst-e2e-import-vendedor-${stamp}@oxyn.test`;
const fakeToken = `token-falso-${stamp}`;
const port = Number(process.env.E2E_IMPORT_PORT ?? 3101);

const fixture = buildFixture(stamp, { adminEmail, sellerEmail });
const { alfa, beta } = fixture.names;

let fake: FakePipedrive;
let next: TempNext;
let adminId = "";
let sellerId = "";
let betaId = "";
let alfaId = "";
let firstJob = "";

test.beforeAll(async () => {
  test.setTimeout(300_000);
  const a = admin();
  adminId = await createTestUser({ email: adminEmail, password, fullName: `Admin Importação ${stamp}`, superAdmin: true });
  sellerId = await createTestUser({ email: sellerEmail, password, fullName: `Vendedor Importação ${stamp}` });
  const c = await a.from("companies").insert({ name: beta, slug: `tst-e2e-import-beta-${stamp}` }).select("id").single();
  if (c.error) throw c.error;
  betaId = c.data.id;
  const role = await a.from("roles").select("id").eq("name", "Usuário padrão").single();
  if (role.error) throw role.error;
  const m = await a.from("memberships").insert({ user_id: sellerId, company_id: betaId, role_id: role.data.id });
  if (m.error) throw m.error;

  fake = await startFakePipedrive(fixture, fakeToken);
  next = await startTempNext({
    name: "import",
    port,
    env: { PIPEDRIVE_API_TOKEN: fakeToken, PIPEDRIVE_BASE_URL: fake.url },
  });
});

test.afterAll(async () => {
  test.setTimeout(120_000);
  await next?.stop();
  await fake?.close();
  const a = admin();
  if (adminId) await a.from("import_jobs").delete().eq("created_by", adminId);
  if (!alfaId) {
    const found = await a.from("companies").select("id").eq("name", alfa).maybeSingle();
    alfaId = found.data?.id ?? "";
  }
  for (const id of [alfaId, betaId]) if (id) await a.from("companies").delete().eq("id", id);
  for (const id of [adminId, sellerId]) if (id) await deleteTestUser(id).catch(() => {});
});

async function newPage(browser: Browser, email = adminEmail): Promise<Page> {
  const ctx = await browser.newContext({ baseURL: next.url });
  const page = await ctx.newPage();
  await login(page, email, password);
  await page.waitForURL((u) => !u.pathname.startsWith("/entrar"), { timeout: 120_000 });
  return page;
}

// o roteador mantém a página anterior oculta no DOM: só os elementos visíveis contam
const visible = (page: Page, testId: string) => page.getByTestId(testId).filter({ visible: true });
const counter = (page: Page, entity: string, key: string) => visible(page, `counter-${entity}-${key}`);

async function goToReview(page: Page) {
  for (let i = 0; i < 5; i++) await page.getByRole("button", { name: "Próximo" }).click();
  await expect(page.getByRole("heading", { name: "Revisão" })).toBeVisible();
}

test("admin mapeia, simula e importa até concluir", async ({ browser }) => {
  test.setTimeout(300_000);
  const page = await newPage(browser);
  await page.goto("/configuracoes/empresas");
  await page.getByRole("navigation", { name: "Configurações" }).getByRole("link", { name: "Importação" }).click();
  await expect(page.getByRole("heading", { name: "Importação do Pipedrive" })).toBeVisible({ timeout: 60_000 });
  await page.getByRole("button", { name: "Nova importação" }).click();
  await page.waitForURL(/\/configuracoes\/importacao\/[0-9a-f-]{36}$/, { timeout: 60_000 });
  firstJob = page.url().split("/").pop()!;

  // Funis: os 2 do servidor falso; o primeiro vai para uma empresa nova, o segundo já casou com a existente
  await expect(page.getByRole("group", { name: alfa })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("group", { name: beta })).toBeVisible();
  await expect(page.getByLabel(`Empresa de destino de ${beta}`)).toHaveValue(betaId);
  await page.getByLabel(`Empresa de destino de ${alfa}`).selectOption({ label: `Criar empresa "${alfa}"` });
  await expect(page.getByLabel(`Empresa de destino de ${alfa}`).locator("option:checked")).toHaveText(alfa, { timeout: 30_000 });
  alfaId = await page.getByLabel(`Empresa de destino de ${alfa}`).inputValue();
  expect(alfaId).toMatch(/^[0-9a-f-]{36}$/);
  await expect(page.getByLabel(`Funil de destino de ${alfa}`)).toHaveValue("");

  // Usuários: casados por e-mail
  await page.getByRole("button", { name: "Próximo" }).click();
  await expect(page.getByLabel("Usuário do Oxyn para Admin Pipedrive")).toHaveValue(adminId);
  await expect(page.getByLabel("Usuário do Oxyn para Vendedor Pipedrive")).toHaveValue(sellerId);

  // Etiquetas: BETA casou pelo nome; ALFA vai para a empresa criada agora
  await page.getByRole("button", { name: "Próximo" }).click();
  await expect(page.getByLabel(`Empresa da etiqueta BETA ${stamp}`)).toHaveValue(betaId);
  await page.getByLabel(`Empresa da etiqueta ALFA ${stamp}`).selectOption(alfaId);
  await expect(page.getByLabel("Empresa da etiqueta Hot")).toHaveValue("");

  // Padrões
  await page.getByRole("button", { name: "Próximo" }).click();
  await page.getByLabel("Empresa padrão").selectOption(betaId);
  await expect(page.getByLabel("Dono padrão")).toHaveValue(adminId);

  // Campos: sugestões aceitas
  await page.getByRole("button", { name: "Próximo" }).click();
  await expect(page.getByLabel("Destino do campo Setup")).toHaveValue("native:setup_total");
  await expect(page.getByLabel("Destino do campo MRR contratado")).toHaveValue("native:mrr");
  await expect(page.getByLabel("Destino do campo Prazo (meses)")).toHaveValue("native:contract_months");
  await expect(page.getByLabel("Destino do campo Temperatura")).toHaveValue("custom");
  await expect(page.getByLabel("Chave do campo Temperatura")).toHaveValue("temperatura");

  await page.getByRole("button", { name: "Próximo" }).click();
  await expect(page.getByRole("heading", { name: "Revisão" })).toBeVisible();
  await expect(page.getByText("Tudo pronto para iniciar.")).toBeVisible();

  // Simulação não grava nada
  await page.getByRole("button", { name: "Simular (sem gravar)" }).click();
  const sim = page.getByTestId("simulation");
  await expect(sim.getByText("Simulação concluída")).toBeVisible({ timeout: 120_000 });
  await expect(sim.getByTestId("counter-deals-created")).toHaveText("3");
  const before = await admin().from("deals").select("id", { count: "exact", head: true }).eq("company_id", alfaId);
  expect(before.count).toBe(0);

  await page.getByRole("button", { name: "Iniciar importação" }).click();
  await expect(visible(page, "import-status")).toHaveText("Concluída", { timeout: 180_000 });

  // Relatório: contagens da fixture e o erro proposital (atividade sem vínculo)
  await expect(counter(page, "organizations", "created")).toHaveText("3");
  await expect(counter(page, "persons", "created")).toHaveText("4");
  await expect(counter(page, "leads", "created")).toHaveText("3");
  await expect(counter(page, "deals", "created")).toHaveText("3");
  await expect(counter(page, "activities", "created")).toHaveText("4");
  await expect(counter(page, "activities", "errors")).toHaveText("1");
  await expect(counter(page, "notes", "created")).toHaveText("2");
  const errors = visible(page, "import-errors");
  await expect(errors.getByRole("listitem")).toHaveCount(1);
  await expect(errors).toContainText("atividade sem negócio, lead, pessoa ou organização");
});

test("registros importados aparecem nas listas da empresa", async ({ browser }) => {
  test.setTimeout(180_000);
  const a = admin();
  const company = await a.from("companies").select("slug").eq("id", alfaId).single();
  if (company.error) throw company.error;
  const slug = company.data.slug;
  const page = await newPage(browser);

  await page.goto(`/${slug}/leads`);
  await expect(page.getByText(`Lead Um ${stamp}`)).toBeVisible({ timeout: 60_000 });
  await page.goto(`/${slug}/contatos`);
  await expect(page.getByText(`Pessoa Um ${stamp}`)).toBeVisible({ timeout: 60_000 });

  // negócio ganho com a data histórica e os campos nativos
  const won = await a
    .from("deals")
    .select("id, status, won_at, mrr, setup_total, contract_months, custom_fields")
    .eq("company_id", alfaId)
    .eq("title", `Negócio Ganho ${stamp}`)
    .single();
  if (won.error) throw won.error;
  expect(won.data.status).toBe("won");
  expect(new Date(won.data.won_at).toISOString()).toBe("2024-03-15T10:00:00.000Z");
  expect(Number(won.data.mrr)).toBe(1000);
  expect(Number(won.data.setup_total)).toBe(5000);
  expect(won.data.contract_months).toBe(12);
  expect(won.data.custom_fields).toMatchObject({ temperatura: "Quente" });
  await page.goto(`/${slug}/negocios/${won.data.id}`);
  await expect(page.getByRole("heading", { level: 1, name: `Negócio Ganho ${stamp}` })).toBeVisible({ timeout: 60_000 });

  // atividades importadas são legado
  const acts = await a.from("activities").select("legacy, subject").in("company_id", [alfaId, betaId]);
  if (acts.error) throw acts.error;
  expect(acts.data).toHaveLength(4);
  expect(acts.data.every((x) => x.legacy === true)).toBe(true);
});

test("rodar a mesma importação de novo não cria nem duplica", async ({ browser }) => {
  test.setTimeout(300_000);
  const a = admin();
  const count = async (table: string) => {
    const r = await a.from(table).select("id", { count: "exact", head: true }).in("company_id", [alfaId, betaId]);
    if (r.error) throw r.error;
    return r.count;
  };
  const tables = ["organizations", "persons", "leads", "deals", "activities", "notes", "pipelines", "stages"];
  const before = Object.fromEntries(await Promise.all(tables.map(async (t) => [t, await count(t)])));

  const page = await newPage(browser);
  await page.goto(`/configuracoes/importacao/${firstJob}`);
  await page.getByRole("button", { name: "Importar de novo" }).click();
  await page.waitForURL((u) => /\/configuracoes\/importacao\/[0-9a-f-]{36}$/.test(u.pathname) && !u.pathname.endsWith(firstJob), {
    timeout: 60_000,
  });
  await expect(page.getByLabel(`Empresa de destino de ${alfa}`)).toHaveValue(alfaId, { timeout: 60_000 });
  await goToReview(page);
  await page.getByRole("button", { name: "Iniciar importação" }).click();
  await expect(visible(page, "import-status")).toHaveText("Concluída", { timeout: 180_000 });
  for (const e of ["organizations", "persons", "leads", "deals", "activities", "notes"]) {
    await expect(counter(page, e, "created")).toHaveText("0");
  }
  await expect(counter(page, "deals", "unchanged")).toHaveText("3");

  const after = Object.fromEntries(await Promise.all(tables.map(async (t) => [t, await count(t)])));
  expect(after).toEqual(before);
});

test("pausar e retomar continuam de onde parou", async ({ browser }) => {
  test.setTimeout(300_000);
  const page = await newPage(browser);
  await page.goto(`/configuracoes/importacao/${firstJob}`);
  await page.getByRole("button", { name: "Importar de novo" }).click();
  await page.waitForURL((u) => /\/configuracoes\/importacao\/[0-9a-f-]{36}$/.test(u.pathname) && !u.pathname.endsWith(firstJob), {
    timeout: 60_000,
  });
  const jobId = page.url().split("/").pop()!;
  await expect(page.getByLabel(`Empresa de destino de ${alfa}`)).toHaveValue(alfaId, { timeout: 60_000 });
  await goToReview(page);
  fake.setDelay(1500);
  try {
    await page.getByRole("button", { name: "Iniciar importação" }).click();
    await expect(visible(page, "import-status")).toHaveText("Em andamento", { timeout: 60_000 });
    await page.getByRole("button", { name: "Pausar" }).click();
    await expect(visible(page, "import-status")).toHaveText("Pausada");
    // a fatia em curso termina a unidade; depois o status no banco fica pausado e Retomar libera
    await expect(page.getByRole("button", { name: "Retomar" })).toBeEnabled({ timeout: 90_000 });
    const paused = await admin().from("import_jobs").select("status, cursor").eq("id", jobId).single();
    expect(paused.data?.status).toBe("paused");
    fake.setDelay(0);
    await page.getByRole("button", { name: "Retomar" }).click();
    await expect(visible(page, "import-status")).toHaveText("Concluída", { timeout: 180_000 });
    await expect(counter(page, "deals", "created")).toHaveText("0");
  } finally {
    fake.setDelay(0);
  }
});

test("usuário que não é admin geral recebe 404", async ({ browser }) => {
  const page = await newPage(browser, sellerEmail);
  const res = await page.goto("/configuracoes/importacao");
  expect(res?.status()).toBe(404);
  const job = await page.goto(`/configuracoes/importacao/${firstJob}`);
  expect(job?.status()).toBe(404);
});

test("token recusado pelo Pipedrive dá mensagem clara", async ({ browser }) => {
  test.setTimeout(120_000);
  const page = await newPage(browser);
  const rejectedBefore = fake.rejected;
  expect(rejectedBefore).toBe(0); // nenhuma chamada anterior foi sem o token certo
  fake.setToken("outro-token");
  try {
    await page.goto("/configuracoes/importacao");
    await page.getByRole("button", { name: "Nova importação" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "O Pipedrive recusou o token (401)" })).toBeVisible({ timeout: 60_000 });
    await page.goto(`/configuracoes/importacao/${firstJob}`);
    await expect(visible(page, "import-status")).toHaveText("Concluída");
    expect(fake.rejected).toBeGreaterThan(rejectedBefore);
  } finally {
    fake.setToken(fakeToken);
  }
});
