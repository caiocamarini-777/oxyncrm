import { expect, test } from "@playwright/test";
import { admin, login } from "./helpers/auth";

const stamp = Date.now();
const archSlug = `tst-e2e-arq-${stamp}`;
let archId = "";

async function cleanup() {
  const a = admin();
  await a.from("companies").delete().eq("slug", "harpix-industria");
  await a.from("companies").delete().eq("slug", archSlug);
}

test.beforeAll(async () => {
  await cleanup();
  const { data, error } = await admin()
    .from("companies")
    .insert({ name: `Arquivar E2E ${stamp}`, slug: archSlug })
    .select("id")
    .single();
  if (error) throw error;
  archId = data.id;
});
test.afterAll(cleanup);

test.beforeEach(async ({ page }) => {
  await login(page, "admin@oxyn.test", "oxyn-dev-123");
  await page.waitForURL((u) => !u.pathname.startsWith("/entrar"));
});

test("cria empresa com slug automático", async ({ page }) => {
  await page.goto("/configuracoes/empresas");
  await page.getByRole("button", { name: "Nova empresa" }).click();
  await page.getByLabel("Nome").fill("Harpix Indústria");
  await expect(page.getByLabel("Endereço (slug)")).toHaveValue("harpix-industria");
  await page.getByRole("button", { name: "Salvar" }).click();
  await expect(page.getByTestId("company-harpix-industria")).toBeVisible();
  await page.getByRole("button", { name: "Trocar de empresa" }).click();
  await expect(page.getByRole("menuitem", { name: "Harpix Indústria" })).toBeVisible();
});

test("CNPJ inválido mostra erro no campo", async ({ page }) => {
  await page.goto("/configuracoes/empresas?novo=1");
  await page.getByLabel("Nome").fill("Cnpj Ruim");
  await page.getByLabel("CNPJ").fill("11222333000182");
  await page.getByRole("button", { name: "Salvar" }).click();
  await expect(page.getByText("CNPJ inválido.")).toBeVisible();
});

test("slug duplicado mostra erro no campo", async ({ page }) => {
  await page.goto("/configuracoes/empresas?novo=1");
  await page.getByLabel("Nome").fill("Outra Volt");
  await page.getByLabel("Endereço (slug)").fill("volt");
  await page.getByRole("button", { name: "Salvar" }).click();
  await expect(page.getByText("Este endereço já está em uso.")).toBeVisible();
});

test("arquivar esconde a empresa do seletor", async ({ page }) => {
  const name = `Arquivar E2E ${stamp}`;
  await page.goto("/configuracoes/empresas");
  await page.getByRole("button", { name: "Trocar de empresa" }).click();
  await expect(page.getByRole("menuitem", { name })).toBeVisible();
  await page.keyboard.press("Escape");

  await page.getByTestId(`company-${archSlug}`).getByRole("button", { name: "Arquivar" }).click();
  await expect(page.getByText(`Arquivar ${name}?`)).toBeVisible();
  await expect(
    page.getByText("A empresa some do seletor e ninguém consegue abrir suas páginas. Você pode reativá-la aqui depois."),
  ).toBeVisible();
  await page.getByRole("alertdialog").getByRole("button", { name: "Arquivar" }).click();
  await expect(page.getByTestId(`company-${archSlug}`).getByText("Arquivada")).toBeVisible();

  await page.getByRole("button", { name: "Trocar de empresa" }).click();
  await expect(page.getByRole("menuitem", { name })).toHaveCount(0);
  expect(archId).not.toBe("");
});
