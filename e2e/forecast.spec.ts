import { expect, test, type Page } from "@playwright/test";
import { admin, createTestUser, deleteTestUser, login } from "./helpers/auth";

const stamp = Date.now();
const password = "oxyn-test-123";
const slug = `tst-e2e-fc-${stamp}`;
const adminEmail = `tst-e2e-fc-admin-${stamp}@oxyn.test`;

let companyId = "";
let adminId = "";
let pipelineId = "";
const stage: Record<string, string> = {};
const title = (k: string) => `${k} ${stamp}`;

test.describe.configure({ mode: "serial" });

/** "YYYY-MM" do mês atual somado de `offset` meses (America/Sao_Paulo, como o app). */
function monthKey(offset: number): string {
  const d = new Date(Date.now() - 3 * 3600_000);
  const idx = d.getUTCFullYear() * 12 + d.getUTCMonth() + offset;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}`;
}
const day = (offset: number) => `${monthKey(offset)}-15`;

async function insert(table: string, row: Record<string, unknown>): Promise<string> {
  const r = await admin().from(table).insert(row).select("id").single();
  if (r.error) throw r.error;
  return r.data.id as string;
}

let pos = 0;
async function mkDeal(key: string, stageKey: string, row: Record<string, unknown>) {
  pos += 1024;
  await insert("deals", {
    company_id: companyId,
    owner_id: adminId,
    pipeline_id: pipelineId,
    stage_id: stage[stageKey],
    position: pos,
    title: title(key),
    ...row,
  });
}

test.beforeAll(async () => {
  adminId = await createTestUser({ email: adminEmail, password, fullName: "Ada Forecast", superAdmin: true });
  companyId = await insert("companies", { name: `Forecast E2E ${stamp}`, slug });
  pipelineId = await insert("pipelines", { company_id: companyId, name: `Funil FC ${stamp}`, position: -1 });
  const mk = async (key: string, name: string, position: number, probability: number) => {
    stage[key] = await insert("stages", { company_id: companyId, pipeline_id: pipelineId, name, position, probability });
  };
  await mk("a", "Cinquenta", 0, 50);
  await mk("b", "Vinte", 1, 20);

  await mkDeal("D1", "a", { estimated_value: 1000, expected_close_date: day(0) });
  await mkDeal("D2", "a", { estimated_value: 2000, expected_close_date: day(1) });
  await mkDeal("D3", "b", { estimated_value: 500, expected_close_date: day(2) });
  await mkDeal("SemData", "b", { estimated_value: 300 });
  await mkDeal("Atrasado", "a", { estimated_value: 700, expected_close_date: day(-2) });
  await mkDeal("Longe", "a", { estimated_value: 9999, expected_close_date: day(9) });
  await mkDeal("Ganho", "a", { estimated_value: 4000, status: "won" });
});

test.afterAll(async () => {
  if (companyId) await admin().from("companies").delete().eq("id", companyId);
  if (adminId) await deleteTestUser(adminId).catch(() => {});
});

async function open(page: Page, path: string) {
  await page.goto(`/${slug}/negocios?funil=${pipelineId}${path}`);
  await expect(page.getByRole("heading", { level: 1, name: "Negócios" })).toBeVisible();
}

const money = (n: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n).replace(/\s/g, " ");
const col = (page: Page, key: string) => page.locator(`[data-testid="forecast-column"][data-bucket="${key}"]`);
const norm = (s: string | null) => (s ?? "").replace(/\s/g, " ");

test("lista filtra por etapa e exporta", async ({ page }) => {
  await login(page, adminEmail, password);
  await page.waitForURL((u) => !u.pathname.startsWith("/entrar"));
  await open(page, "&visao=lista");

  // Abertos é o padrão: o ganho não aparece.
  await expect(page.getByRole("link", { name: title("D1") })).toBeVisible();
  await expect(page.getByRole("link", { name: title("Ganho") })).toHaveCount(0);

  await page.goto(`/${slug}/negocios?funil=${pipelineId}&visao=lista&stage=${stage.b}`);
  await expect(page.getByRole("link", { name: title("D3") })).toBeVisible();
  await expect(page.getByRole("link", { name: title("SemData") })).toBeVisible();
  await expect(page.getByRole("link", { name: title("D1") })).toHaveCount(0);

  // Aba Ganhos (mantém os filtros; sem a etapa o ganho aparece)
  await open(page, "&visao=lista");
  await page.getByRole("link", { name: "Ganhos" }).click();
  await page.waitForURL(/status=won/);
  await expect(page.getByRole("link", { name: title("Ganho") })).toBeVisible();

  // Exportação respeita etapa e status
  const res = await page.request.get(`/${slug}/exportar/negocios?funil=${pipelineId}&stage=${stage.b}`);
  expect(res.status()).toBe(200);
  const csv = await res.text();
  expect(csv).toContain(title("D3"));
  expect(csv).toContain("Aberto");
  expect(csv).not.toContain(title("D1"));
  const won = await (await page.request.get(`/${slug}/exportar/negocios?funil=${pipelineId}&status=won`)).text();
  expect(won).toContain(title("Ganho"));
  expect(won).not.toContain(title("D3"));
});

test("forecast agrupa por mês e pondera pela probabilidade", async ({ page }) => {
  await login(page, adminEmail, password);
  await page.waitForURL((u) => !u.pathname.startsWith("/entrar"));
  await open(page, "&visao=forecast");

  await expect(col(page, monthKey(0)).getByTestId("forecast-card")).toHaveCount(1);
  const m1 = col(page, monthKey(1));
  await expect(m1.getByTestId("forecast-count")).toHaveText("1");
  await expect(col(page, monthKey(2)).getByTestId("forecast-total")).toHaveText(money(500));
  // Um mês com 1 e outro com 2 negócios: usa o mês 0 (1000) e confere o total sem ponderar
  expect(norm(await col(page, monthKey(0)).getByTestId("forecast-total").textContent())).toBe(money(1000));
  expect(norm(await m1.getByTestId("forecast-total").textContent())).toBe(money(2000));
  await expect(page.getByTestId("forecast-weighted")).toHaveCount(0);

  // Sem os negócios fora da janela
  await expect(page.getByText(title("Longe"))).toHaveCount(0);
  await expect(page.getByText(title("Ganho"))).toHaveCount(0);
  await expect(page.getByText(/não aparecem aqui/)).toBeVisible();

  await page.getByRole("switch", { name: "Ponderar pela probabilidade" }).click();
  await page.waitForURL(/ponderado=1/);
  expect(norm(await col(page, monthKey(0)).getByTestId("forecast-weighted").textContent())).toBe(money(500));
  expect(norm(await m1.getByTestId("forecast-weighted").textContent())).toBe(money(1000));
  expect(norm(await col(page, monthKey(2)).getByTestId("forecast-weighted").textContent())).toBe(money(100));
  // totais continuam visíveis
  expect(norm(await m1.getByTestId("forecast-total").textContent())).toBe(money(2000));
});

test("negócio sem data aparece em Sem data e atrasado em Atrasados", async ({ page }) => {
  await login(page, adminEmail, password);
  await page.waitForURL((u) => !u.pathname.startsWith("/entrar"));
  await open(page, "&visao=forecast");
  await expect(col(page, "none").getByText(title("SemData"))).toBeVisible();
  await expect(col(page, "overdue").getByText(title("Atrasado"))).toBeVisible();
  await expect(col(page, "overdue").getByTestId("forecast-count")).toHaveText("1");
  await expect(col(page, monthKey(0)).getByText(title("Atrasado"))).toHaveCount(0);
});

test("Todas as empresas abre a lista e pede a empresa para Kanban/Forecast", async ({ page }) => {
  await login(page, adminEmail, password);
  await page.waitForURL((u) => !u.pathname.startsWith("/entrar"));
  await page.goto(`/todas/negocios?q=${stamp}`);
  await expect(page.getByRole("link", { name: title("D1") })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Empresa" })).toBeVisible();
  await page.getByRole("radio", { name: "Forecast" }).click();
  await expect(page.getByText("Escolha a empresa")).toBeVisible();
  await page.getByRole("button", { name: `Forecast E2E ${stamp}` }).click();
  await page.waitForURL(new RegExp(`/${slug}/negocios\\?visao=forecast`));
});
