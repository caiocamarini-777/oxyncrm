import { expect, test, type Page } from "@playwright/test";
import { admin, createTestUser, deleteTestUser, login } from "./helpers/auth";
import { dayKey, startOfNextDayUtc } from "../src/lib/activities/time";

const stamp = Date.now();
const password = "oxyn-test-123";
const slug = `tst-e2e-at-${stamp}`;
const adminEmail = `tst-e2e-at-a-${stamp}@oxyn.test`;
const biaEmail = `tst-e2e-at-b-${stamp}@oxyn.test`;
const personName = `Pessoa AT ${stamp}`;

let adminId = "";
let biaId = "";
let companyId = "";
let personId = "";
let typeTask = "";
let chLinkedin = "";
let chOther = "";
let chOtherName = "";

test.describe.configure({ mode: "serial" });
test.setTimeout(60_000);

const hours = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();

async function insert(row: Record<string, unknown>) {
  const r = await admin()
    .from("activities")
    .insert({ company_id: companyId, owner_id: adminId, type_id: typeTask, channel_id: chLinkedin, person_id: personId, ...row });
  if (r.error) throw r.error;
}

async function go(page: Page, email: string, path: string) {
  await login(page, email, password);
  await page.waitForURL((u) => !u.pathname.startsWith("/entrar"));
  await page.goto(`/${slug}/atividades${path}`);
  await expect(page.getByRole("heading", { name: "Atividades", exact: true })).toBeVisible();
}

test.beforeAll(async () => {
  adminId = await createTestUser({ email: adminEmail, password, fullName: "Ada Lista", superAdmin: true });
  biaId = await createTestUser({ email: biaEmail, password, fullName: "Bia Lista" });
  const a = admin();
  const c = await a.from("companies").insert({ name: `Lista E2E ${stamp}`, slug }).select("id").single();
  if (c.error) throw c.error;
  companyId = c.data.id;
  const role = await a.from("roles").select("id").eq("name", "Usuário padrão").single();
  if (role.error) throw role.error;
  const m = await a.from("memberships").insert({ user_id: biaId, company_id: companyId, role_id: role.data.id });
  if (m.error) throw m.error;
  const [types, channels] = await Promise.all([
    a.from("activity_types").select("id, name").eq("company_id", companyId),
    a.from("activity_channels").select("id, name, is_legacy").eq("company_id", companyId),
  ]);
  if (types.error) throw types.error;
  if (channels.error) throw channels.error;
  typeTask = types.data.find((t) => t.name === "Tarefa")!.id;
  chLinkedin = channels.data.find((x) => x.name === "LinkedIn")!.id;
  const other = channels.data.find((x) => x.name !== "LinkedIn" && !x.is_legacy)!;
  chOther = other.id;
  chOtherName = other.name;
  const p = await a.from("persons").insert({ company_id: companyId, owner_id: adminId, full_name: personName }).select("id").single();
  if (p.error) throw p.error;
  personId = p.data.id;

  const endOfToday = new Date(new Date(startOfNextDayUtc(dayKey(new Date()))).getTime() - 60_000).toISOString();
  await insert({ subject: `Atrasada ${stamp}`, due_at: hours(-30) });
  await insert({ subject: `Hoje ${stamp}`, due_at: endOfToday });
  await insert({ subject: `Proxima ${stamp}`, due_at: hours(72), channel_id: chOther });
  await insert({ subject: `Da Bia ${stamp}`, due_at: hours(-5), owner_id: biaId, channel_id: chOther });
});

test.afterAll(async () => {
  if (companyId) {
    const del = await admin().from("companies").delete().eq("id", companyId);
    if (del.error) console.error("limpeza da empresa:", del.error.message);
  }
  for (const id of [adminId, biaId]) if (id) await deleteTestUser(id).catch(() => {});
});

test("abas trazem as atividades certas e o contador de atrasadas", async ({ page }) => {
  await go(page, adminEmail, "");
  await expect(page.getByText(`Hoje ${stamp}`, { exact: true })).toBeVisible();
  await expect(page.getByText(`Atrasada ${stamp}`)).toHaveCount(0);
  await expect(page.getByTestId("overdue-count")).toHaveText(/2/);

  await page.getByRole("link", { name: /Atrasadas/ }).click();
  await expect(page).toHaveURL(/aba=atrasadas/);
  await expect(page.getByText(`Atrasada ${stamp}`)).toBeVisible();
  await expect(page.getByText(`Da Bia ${stamp}`)).toBeVisible();
  await expect(page.getByText(`Hoje ${stamp}`, { exact: true })).toHaveCount(0);

  await page.getByRole("link", { name: "Próximas" }).click();
  await expect(page.getByText(`Proxima ${stamp}`)).toBeVisible();
  await page.getByRole("link", { name: "Concluídas" }).click();
  await expect(page.getByTestId("activities-empty")).toBeVisible();
});

test("filtro por canal", async ({ page }) => {
  await go(page, adminEmail, "?aba=atrasadas");
  await page.getByRole("button", { name: "Canal" }).click();
  await page.getByRole("menuitemcheckbox", { name: chOtherName }).click();
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/channel=/);
  await expect(page.getByText(`Da Bia ${stamp}`)).toBeVisible();
  await expect(page.getByText(`Atrasada ${stamp}`)).toHaveCount(0);
});

test("concluir pela lista move para Concluídas", async ({ page }) => {
  await go(page, adminEmail, "?aba=atrasadas");
  await page.getByRole("button", { name: `Concluir Atrasada ${stamp}` }).click();
  await page.getByRole("radio", { name: "Sem resposta" }).click();
  await page.getByRole("button", { name: "Concluir", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByText(`Atrasada ${stamp}`)).toHaveCount(0);
  await page.getByRole("link", { name: "Concluídas" }).click();
  await expect(page.getByText(`Atrasada ${stamp}`)).toBeVisible();
});

test("nova atividade exige vínculo", async ({ page }) => {
  await go(page, adminEmail, "?aba=proximas");
  await page.getByRole("button", { name: "Nova atividade" }).click();
  const dialog = page.getByRole("dialog");
  const subject = `Nova ${stamp}`;
  await dialog.getByLabel("Assunto").fill(subject);
  await dialog.getByLabel("Canal").selectOption({ label: "LinkedIn" });
  await dialog.getByLabel("Data e hora").fill("2031-05-05T10:00");
  await dialog.getByRole("button", { name: "Salvar atividade" }).click();
  await expect(dialog.getByText("Escolha uma pessoa ou organização")).toBeVisible();
  await dialog.getByRole("combobox", { name: "Pessoa" }).fill(personName);
  await dialog.getByRole("option", { name: personName }).click();
  await dialog.getByRole("button", { name: "Salvar atividade" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByText(subject)).toBeVisible();
});

test("usuário padrão só vê as próprias", async ({ page }) => {
  await go(page, biaEmail, "?aba=atrasadas");
  await expect(page.getByText(`Da Bia ${stamp}`)).toBeVisible();
  await page.getByRole("link", { name: "Próximas" }).click();
  await expect(page.getByText(`Proxima ${stamp}`)).toHaveCount(0);
});
