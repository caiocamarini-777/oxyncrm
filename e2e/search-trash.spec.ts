import { expect, test, type Browser, type Page } from "@playwright/test";
import { admin, createTestUser, deleteTestUser, login } from "./helpers/auth";

const stamp = Date.now();
const password = "oxyn-test-123";
const slugA = `tst-e2e-bsc-a-${stamp}`;
const emailGestor = `tst-e2e-bsc-gestor-${stamp}@oxyn.test`;
const emailPadrao = `tst-e2e-bsc-padrao-${stamp}@oxyn.test`;
const emailSuper = `tst-e2e-bsc-super-${stamp}@oxyn.test`;
const roleGestor = `tst-e2e-bsc-gestor-${stamp}`;
const rolePadrao = `tst-e2e-bsc-padrao-${stamp}`;
let gestorId = "";
let padraoId = "";
let superId = "";
let companyA = "";
const rec: Record<string, string> = {};
const personEmail = `tst-busca-${stamp}@exemplo.test`;
const personName = `Pessoa Busca ${stamp}`;
const otherPerson = `Pessoa Alheia ${stamp}`;
const ownPerson = `Pessoa Propria ${stamp}`;
const leadTitle = `Lead Lixeira ${stamp}`;

const settings = {
  manage_pipelines: false,
  manage_custom_fields: false,
  manage_products: false,
  view_reports: true,
  create_dashboards: true,
  share_dashboards: false,
};
const permsGestor = {
  visibility: { leads: "company", deals: "own", persons: "company", organizations: "company", activities: "own" },
  actions: { create: true, edit: true, delete: true, export: true, reassign_owner: true },
  settings,
};
const permsPadrao = {
  visibility: { leads: "own", deals: "own", persons: "own", organizations: "own", activities: "own" },
  actions: { create: true, edit: true, delete: false, export: false, reassign_owner: false },
  settings,
};

async function newPage(browser: Browser, email: string): Promise<Page> {
  const ctx = await browser.newContext({ baseURL: "http://localhost:3000" });
  const page = await ctx.newPage();
  await login(page, email, password);
  await page.waitForURL((u) => !u.pathname.startsWith("/entrar"));
  return page;
}

async function insert(table: string, key: string, row: Record<string, unknown>) {
  const r = await admin().from(table).insert({ company_id: companyA, ...row }).select("id").single();
  if (r.error) throw r.error;
  rec[key] = r.data.id;
}

async function search(page: Page, text: string) {
  await page.getByRole("button", { name: /^Buscar/ }).click();
  await page.getByPlaceholder("Buscar empresas, registros e páginas").fill(text);
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  const a = admin();
  gestorId = await createTestUser({ email: emailGestor, password, fullName: "Gestor Busca E2E" });
  padraoId = await createTestUser({ email: emailPadrao, password, fullName: "Padrao Busca E2E" });
  superId = await createTestUser({ email: emailSuper, password, fullName: "Super Busca E2E", superAdmin: true });
  const ca = await a.from("companies").insert({ name: `Bsc A ${stamp}`, slug: slugA }).select("id").single();
  if (ca.error) throw ca.error;
  companyA = ca.data.id;
  const rg = await a.from("roles").insert({ name: roleGestor, permissions: permsGestor }).select("id").single();
  const rp = await a.from("roles").insert({ name: rolePadrao, permissions: permsPadrao }).select("id").single();
  if (rg.error) throw rg.error;
  if (rp.error) throw rp.error;
  const m = await a.from("memberships").insert([
    { user_id: gestorId, company_id: companyA, role_id: rg.data.id },
    { user_id: padraoId, company_id: companyA, role_id: rp.data.id },
  ]);
  if (m.error) throw m.error;

  await insert("persons", "person", { full_name: personName, emails: [{ value: personEmail, label: "work" }], owner_id: gestorId });
  await insert("persons", "other", { full_name: otherPerson, owner_id: gestorId });
  await insert("persons", "own", { full_name: ownPerson, owner_id: padraoId });
  await insert("leads", "lead", { title: leadTitle, owner_id: gestorId });
});

test.afterAll(async () => {
  const a = admin();
  if (companyA) await a.from("companies").delete().eq("id", companyA);
  await a.from("roles").delete().in("name", [roleGestor, rolePadrao]);
  for (const id of [gestorId, padraoId, superId]) if (id) await deleteTestUser(id).catch(() => {});
});

test("busca encontra pessoa por e-mail e abre o detalhe", async ({ browser }) => {
  const page = await newPage(browser, emailGestor);
  await page.goto(`/${slugA}/leads`);
  await search(page, personEmail);
  await expect(page.getByText("Pessoas", { exact: true })).toBeVisible();
  await page.getByRole("option", { name: new RegExp(personName) }).click();
  await expect(page).toHaveURL(new RegExp(`/${slugA}/contatos/pessoas/${rec.person}$`));
  await expect(page.getByRole("heading", { level: 1, name: personName })).toBeVisible();
  await page.context().close();
});

test("busca de usuário padrão não mostra registros de outros", async ({ browser }) => {
  const page = await newPage(browser, emailPadrao);
  await page.goto(`/${slugA}/leads`);
  await search(page, `Pessoa Alheia ${stamp}`);
  await expect(page.getByText("Nada encontrado.")).toBeVisible();
  await page.getByPlaceholder("Buscar empresas, registros e páginas").fill(`Pessoa Propria ${stamp}`);
  await expect(page.getByRole("option", { name: new RegExp(ownPerson) })).toBeVisible();
  await page.context().close();
});

test("mover para lixeira, restaurar e excluir definitivamente", async ({ browser }) => {
  const page = await newPage(browser, emailSuper);
  await page.goto(`/${slugA}/leads/${rec.lead}`);
  await page.getByRole("button", { name: "Mais ações" }).click();
  await page.getByRole("menuitem", { name: "Mover para a lixeira" }).click();
  await page.getByRole("button", { name: "Mover para a lixeira" }).click();
  await page.waitForURL(`**/${slugA}/leads`);

  await page.goto(`/${slugA}/lixeira`);
  const row = page.getByRole("row").filter({ hasText: leadTitle });
  await expect(row).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Exclusão definitiva em" })).toBeVisible();
  await row.getByRole("button", { name: "Restaurar" }).click();
  await expect(page.getByRole("row").filter({ hasText: leadTitle })).toHaveCount(0);
  const back = await admin().from("leads").select("deleted_at").eq("id", rec.lead).single();
  expect(back.data?.deleted_at).toBeNull();

  const t = await admin().from("leads").update({ deleted_at: new Date().toISOString() }).eq("id", rec.lead);
  if (t.error) throw t.error;
  await page.reload();
  const row2 = page.getByRole("row").filter({ hasText: leadTitle });
  await row2.getByRole("button", { name: "Excluir definitivamente" }).click();
  await expect(page.getByText(`Excluir ${leadTitle} para sempre? Esta ação não pode ser desfeita.`)).toBeVisible();
  await page.getByRole("alertdialog").getByRole("button", { name: "Excluir definitivamente" }).click();
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await expect(page.getByRole("row").filter({ hasText: leadTitle })).toHaveCount(0);
  const gone = await admin().from("leads").select("id").eq("id", rec.lead);
  expect(gone.data).toHaveLength(0);
  await page.context().close();
});

test("usuário sem permissão de excluir não vê o botão nem a lixeira de outros", async ({ browser }) => {
  const trashed = `Lead Alheio Lixeira ${stamp}`;
  await insert("leads", "trashed", { title: trashed, owner_id: gestorId, deleted_at: new Date().toISOString() });
  await insert("leads", "ownlead", { title: `Lead Proprio ${stamp}`, owner_id: padraoId });
  const page = await newPage(browser, emailPadrao);
  await page.goto(`/${slugA}/leads/${rec.ownlead}`);
  await expect(page.getByRole("heading", { level: 1, name: `Lead Proprio ${stamp}` })).toBeVisible();
  await expect(page.getByRole("button", { name: "Mais ações" })).toHaveCount(0);
  await page.goto(`/${slugA}/leads`);
  await expect(page.getByRole("link", { name: "Lixeira" })).toHaveCount(0);
  await page.goto(`/${slugA}/lixeira`);
  await expect(page.getByText("Você não tem permissão para ver a lixeira.")).toBeVisible();
  await expect(page.getByText(trashed)).toHaveCount(0);
  await page.context().close();
});
