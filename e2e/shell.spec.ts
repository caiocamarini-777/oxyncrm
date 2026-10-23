import { expect, test } from "@playwright/test";
import { admin, createTestUser, deleteTestUser, login } from "./helpers/auth";

const stamp = Date.now();
const password = "senha-teste-123";
const slug = (n: string) => `tst-e2e-${n}-${stamp}`;
const mail = (n: string) => `tst-e2e-${n}-${stamp}@oxyn.test`;

const companyIds: Record<string, string> = {};
const userIds: string[] = [];
const users = {
  none: mail("semempresa"),
  one: mail("uma"),
  two: mail("duas"),
  admin: mail("admin"),
};

test.beforeAll(async () => {
  const a = admin();
  const mk = async (key: string, name: string, archived = false) => {
    const { data, error } = await a
      .from("companies")
      .insert({ name, slug: slug(key), archived_at: archived ? new Date().toISOString() : null })
      .select("id")
      .single();
    if (error) throw error;
    companyIds[key] = data.id;
  };
  await mk("volt", "Volt E2E");
  await mk("naia", "Naia E2E");
  await mk("arq", "Arquivada E2E", true);

  const { data: role, error: re } = await a
    .from("roles")
    .select("id")
    .eq("name", "Usuário padrão")
    .single();
  if (re) throw re;

  const mkUser = async (email: string, name: string, companies: string[], superAdmin = false) => {
    const id = await createTestUser({ email, password, fullName: name, superAdmin });
    userIds.push(id);
    for (const c of companies) {
      const { error } = await a
        .from("memberships")
        .insert({ user_id: id, company_id: companyIds[c], role_id: role.id });
      if (error) throw error;
    }
  };
  await mkUser(users.none, "Sem Empresa", []);
  await mkUser(users.one, "Maria Uma", ["volt"]);
  await mkUser(users.two, "João Duas", ["volt", "naia"]);
  await mkUser(users.admin, "Ada Admin", [], true);
});

test.afterAll(async () => {
  for (const id of userIds) await deleteTestUser(id);
  await admin().from("companies").delete().in("id", Object.values(companyIds));
});

test("usuário sem empresa vê tela de sem acesso", async ({ page }) => {
  await login(page, users.none, password);
  await expect(page).toHaveURL(/sem-acesso/);
  await expect(page.getByText("Você ainda não tem acesso a nenhuma empresa")).toBeVisible();
  await expect(page.getByText("Peça ao administrador para liberar seu acesso.")).toBeVisible();
});

test("usuário com uma empresa cai direto nela", async ({ page }) => {
  await login(page, users.one, password);
  await expect(page).toHaveURL(new RegExp(`/${slug("volt")}/inicio$`));
  await expect(page.getByRole("heading", { name: "Volt E2E" })).toBeVisible();
  await expect(page.getByText("Olá, Maria")).toBeVisible();
  await page.getByRole("button", { name: "Trocar de empresa" }).click();
  await expect(page.getByRole("menuitem", { name: "Volt E2E" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Todas as empresas" })).toHaveCount(0);
});

test("empresa sem acesso, arquivada ou inexistente dá 404 igual", async ({ page }) => {
  await login(page, users.one, password);
  await expect(page).toHaveURL(/inicio/);
  const bodies: string[] = [];
  for (const target of [slug("naia"), slug("arq"), "nao-existe-xyz"]) {
    const res = await page.goto(`/${target}/inicio`);
    expect(res?.status()).toBe(404);
    await expect(page.getByText("This page could not be found.")).toBeVisible();
    bodies.push((await page.locator("body").innerText()).trim());
  }
  expect(new Set(bodies).size).toBe(1);
});

test("trocar empresa mantém a seção", async ({ page }) => {
  await login(page, users.two, password);
  await expect(page).toHaveURL(/inicio/);
  await page.goto(`/${slug("volt")}/inicio`);
  await page.getByRole("button", { name: "Trocar de empresa" }).click();
  await expect(page.getByRole("menuitem", { name: "Todas as empresas" })).toBeVisible();
  await page.getByRole("menuitem", { name: "Naia E2E" }).click();
  await expect(page).toHaveURL(new RegExp(`/${slug("naia")}/inicio$`));
  await expect(page.getByRole("heading", { name: "Naia E2E" })).toBeVisible();
});

test("itens de fases futuras ficam desabilitados", async ({ page }) => {
  await login(page, users.one, password);
  await expect(page).toHaveURL(/inicio/);
  await expect(page.getByRole("link", { name: "Atividades" })).toBeVisible();
  await expect(page.getByRole("link", { name: "E-mail" })).toHaveCount(0);
  await page.getByRole("navigation", { name: "Principal" }).getByLabel("E-mail").hover();
  await expect(page.getByRole("tooltip", { name: "Disponível em breve" })).toBeVisible();
});

test("Configurações só aparece para admin geral", async ({ page }) => {
  await login(page, users.one, password);
  await expect(page).toHaveURL(/inicio/);
  await expect(page.getByLabel("Configurações")).toHaveCount(0);
  await page.context().clearCookies();
  await login(page, users.two, password);
  await expect(page).toHaveURL(/inicio/);
  await expect(page.getByLabel("Configurações")).toHaveCount(0);
});

test("admin geral vê Configurações e Todas as empresas", async ({ page }) => {
  await login(page, users.admin, password);
  await expect(page).toHaveURL(/inicio/);
  await expect(page.getByRole("link", { name: "Configurações" })).toHaveAttribute(
    "href",
    "/configuracoes/empresas",
  );
  await page.getByRole("button", { name: "Trocar de empresa" }).click();
  await expect(page.getByRole("menuitem", { name: "Todas as empresas" })).toBeVisible();
});

test("rotas fora de [empresa] também ficam dentro do shell", async ({ page }) => {
  await login(page, users.admin, password);
  await expect(page).toHaveURL(/inicio/);
  await page.goto("/perfil");
  await expect(page.getByRole("heading", { name: "Perfil" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Principal" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Configurações" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Trocar de empresa" })).toBeVisible();
});

test("sair pelo menu do usuário", async ({ page }) => {
  await login(page, users.one, password);
  await expect(page).toHaveURL(/inicio/);
  await page.getByRole("button", { name: "Menu do usuário" }).click();
  await page.getByRole("menuitem", { name: "Sair" }).click();
  await expect(page).toHaveURL(/entrar/);
});
