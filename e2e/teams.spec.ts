import { expect, test } from "@playwright/test";
import { admin, createTestUser, deleteTestUser, login } from "./helpers/auth";

const stamp = Date.now();
const teamName = `Time SDR ${stamp}`;
const otherName = `Time Duplicado ${stamp}`;
const emailA = `tst-e2e-eq-a-${stamp}@oxyn.test`;
const emailB = `tst-e2e-eq-b-${stamp}@oxyn.test`;
const nameA = `Tst Equipe A ${stamp}`;
const nameB = `Tst Equipe B ${stamp}`;
const inactiveName = `Time Inativo ${stamp}`;
const ids: string[] = [];

async function cleanup() {
  await admin().from("teams").delete().in("name", [teamName, otherName, inactiveName]);
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

test("salvar equipe preserva membro inativo", async ({ page }) => {
  const a = admin();
  const team = await a.from("teams").insert({ name: inactiveName }).select("id").single();
  if (team.error) throw team.error;
  const r = await a.from("team_members").insert([
    { team_id: team.data.id, user_id: ids[0] },
    { team_id: team.data.id, user_id: ids[1] },
  ]);
  if (r.error) throw r.error;
  const u = await a.from("profiles").update({ active: false }).eq("id", ids[1]);
  if (u.error) throw u.error;

  await page.goto("/configuracoes/equipes");
  const card = page.getByTestId("team-card").filter({ hasText: inactiveName });
  await expect(card.getByText("2 pessoas")).toBeVisible();
  await card.getByRole("button", { name: "Editar" }).click();
  await page.getByLabel("Buscar pessoas").fill("tst-e2e-eq-");
  const locked = page.getByRole("checkbox", { name: new RegExp(nameB) });
  await expect(locked).toBeChecked();
  await expect(locked).toBeDisabled();
  await expect(page.getByText(`${nameB} (inativo)`)).toBeVisible();
  await page.getByRole("button", { name: "Salvar" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  const { data } = await a.from("team_members").select("user_id").eq("team_id", team.data.id);
  expect((data ?? []).map((m) => m.user_id).sort()).toEqual([...ids].sort());
});
