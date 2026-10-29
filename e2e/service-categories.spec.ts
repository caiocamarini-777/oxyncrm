import { expect, test } from "@playwright/test";
import { admin, createTestUser, deleteTestUser, login } from "./helpers/auth";

const stamp = Date.now();
const password = "oxyn-test-123";
const slug = `tst-e2e-sc-${stamp}`;
const adminEmail = `tst-e2e-sc-admin-${stamp}@oxyn.test`;
const CATEGORY = "Serviço SEO/GEO";
const PRODUCT = `Produto SEO ${stamp}`;

let companyId = "";
let adminId = "";
let dealId = "";

test.describe.configure({ mode: "serial" });

async function insert(table: string, row: Record<string, unknown>): Promise<string> {
  const r = await admin().from(table).insert(row).select("id").single();
  if (r.error) throw r.error;
  return r.data.id as string;
}

test.beforeAll(async () => {
  adminId = await createTestUser({ email: adminEmail, password, fullName: "Ada Categorias", superAdmin: true });
  companyId = await insert("companies", { name: `Categorias E2E ${stamp}`, slug });
  const a = admin();
  const p = await a.from("pipelines").select("id").eq("company_id", companyId).single();
  if (p.error) throw p.error;
  const s = await a.from("stages").select("id").eq("pipeline_id", p.data.id).order("position").limit(1).single();
  if (s.error) throw s.error;
  dealId = await insert("deals", {
    company_id: companyId,
    owner_id: adminId,
    pipeline_id: p.data.id,
    stage_id: s.data.id,
    title: `Negócio categorias ${stamp}`,
  });
});

test.afterAll(async () => {
  const a = admin();
  if (companyId) {
    // A categoria é protegida (restrict) enquanto produtos e itens a usam: limpa de dentro para fora.
    await a.from("deal_items").delete().eq("company_id", companyId);
    await a.from("deals").delete().eq("company_id", companyId);
    await a.from("products").delete().eq("company_id", companyId);
    await a.from("service_categories").delete().eq("company_id", companyId);
    await a.from("companies").delete().eq("id", companyId);
  }
  if (adminId) await deleteTestUser(adminId).catch(() => {});
});

test.beforeEach(async ({ page }) => {
  await login(page, adminEmail, password);
  await page.waitForURL((u) => !u.pathname.startsWith("/entrar"));
});

test("cria categoria, usa no produto e no item do negócio, e recusa nome repetido", async ({ page }) => {
  await page.goto(`/configuracoes/categorias-servico?empresa=${slug}`);
  await page.waitForLoadState("networkidle"); // hidratação antes de digitar
  await page.getByLabel("Nova categoria").fill(CATEGORY);
  await page.getByLabel("Nova categoria").press("Enter");
  await expect(page.getByTestId("category-row").filter({ has: page.getByLabel(`Nome de ${CATEGORY}`) })).toBeVisible();

  // Nome repetido (sem diferenciar maiúsculas) é recusado.
  await page.getByLabel("Nova categoria").fill(CATEGORY.toLowerCase());
  await page.getByRole("button", { name: "Adicionar categoria" }).click();
  await expect(page.getByText("Já existe uma categoria com esse nome.")).toBeVisible();

  // Produto com a categoria.
  await page.goto(`/configuracoes/produtos?empresa=${slug}`);
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Novo produto").fill(PRODUCT);
  await page.getByLabel("Tipo").selectOption("setup");
  await page.getByLabel("Preço padrão").fill("1000");
  await page.getByLabel("Categoria de serviço").selectOption({ label: CATEGORY });
  await page.getByRole("button", { name: "Adicionar produto" }).click();
  const row = page.getByTestId("product-row").filter({ hasText: PRODUCT });
  await expect(row).toContainText(CATEGORY);

  // Negócio: o item herda a categoria do produto.
  await page.goto(`/${slug}/negocios/${dealId}`);
  await page.getByRole("button", { name: "Adicionar produto" }).click();
  const dlg = page.getByRole("dialog");
  await dlg.getByLabel("Produto", { exact: true }).selectOption({ label: `${PRODUCT} (Setup)` });
  await expect(dlg.getByLabel("Categoria de serviço")).toHaveValue(/.+/);
  await dlg.getByLabel("Mês da 1ª parcela").fill("2026-05");
  await dlg.getByRole("button", { name: "Adicionar", exact: true }).click();
  await expect(page.getByTestId("item-row")).toHaveCount(1);
  await expect(page.getByTestId("item-category")).toHaveText(CATEGORY);
});
