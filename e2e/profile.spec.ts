import { expect, test } from "@playwright/test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { admin, createTestUser, deleteTestUser, login } from "./helpers/auth";

const stamp = Date.now();
const email = `tst-e2e-perfil-${stamp}@oxyn.test`;
const password = "senha-teste-123";
let userId = "";

test.beforeAll(async () => {
  userId = await createTestUser({ email, password, fullName: "Perfil Teste", superAdmin: true });
});

test.afterAll(async () => {
  const a = admin();
  const { data } = await a.storage.from("avatars").list(userId);
  if (data?.length) await a.storage.from("avatars").remove(data.map((f) => `${userId}/${f.name}`));
  await deleteTestUser(userId);
});

test.describe.configure({ mode: "serial" });

test("altera o nome e ele aparece no menu", async ({ page }) => {
  await login(page, email, password);
  await expect(page.getByRole("button", { name: "Menu do usuário" })).toBeVisible();
  await page.goto("/perfil");
  await page.getByLabel("Nome", { exact: true }).fill("Nome Novo E2E");
  await page.getByRole("button", { name: "Salvar dados" }).click();
  await expect(page.getByText("Dados salvos.")).toBeVisible();
  await page.getByRole("button", { name: "Menu do usuário" }).click();
  await expect(page.getByRole("menu").getByText("Nome Novo E2E")).toBeVisible();
});

test("troca a foto", async ({ page }) => {
  await login(page, email, password);
  await expect(page.getByRole("button", { name: "Menu do usuário" })).toBeVisible();
  await page.goto("/perfil");
  await page.getByTestId("avatar-input").setInputFiles("e2e/fixtures/avatar.png");
  await expect(page.getByText("Foto atualizada.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Menu do usuário" }).locator("img")).toHaveAttribute(
    "src",
    new RegExp(`/storage/v1/object/public/avatars/${userId}/`),
  );
});

test("arquivo grande é recusado", async ({ page }) => {
  const dir = mkdtempSync(path.join(tmpdir(), "oxyn-avatar-"));
  const big = path.join(dir, "grande.png");
  writeFileSync(big, Buffer.alloc(3 * 1024 * 1024, 1));
  await login(page, email, password);
  await expect(page.getByRole("button", { name: "Menu do usuário" })).toBeVisible();
  await page.goto("/perfil");
  await page.getByTestId("avatar-input").setInputFiles(big);
  await expect(page.getByText("Envie uma imagem PNG, JPG ou WebP de até 2 MB.")).toBeVisible();
});

test("troca a senha", async ({ page }) => {
  await login(page, email, password);
  await expect(page.getByRole("button", { name: "Menu do usuário" })).toBeVisible();
  await page.goto("/perfil");
  await page.getByLabel("Nova senha").fill("curta");
  await page.getByLabel("Confirmar senha").fill("curta");
  await page.getByRole("button", { name: "Alterar senha" }).click();
  await expect(page.getByText("A senha precisa ter pelo menos 8 caracteres.")).toBeVisible();
  await page.getByLabel("Nova senha").fill("nova-senha-456");
  await page.getByLabel("Confirmar senha").fill("outra-senha-456");
  await page.getByRole("button", { name: "Alterar senha" }).click();
  await expect(page.getByText("As senhas não conferem.")).toBeVisible();
  await page.getByLabel("Confirmar senha").fill("nova-senha-456");
  await page.getByRole("button", { name: "Alterar senha" }).click();
  await expect(page.getByText("Senha alterada.")).toBeVisible();

  await page.getByRole("button", { name: "Menu do usuário" }).click();
  await page.getByRole("menuitem", { name: "Sair" }).click();
  await page.waitForURL(/\/entrar/);
  await login(page, email, "nova-senha-456");
  await expect(page.getByRole("button", { name: "Menu do usuário" })).toBeVisible();
});
