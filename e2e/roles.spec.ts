import { expect, test } from "@playwright/test";
import { admin, createTestUser, deleteTestUser, login } from "./helpers/auth";

const stamp = Date.now();
const createdName = `Líder de conta ${stamp}`;
const usedName = `Papel em uso ${stamp}`;
const companySlug = `tst-e2e-papeis-${stamp}`;
const userEmail = `tst-e2e-papeis-${stamp}@oxyn.test`;
let userId = "";
let companyId = "";

async function cleanup() {
  const a = admin();
  if (companyId) await a.from("memberships").delete().eq("company_id", companyId);
  await a.from("roles").delete().in("name", [createdName, usedName]);
  await a.from("companies").delete().eq("slug", companySlug);
  if (userId) await deleteTestUser(userId).catch(() => {});
}

test.beforeAll(async () => {
  const a = admin();
  userId = await createTestUser({ email: userEmail, password: "oxyn-test-123", fullName: "Tst Papeis" });
  const company = await a
    .from("companies")
    .insert({ name: `Papeis E2E ${stamp}`, slug: companySlug })
    .select("id")
    .single();
  if (company.error) throw company.error;
  companyId = company.data.id;
  const role = await a
    .from("roles")
    .insert({
      name: usedName,
      permissions: {
        visibility: { leads: "own", deals: "own", persons: "own", organizations: "own", activities: "own" },
        actions: { create: true, edit: true, delete: false, export: false, reassign_owner: false },
        settings: {
          manage_pipelines: false,
          manage_custom_fields: false,
          manage_products: false,
          view_reports: true,
          create_dashboards: true,
          share_dashboards: false,
        },
      },
    })
    .select("id")
    .single();
  if (role.error) throw role.error;
  const m = await a
    .from("memberships")
    .insert({ user_id: userId, company_id: companyId, role_id: role.data.id });
  if (m.error) throw m.error;
});
test.afterAll(cleanup);

test.beforeEach(async ({ page }) => {
  await login(page, "admin@oxyn.test", "oxyn-dev-123");
  await page.waitForURL((u) => !u.pathname.startsWith("/entrar"));
});

test("cria papel e ajusta permissões", async ({ page }) => {
  await page.goto("/configuracoes/papeis");
  await page.getByRole("button", { name: "Novo papel" }).click();
  await page.getByLabel("Nome").fill(createdName);
  await page.getByRole("button", { name: "Criar papel" }).click();
  await page.waitForURL(/\/configuracoes\/papeis\/[0-9a-f-]{36}$/);

  const save = page.getByRole("button", { name: "Salvar alterações" });
  await expect(save).toBeDisabled();
  await page
    .getByRole("radiogroup", { name: "Visibilidade de Negócios" })
    .getByRole("radio", { name: "Toda a empresa" })
    .click();
  await page.getByRole("switch", { name: "Reatribuir responsável" }).click();
  await expect(save).toBeEnabled();
  await save.click();
  await expect(save).toBeDisabled();

  await page.reload();
  await expect(
    page
      .getByRole("radiogroup", { name: "Visibilidade de Negócios" })
      .getByRole("radio", { name: "Toda a empresa" }),
  ).toBeChecked();
  await expect(page.getByRole("switch", { name: "Reatribuir responsável" })).toBeChecked();
});

test("papel do sistema não pode ser excluído", async ({ page }) => {
  await page.goto("/configuracoes/papeis");
  const row = page.getByRole("row", { name: /Usuário padrão/ });
  await expect(row.getByText("Padrão do sistema", { exact: true })).toBeVisible();
  await expect(row.getByRole("button", { name: "Excluir" })).toHaveCount(0);
});

test("papel em uso não pode ser excluído", async ({ page }) => {
  await page.goto("/configuracoes/papeis");
  const row = page.getByRole("row", { name: new RegExp(usedName) });
  await row.getByRole("button", { name: "Excluir" }).click();
  await page.getByRole("button", { name: "Confirmar exclusão" }).click();
  await expect(
    page.getByText(
      "Este papel está em uso por 1 acesso. Troque o papel dessas pessoas antes de excluir.",
    ),
  ).toBeVisible();
});
