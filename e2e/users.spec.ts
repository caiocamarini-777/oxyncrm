import { expect, test, type Page } from "@playwright/test";
import { admin, deleteTestUser, login } from "./helpers/auth";
import { getLatestLink } from "./helpers/outbox";

const stamp = Date.now();
const password = "senha-teste-123";
const slugA = `tst-e2e-usr-a-${stamp}`;
const slugB = `tst-e2e-usr-b-${stamp}`;
const nameA = `Tst Usr A ${stamp}`;
const nameB = `Tst Usr B ${stamp}`;
const email = `tst-e2e-sdr-${stamp}@oxyn.test`;
const email2 = `tst-e2e-sdr2-${stamp}@oxyn.test`;
const personName = `Tst Pessoa ${stamp}`;
const personName2 = `Tst Pessoa Dois ${stamp}`;
const companyIds: string[] = [];

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  const a = admin();
  for (const [slug, name] of [
    [slugA, nameA],
    [slugB, nameB],
  ]) {
    const { data, error } = await a.from("companies").insert({ name, slug }).select("id").single();
    if (error) throw error;
    companyIds.push(data.id);
  }
});

test.afterAll(async () => {
  const a = admin();
  const { data } = await a.from("profiles").select("id").in("email", [email, email2]);
  for (const p of data ?? []) await deleteTestUser(p.id).catch(() => {});
  if (companyIds.length) await a.from("companies").delete().in("id", companyIds);
});

test.beforeEach(async ({ page }) => {
  await login(page, "admin@oxyn.test", "oxyn-dev-123");
  await page.waitForURL((u) => !u.pathname.startsWith("/entrar"));
});

async function invite(page: Page, opts: { name: string; email: string; company: string }) {
  await page.goto("/configuracoes/usuarios");
  await page.getByRole("button", { name: "Convidar usuário" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Nome").fill(opts.name);
  await dialog.getByLabel("E-mail").fill(opts.email);
  await dialog.getByRole("combobox", { name: "Empresa" }).click();
  await page.getByRole("option", { name: opts.company }).click();
  await dialog.getByRole("combobox", { name: "Papel" }).click();
  await page.getByRole("option", { name: "Usuário padrão" }).click();
  await dialog.getByRole("button", { name: "Enviar convite" }).click();
}

function rowOf(page: Page, n: string) {
  return page.getByTestId("user-row").filter({ hasText: n });
}

test("convite completo: usuário define senha e vê só a empresa liberada", async ({
  page,
  browser,
}) => {
  await invite(page, { name: personName, email, company: nameA });
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(rowOf(page, personName).getByText("Convite pendente")).toBeVisible();
  await expect(rowOf(page, personName).getByText(`${nameA} · Usuário padrão`)).toBeVisible();

  const link = await getLatestLink(email);
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  await p.goto(link);
  await expect(p).toHaveURL(/definir-senha/);
  await p.getByLabel("Nova senha", { exact: true }).fill(password);
  await p.getByLabel("Confirmar senha").fill(password);
  await p.getByRole("button", { name: "Salvar senha" }).click();
  await expect(p).toHaveURL(new RegExp(`/${slugA}/inicio$`));
  await p.getByRole("button", { name: "Trocar de empresa" }).click();
  await expect(p.getByRole("menuitem", { name: nameA })).toBeVisible();
  await expect(p.getByRole("menuitem", { name: /Oxyn/ })).toHaveCount(0);
  await expect(p.getByRole("menuitem", { name: nameB })).toHaveCount(0);
  const res = await p.goto(`/${slugB}/inicio`);
  expect(res?.status()).toBe(404);
  await ctx.close();

  await page.goto("/configuracoes/usuarios");
  await expect(rowOf(page, personName).getByText("Ativo", { exact: true })).toBeVisible();
});

test("e-mail já cadastrado mostra erro", async ({ page }) => {
  await invite(page, { name: "Outra Pessoa", email, company: nameA });
  await expect(page.getByText("Já existe um usuário com este e-mail.")).toBeVisible();
});

test("reenviar convite gera novo link", async ({ page, browser }) => {
  await invite(page, { name: personName2, email: email2, company: nameA });
  await expect(rowOf(page, personName2).getByText("Convite pendente")).toBeVisible();
  const first = await getLatestLink(email2);
  await rowOf(page, personName2).getByRole("button", { name: /Editar/ }).click();
  await page.getByRole("button", { name: "Reenviar convite" }).click();
  await expect(page.getByText("Convite reenviado.")).toBeVisible();
  await expect.poll(() => getLatestLink(email2)).not.toBe(first);
  const second = await getLatestLink(email2);
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  await p.goto(second);
  await expect(p).toHaveURL(/definir-senha/);
  await ctx.close();
});

test("admin não consegue se desativar", async ({ page }) => {
  await page.goto("/configuracoes/usuarios");
  await rowOf(page, "admin@oxyn.test").getByRole("button", { name: /Editar/ }).click();
  await expect(page.getByRole("button", { name: "Desativar acesso" })).toBeDisabled();
});

test("tornar e remover outro admin geral", async ({ page }) => {
  await page.goto("/configuracoes/usuarios");
  await rowOf(page, personName).getByRole("button", { name: /Editar/ }).click();
  await page.getByRole("switch", { name: "Administrador geral" }).click();
  await page.getByRole("button", { name: "Salvar" }).click();
  await expect(rowOf(page, personName).getByText("Admin geral")).toBeVisible();
  await rowOf(page, personName).getByRole("button", { name: /Editar/ }).click();
  await page.getByRole("switch", { name: "Administrador geral" }).click();
  await page.getByRole("button", { name: "Salvar" }).click();
  await expect(rowOf(page, personName).getByText("Admin geral")).toHaveCount(0);
});

test("desativar derruba a sessão aberta", async ({ page, browser }) => {
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  await login(p, email, password);
  await expect(p).toHaveURL(new RegExp(`/${slugA}/inicio$`));

  await page.goto("/configuracoes/usuarios");
  await rowOf(page, personName).getByRole("button", { name: /Editar/ }).click();
  await page.getByRole("button", { name: "Desativar acesso" }).click();
  await expect(page.getByText(`Desativar ${personName}?`)).toBeVisible();
  await expect(
    page.getByText("A pessoa perde o acesso na hora. Os registros dela continuam no sistema."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Confirmar desativação" }).click();
  await expect(rowOf(page, personName).getByText("Inativo")).toBeVisible();

  await p.reload();
  await expect(p).toHaveURL(/\/entrar\?erro=inativo/);
  await expect(p.getByText("Seu acesso foi desativado. Fale com o administrador.")).toBeVisible();
  await ctx.close();
});
