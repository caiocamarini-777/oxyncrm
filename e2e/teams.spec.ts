import { expect, test } from "@playwright/test";
import { admin, createTestUser, deleteTestUser, login } from "./helpers/auth";

const stamp = Date.now();
const teamName = `Time SDR ${stamp}`;
const otherName = `Time Duplicado ${stamp}`;
const emailA = `tst-e2e-eq-a-${stamp}@oxyn.test`;
const emailB = `tst-e2e-eq-b-${stamp}@oxyn.test`;
const nameA = `Tst Equipe A ${stamp}`;
const nameB = `Tst Equipe B ${stamp}`;
const ids: string[] = [];

async function cleanup() {
  await admin().from("teams").delete().in("name", [teamName, otherName]);
  for (const id of ids) await deleteTestUser(id).catch(() => {});
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  ids.push(await createTestUser({ email: emailA, password: "oxyn-test-123", fullName: nameA }));
  ids.push(await createTestUser({ email: emailB, password: "oxyn-test-123", fullName: nameB }));
});
test.afterAll(cleanup);

test.beforeEach(async ({ page }) => {
  await login(page, "admin@oxyn.test", "oxyn-dev-123");
  await page.waitForURL((u) => !u.pathname.startsWith("/entrar"));
});

test("cria equipe e adiciona membros", async ({ page }) => {
  await page.goto("/configuracoes/equipes");
  await page.getByRole("button", { name: "Nova equipe" }).click();
  await page.getByLabel("Nome da equipe").fill(teamName);
  await page.getByLabel("Buscar pessoas").fill(`tst-e2e-eq-`);
  await page.getByRole("checkbox", { name: new RegExp(nameA) }).check();
  await page.getByRole("checkbox", { name: new RegExp(nameB) }).check();
  await page.getByRole("button", { name: "Salvar" }).click();
  const card = page.getByTestId("team-card").filter({ hasText: teamName });
  await expect(card.getByText("2 pessoas")).toBeVisible();
});

test("remover membro atualiza a contagem", async ({ page }) => {
  await page.goto("/configuracoes/equipes");
  const card = page.getByTestId("team-card").filter({ hasText: teamName });
  await card.getByRole("button", { name: "Editar" }).click();
  await page.getByLabel("Buscar pessoas").fill(`tst-e2e-eq-`);
  await page.getByRole("checkbox", { name: new RegExp(nameB) }).uncheck();
  await page.getByRole("button", { name: "Salvar" }).click();
  await expect(card.getByText("1 pessoa", { exact: true })).toBeVisible();
});

test("nome duplicado mostra erro", async ({ page }) => {
  await page.goto("/configuracoes/equipes");
  await page.getByRole("button", { name: "Nova equipe" }).click();
  await page.getByLabel("Nome da equipe").fill(otherName);
  await page.getByRole("button", { name: "Salvar" }).click();
  await expect(page.getByTestId("team-card").filter({ hasText: otherName })).toBeVisible();
  await page.getByRole("button", { name: "Nova equipe" }).click();
  await page.getByLabel("Nome da equipe").fill(otherName);
  await page.getByRole("button", { name: "Salvar" }).click();
  await expect(page.getByText("Já existe um registro com esse valor.")).toBeVisible();
});
