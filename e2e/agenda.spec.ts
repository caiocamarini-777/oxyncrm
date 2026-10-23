import { expect, test, type Page } from "@playwright/test";
import { admin, createTestUser, deleteTestUser, login } from "./helpers/auth";
import { toUtc } from "../src/lib/activities/time";

const stamp = Date.now();
const password = "oxyn-test-123";
const slug = `tst-e2e-ag-${stamp}`;
const email = `tst-e2e-ag-${stamp}@oxyn.test`;

let userId = "";
let companyId = "";
let personId = "";
let typeTask = "";
let channel = "";

test.describe.configure({ mode: "serial" });
test.setTimeout(60_000);

async function insert(subject: string, local: string) {
  const r = await admin().from("activities").insert({
    company_id: companyId,
    owner_id: userId,
    type_id: typeTask,
    channel_id: channel,
    person_id: personId,
    subject,
    due_at: toUtc(local),
  });
  if (r.error) throw r.error;
}

async function go(page: Page, path: string) {
  await login(page, email, password);
  await page.waitForURL((u) => !u.pathname.startsWith("/entrar"));
  await page.goto(`/${slug}/atividades${path}`);
  await expect(page.getByRole("heading", { name: "Atividades", exact: true })).toBeVisible();
}

test.beforeAll(async () => {
  userId = await createTestUser({ email, password, fullName: "Ada Agenda", superAdmin: true });
  const a = admin();
  const c = await a.from("companies").insert({ name: `Agenda E2E ${stamp}`, slug }).select("id").single();
  if (c.error) throw c.error;
  companyId = c.data.id;
  const [types, channels] = await Promise.all([
    a.from("activity_types").select("id, name").eq("company_id", companyId),
    a.from("activity_channels").select("id, name").eq("company_id", companyId),
  ]);
  if (types.error) throw types.error;
  if (channels.error) throw channels.error;
  typeTask = types.data.find((t) => t.name === "Tarefa")!.id;
  channel = channels.data.find((x) => x.name === "LinkedIn")!.id;
  const p = await a.from("persons").insert({ company_id: companyId, owner_id: userId, full_name: `Pessoa AG ${stamp}` }).select("id").single();
  if (p.error) throw p.error;
  personId = p.data.id;
  await insert(`Noite ${stamp}`, "2031-03-12T23:30");
  await insert(`Semana seguinte ${stamp}`, "2031-03-19T10:00");
  for (const n of [1, 2, 3, 4]) await insert(`Dia cheio ${n} ${stamp}`, `2031-03-25T0${n + 4}:00`);
});

test.afterAll(async () => {
  if (companyId) {
    const del = await admin().from("companies").delete().eq("id", companyId);
    if (del.error) console.error("limpeza da empresa:", del.error.message);
  }
  if (userId) await deleteTestUser(userId).catch(() => {});
});

test("semana mostra a atividade das 23h30 no dia certo e navega", async ({ page }) => {
  await go(page, "?visao=semana&data=2031-03-12");
  const day = page.locator('[data-testid="agenda-day"][data-day="2031-03-12"]');
  await expect(day.getByText(`Noite ${stamp}`)).toBeVisible();
  await expect(day.getByText("23:30")).toBeVisible();
  await expect(page.locator('[data-testid="agenda-day"][data-day="2031-03-13"]').getByText(`Noite ${stamp}`)).toHaveCount(0);

  await page.getByRole("link", { name: "Próxima" }).click();
  await expect(page).toHaveURL(/data=2031-03-19/);
  await expect(page.getByText(`Semana seguinte ${stamp}`)).toBeVisible();
  await page.getByRole("link", { name: "Anterior" }).click();
  await expect(page.getByText(`Noite ${stamp}`)).toBeVisible();
  await page.getByRole("link", { name: "Hoje" }).click();
  await expect(page).not.toHaveURL(/data=/);
});

test("mês limita a 3 por dia, mostra +N e navega", async ({ page }) => {
  await go(page, "?visao=mes&data=2031-03-10");
  await expect(page.getByTestId("agenda-title")).toContainText("março de 2031");
  const day = page.locator('[data-testid="agenda-day"][data-day="2031-03-25"]');
  await expect(day.getByTestId("agenda-item")).toHaveCount(3);
  await day.getByRole("link", { name: /Ver as 4 atividades/ }).click();
  await expect(page).toHaveURL(/visao=semana/);
  await expect(page.getByText(`Dia cheio 4 ${stamp}`)).toBeVisible();

  await page.goto(`/${slug}/atividades?visao=mes&data=2031-03-10`);
  await page.getByRole("link", { name: "Próxima" }).click();
  await expect(page.getByTestId("agenda-title")).toContainText("abril de 2031");
});

test("concluir pela agenda", async ({ page }) => {
  await go(page, "?visao=semana&data=2031-03-12");
  await page.getByTestId("agenda-item").filter({ hasText: `Noite ${stamp}` }).click();
  const popover = page.getByTestId("agenda-popover");
  await expect(popover).toBeVisible();
  await popover.getByRole("button", { name: "Concluir" }).click();
  await page.getByRole("radio", { name: "Sem resposta" }).click();
  await page.getByRole("button", { name: "Concluir", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const item = page.getByTestId("agenda-item").filter({ hasText: `Noite ${stamp}` });
  await expect(item).toHaveAttribute("data-status", "done");
});

test("data absurda cai em hoje em vez de erro", async ({ page }) => {
  await go(page, "?visao=semana&data=9999-12-31");
  await expect(page.getByTestId("agenda-week")).toBeVisible();
  await page.goto(`/${slug}/atividades?visao=mes&data=0001-01-01`);
  await expect(page.getByTestId("agenda-month")).toBeVisible();
});
