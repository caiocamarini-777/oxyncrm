import { expect, test } from "@playwright/test";
import { admin, login } from "./helpers/auth";

const stamp = Date.now();
const slug = `tst-atv-${stamp}`;
const CHANNEL = `Indicação ${stamp}`;
const OUTCOME = `Talvez ${stamp}`;
let companyId = "";

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  const company = await admin().from("companies").insert({ name: `Tst Atividades ${stamp}`, slug }).select("id").single();
  if (company.error) throw company.error;
  companyId = company.data.id;
});

test.afterAll(async () => {
  if (companyId) {
    const { error } = await admin().from("companies").delete().eq("id", companyId);
    if (error) throw error;
  }
});

test.beforeEach(async ({ page }) => {
  await login(page, "admin@oxyn.test", "oxyn-dev-123");
  await page.waitForURL((u) => !u.pathname.startsWith("/entrar"));
  await page.goto(`/configuracoes/atividades?empresa=${slug}`);
});

test("cria e desativa canal; o canal legado só mostra o selo", async ({ page }) => {
  await page.getByLabel("Novo canal").fill(CHANNEL);
  await page.getByRole("button", { name: "Adicionar" }).nth(1).click();
  const row = page.getByTestId("channel-row").filter({ hasText: CHANNEL });
  await expect(row).toBeVisible();
  const read = async () => {
    const { data, error } = await admin().from("activity_channels").select("active").eq("company_id", companyId).eq("name", CHANNEL).single();
    if (error) throw error;
    return data.active;
  };
  expect(await read()).toBe(true);
  await row.getByRole("button", { name: `Desativar ${CHANNEL}` }).click();
  await expect.poll(read).toBe(false);
  await expect(row).toHaveAttribute("data-active", "false");

  const legacy = page.getByTestId("channel-row").filter({ hasText: "Não informado" });
  await expect(legacy.getByText("Importação")).toBeVisible();
  await expect(legacy.getByRole("button", { name: /Ativar/ })).toHaveCount(0);
});

test("cria resultado neutro", async ({ page }) => {
  await page.getByLabel("Novo resultado").fill(OUTCOME);
  await page.getByRole("button", { name: "Adicionar" }).nth(2).click();
  await expect(page.getByTestId("outcome-row").filter({ hasText: OUTCOME })).toBeVisible();
  const { data, error } = await admin().from("activity_outcomes").select("classification, books_meeting, active").eq("company_id", companyId).eq("name", OUTCOME).single();
  if (error) throw error;
  expect(data).toEqual({ classification: "neutral", books_meeting: false, active: true });
});

test("regra de leads Obrigar grava em companies.settings", async ({ page }) => {
  await page.getByLabel("Regra", { exact: true }).selectOption("require");
  await expect
    .poll(async () => {
      const { data, error } = await admin().from("companies").select("settings").eq("id", companyId).single();
      if (error) throw error;
      return (data.settings as Record<string, unknown>).lead_next_activity_rule;
    })
    .toBe("require");
});

test("não deixa desativar o único tipo reunião nem o único resultado que agenda", async ({ page }) => {
  await page.getByRole("button", { name: "Desativar Reunião", exact: true }).click();
  await expect(page.getByText("Mantenha ao menos um tipo de reunião ativo.")).toBeVisible();
  await page.getByRole("button", { name: "Desativar Reunião agendada", exact: true }).click();
  await expect(page.getByText("Mantenha ao menos um resultado que agenda reunião.")).toBeVisible();
});
