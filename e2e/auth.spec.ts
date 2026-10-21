import { expect, test } from "@playwright/test";
import { createTestUser, deleteTestUser, login } from "./helpers/auth";
import { getLatestLink } from "./helpers/outbox";

const stamp = Date.now();
const email = `tst-e2e-${stamp}@oxyn.test`;
let password = "senha-teste-123";
let userId: string;

test.beforeAll(async () => {
  userId = await createTestUser({ email, password, fullName: "Teste E2E" });
});
test.afterAll(async () => {
  await deleteTestUser(userId);
});

test("login com credenciais válidas leva para a área logada", async ({ page }) => {
  await login(page, email, password);
  await expect(page).not.toHaveURL(/entrar/);
});

test("senha errada mostra mensagem", async ({ page }) => {
  await login(page, email, "errada-errada");
  await expect(page.getByText("E-mail ou senha incorretos.")).toBeVisible();
});

test("rota protegida sem sessão redireciona com next", async ({ page }) => {
  await page.goto("/configuracoes/empresas");
  await expect(page).toHaveURL(/\/entrar\?next=%2Fconfiguracoes%2Fempresas/);
});

test("recuperação de senha pelo e-mail", async ({ page }) => {
  await page.goto("/recuperar-senha");
  await page.getByLabel("E-mail").fill(email);
  await page.getByRole("button", { name: "Enviar link" }).click();
  await expect(
    page.getByText("Se o e-mail estiver cadastrado, você vai receber um link."),
  ).toBeVisible();
  const link = await getLatestLink(email);
  await page.goto(link);
  await expect(page).toHaveURL(/definir-senha/);
  await page.getByLabel("Nova senha").fill("nova-senha-123");
  await page.getByLabel("Confirmar senha").fill("nova-senha-123");
  await page.getByRole("button", { name: "Salvar senha" }).click();
  password = "nova-senha-123";
  await expect(page).not.toHaveURL(/definir-senha/);
  await page.getByRole("button", { name: "Sair" }).click();
  await expect(page).toHaveURL(/entrar/);
  await login(page, email, password);
  await expect(page).not.toHaveURL(/entrar/);
});

test("sair encerra a sessão", async ({ page }) => {
  await login(page, email, password);
  await expect(page).not.toHaveURL(/entrar/);
  await page.getByRole("button", { name: "Sair" }).click();
  await expect(page).toHaveURL(/entrar/);
  await page.goto("/");
  await expect(page).toHaveURL(/entrar/);
});

test("e-mail desconhecido recebe a mesma mensagem neutra", async ({ page }) => {
  await page.goto("/recuperar-senha");
  await page.getByLabel("E-mail").fill(`tst-nao-existe-${stamp}@oxyn.test`);
  await page.getByRole("button", { name: "Enviar link" }).click();
  await expect(
    page.getByText("Se o e-mail estiver cadastrado, você vai receber um link."),
  ).toBeVisible();
});
