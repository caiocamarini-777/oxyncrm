import { expect, test, type Browser, type Page } from "@playwright/test";
import { admin, createTestUser, deleteTestUser, login } from "./helpers/auth";

const stamp = Date.now();
const password = "oxyn-test-123";
const slugA = `tst-e2e-org-a-${stamp}`;
const slugB = `tst-e2e-org-b-${stamp}`;
const emails = {
  ana: `tst-e2e-org-ana-${stamp}@oxyn.test`,
  bruno: `tst-e2e-org-bruno-${stamp}@oxyn.test`,
  gestor: `tst-e2e-org-gestor-${stamp}@oxyn.test`,
  carla: `tst-e2e-org-carla-${stamp}@oxyn.test`,
};
const roleNames = [`tst-e2e-org-padrao-${stamp}`, `tst-e2e-org-gestor-${stamp}`];
const ids = { ana: "", bruno: "", gestor: "", carla: "" };
let companyA = "";
let companyB = "";
const orgs: Record<string, string> = {};

/** CNPJ válido a partir de uma base de 8 dígitos (filial 0001). */
function cnpjFrom(base: string): string {
  const d = (base + "0001").split("").map(Number);
  for (const len of [12, 13]) {
    const w = len === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const sum = w.reduce((acc, x, i) => acc + d[i] * x, 0);
    const r = sum % 11;
    d.push(r < 2 ? 0 : 11 - r);
  }
  return d.join("");
}
const cnpjAna = cnpjFrom(String(stamp).slice(-8));
const fmt = (c: string) => `${c.slice(0, 2)}.${c.slice(2, 5)}.${c.slice(5, 8)}/${c.slice(8, 12)}-${c.slice(12)}`;

const permissions = (gestor: boolean) => ({
  visibility: {
    leads: gestor ? "company" : "own",
    deals: "own",
    persons: gestor ? "company" : "own",
    organizations: gestor ? "company" : "own",
    activities: "own",
  },
  actions: { create: true, edit: true, delete: gestor, export: gestor, reassign_owner: gestor },
  settings: {
    manage_pipelines: false,
    manage_custom_fields: false,
    manage_products: false,
    view_reports: true,
    create_dashboards: true,
    share_dashboards: false,
  },
});

async function newPage(browser: Browser, email: string): Promise<Page> {
  const ctx = await browser.newContext({ baseURL: "http://localhost:3000", acceptDownloads: true });
  const page = await ctx.newPage();
  await login(page, email, password);
  await page.waitForURL((u) => !u.pathname.startsWith("/entrar"));
  return page;
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  const a = admin();
  ids.ana = await createTestUser({ email: emails.ana, password, fullName: "Ana E2E" });
  ids.bruno = await createTestUser({ email: emails.bruno, password, fullName: "Bruno E2E" });
  ids.gestor = await createTestUser({ email: emails.gestor, password, fullName: "Gestor E2E" });
  ids.carla = await createTestUser({ email: emails.carla, password, fullName: "Carla E2E" });

  const ca = await a.from("companies").insert({ name: `Org A ${stamp}`, slug: slugA }).select("id").single();
  const cb = await a.from("companies").insert({ name: `Org B ${stamp}`, slug: slugB }).select("id").single();
  if (ca.error) throw ca.error;
  if (cb.error) throw cb.error;
  companyA = ca.data.id;
  companyB = cb.data.id;

  const rp = await a.from("roles").insert({ name: roleNames[0], permissions: permissions(false) }).select("id").single();
  const rg = await a.from("roles").insert({ name: roleNames[1], permissions: permissions(true) }).select("id").single();
  if (rp.error) throw rp.error;
  if (rg.error) throw rg.error;
  const memberships = [
    { user_id: ids.ana, company_id: companyA, role_id: rp.data.id },
    { user_id: ids.bruno, company_id: companyA, role_id: rp.data.id },
    { user_id: ids.carla, company_id: companyA, role_id: rp.data.id },
    { user_id: ids.gestor, company_id: companyA, role_id: rg.data.id },
    { user_id: ids.gestor, company_id: companyB, role_id: rg.data.id },
  ];
  const m = await a.from("memberships").insert(memberships);
  if (m.error) throw m.error;

  const seed = [
    { key: "ana", name: `Alfa Ana ${stamp}`, owner: ids.ana, cnpj: cnpjAna },
    { key: "bruno", name: `Beta Bruno ${stamp}`, owner: ids.bruno, cnpj: null },
    { key: "carla", name: `Gama Carla ${stamp}`, owner: ids.carla, cnpj: null },
    { key: "bruno2", name: `Delta Bruno ${stamp}`, owner: ids.bruno, cnpj: null },
  ];
  for (const s of seed) {
    const r = await a
      .from("organizations")
      .insert({ company_id: companyA, owner_id: s.owner, name: s.name, cnpj: s.cnpj })
      .select("id")
      .single();
    if (r.error) throw r.error;
    orgs[s.key] = r.data.id;
  }
  const other = await a
    .from("organizations")
    .insert({ company_id: companyB, owner_id: ids.gestor, name: `Outra Empresa ${stamp}` })
    .select("id")
    .single();
  if (other.error) throw other.error;
  orgs.other = other.data.id;
  // Carla fica inativa depois de virar responsável.
  await a.from("profiles").update({ active: false }).eq("id", ids.carla);
});

test.afterAll(async () => {
  const a = admin();
  if (companyA) await a.from("companies").delete().eq("id", companyA);
  if (companyB) await a.from("companies").delete().eq("id", companyB);
  await a.from("roles").delete().in("name", roleNames);
  for (const id of Object.values(ids)) if (id) await deleteTestUser(id).catch(() => {});
});

test("cria organização, aparece na lista e abre o detalhe", async ({ browser }) => {
  const page = await newPage(browser, emails.gestor);
  const name = `Volt ${stamp}`;
  await page.goto(`/${slugA}/contatos/organizacoes`);
  await page.getByRole("button", { name: "Nova organização" }).click();
  await page.getByLabel("Nome", { exact: true }).fill(name);
  await page.getByLabel("Domínio").fill(`https://www.Volt${stamp}.com.br/`);
  await page.getByLabel("Segmento").fill("Energia");
  await page.getByRole("button", { name: "Criar organização" }).click();
  const row = page.getByRole("row").filter({ hasText: name });
  await expect(row).toBeVisible();
  await expect(row).toContainText(`volt${stamp}.com.br`);
  const { data } = await admin().from("organizations").select("domain, owner_id").eq("company_id", companyA).eq("name", name).single();
  expect(data).toEqual({ domain: `volt${stamp}.com.br`, owner_id: ids.gestor });

  await row.getByRole("link", { name }).click();
  await expect(page).toHaveURL(/\/contatos\/organizacoes\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  await expect(page.getByLabel("Domínio")).toHaveValue(`volt${stamp}.com.br`);
  await expect(page.getByRole("tab", { name: "Anotação" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Atividade" })).toHaveAttribute("aria-disabled", "true");
  await expect(page.getByRole("tab", { name: "E-mail" })).toHaveAttribute("aria-disabled", "true");
  await page.context().close();
});

test("filtra por responsável e ordena por nome", async ({ browser }) => {
  const page = await newPage(browser, emails.gestor);
  await page.goto(`/${slugA}/contatos/organizacoes`);
  await page.getByRole("button", { name: "Responsável" }).click();
  await page.getByRole("menuitemcheckbox", { name: "Bruno E2E" }).click();
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(new RegExp(`owner=${ids.bruno}`));
  await expect(page.getByRole("row").filter({ hasText: `Beta Bruno ${stamp}` })).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: `Delta Bruno ${stamp}` })).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: `Alfa Ana ${stamp}` })).toHaveCount(0);

  await page.getByRole("button", { name: "Nome", exact: true }).click();
  await expect(page).toHaveURL(/sort=name/);
  await expect(page).toHaveURL(/dir=asc/);
  const names = page.getByRole("row").filter({ hasText: `Bruno ${stamp}` });
  await expect(names.first()).toContainText(`Beta Bruno ${stamp}`);
  await page.getByRole("button", { name: "Nome", exact: true }).click();
  await expect(page).toHaveURL(/sort=name(&owner|$)/);
  await expect(page).not.toHaveURL(/dir=/);
  await expect(names.first()).toContainText(`Delta Bruno ${stamp}`);

  await page.reload();
  await expect(page).toHaveURL(/sort=name/);
  await expect(page.getByRole("button", { name: "Responsável" })).toContainText("1");
  await expect(names.first()).toContainText(`Delta Bruno ${stamp}`);
  await expect(page.getByRole("row").filter({ hasText: `Alfa Ana ${stamp}` })).toHaveCount(0);
  await page.context().close();
});

test("aviso de duplicidade não revela dados sem acesso", async ({ browser }) => {
  const bruno = await newPage(browser, emails.bruno);
  await bruno.goto(`/${slugA}/contatos/organizacoes`);
  await bruno.getByRole("button", { name: "Nova organização" }).click();
  await bruno.getByLabel("CNPJ").fill(fmt(cnpjAna));
  const warning = bruno.getByTestId("duplicate-warning");
  await expect(warning).toContainText("Já existe uma organização com este CNPJ nesta empresa.");
  await expect(warning).toContainText("Responsável: Ana E2E");
  await expect(warning).not.toContainText(`Alfa Ana ${stamp}`);
  await expect(bruno.getByRole("link", { name: "Abrir" })).toHaveCount(0);
  await bruno.context().close();

  const gestor = await newPage(browser, emails.gestor);
  await gestor.goto(`/${slugA}/contatos/organizacoes`);
  await gestor.getByRole("button", { name: "Nova organização" }).click();
  await gestor.getByLabel("CNPJ").fill(fmt(cnpjAna));
  await expect(gestor.getByTestId("duplicate-warning")).toContainText("Responsável: Ana E2E");
  await expect(gestor.getByRole("link", { name: "Abrir" })).toHaveAttribute("href", `/${slugA}/contatos/organizacoes/${orgs.ana}`);
  await gestor.context().close();
});

test("usuário padrão não vê organização de outro", async ({ browser }) => {
  const page = await newPage(browser, emails.bruno);
  await page.goto(`/${slugA}/contatos/organizacoes`);
  await expect(page.getByRole("row").filter({ hasText: `Beta Bruno ${stamp}` })).toBeVisible();
  await expect(page.getByText(`Alfa Ana ${stamp}`)).toHaveCount(0);
  await expect(page.getByText(`Gama Carla ${stamp}`)).toHaveCount(0);
  await page.context().close();
});

test("404 igual para inexistente e sem acesso", async ({ browser }) => {
  const page = await newPage(browser, emails.bruno);
  const semAcesso = await page.goto(`/${slugA}/contatos/organizacoes/${orgs.ana}`);
  await expect(page.getByText("This page could not be found.")).toBeVisible();
  const textoSemAcesso = await page.locator("body").innerText();
  const inexistente = await page.goto(`/${slugA}/contatos/organizacoes/00000000-0000-4000-8000-000000000000`);
  await expect(page.getByText("This page could not be found.")).toBeVisible();
  const textoInexistente = await page.locator("body").innerText();
  expect(semAcesso?.status()).toBe(404);
  expect(inexistente?.status()).toBe(404);
  expect(textoSemAcesso).toBe(textoInexistente);
  expect(textoSemAcesso).not.toContain(`Alfa Ana ${stamp}`);
  await page.context().close();

  // Organização de outra empresa aberta pela URL da empresa errada.
  const gestor = await newPage(browser, emails.gestor);
  const outra = await gestor.goto(`/${slugA}/contatos/organizacoes/${orgs.other}`);
  expect(outra?.status()).toBe(404);
  await gestor.context().close();
});

test("reatribuir responsável exige permissão", async ({ browser }) => {
  const bruno = await newPage(browser, emails.bruno);
  await bruno.goto(`/${slugA}/contatos/organizacoes/${orgs.bruno}`);
  await expect(bruno.getByLabel("Responsável")).toBeDisabled();

  const gestor = await newPage(browser, emails.gestor);
  await gestor.goto(`/${slugA}/contatos/organizacoes/${orgs.bruno}`);
  const picker = gestor.getByLabel("Responsável");
  await expect(picker).toBeEnabled();
  await picker.selectOption({ label: "Ana E2E" });
  await expect.poll(async () => {
    const { data } = await admin().from("organizations").select("owner_id").eq("id", orgs.bruno).single();
    return data?.owner_id;
  }).toBe(ids.ana);
  await gestor.context().close();

  await bruno.goto(`/${slugA}/contatos/organizacoes`);
  await expect(bruno.getByRole("row").filter({ hasText: `Delta Bruno ${stamp}` })).toBeVisible();
  await expect(bruno.getByText(`Beta Bruno ${stamp}`)).toHaveCount(0);
  await bruno.context().close();
});

test("responsável inativo aparece marcado e não é oferecido", async ({ browser }) => {
  const page = await newPage(browser, emails.gestor);
  await page.goto(`/${slugA}/contatos/organizacoes/${orgs.carla}`);
  await expect(page.getByLabel("Responsável")).toContainText("Carla E2E (inativo)");
  await page.goto(`/${slugA}/contatos/organizacoes/${orgs.ana}`);
  const options = await page.getByLabel("Responsável").locator("option").allInnerTexts();
  expect(options.some((o) => o.includes("Carla"))).toBe(false);
  expect(options).toContain("Bruno E2E");
  await page.context().close();
});

test("na visão Todas, criar pede a empresa", async ({ browser }) => {
  const page = await newPage(browser, emails.gestor);
  const name = `Todas ${stamp}`;
  await page.goto("/todas/contatos/organizacoes");
  await page.getByRole("button", { name: "Nova organização" }).click();
  await expect(page.getByLabel("Nome", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: `Org B ${stamp}` }).click();
  await page.getByLabel("Nome", { exact: true }).fill(name);
  await page.getByRole("button", { name: "Criar organização" }).click();
  await expect(page.getByRole("row").filter({ hasText: name })).toContainText(`Org B ${stamp}`);
  const { data } = await admin().from("organizations").select("company_id").eq("name", name).single();
  expect(data?.company_id).toBe(companyB);
  await page.context().close();
});

test("exportar CSV só com permissão", async ({ browser }) => {
  const bruno = await newPage(browser, emails.bruno);
  await bruno.goto(`/${slugA}/contatos/organizacoes`);
  await expect(bruno.getByRole("button", { name: "Nova organização" })).toBeVisible();
  await expect(bruno.getByRole("link", { name: "Exportar CSV" })).toHaveCount(0);
  const denied = await bruno.request.get(`/${slugA}/exportar/organizacoes`);
  expect(denied.status()).toBe(403);
  await bruno.context().close();

  const gestor = await newPage(browser, emails.gestor);
  await gestor.goto(`/${slugA}/contatos/organizacoes`);
  const [download] = await Promise.all([
    gestor.waitForEvent("download"),
    gestor.getByRole("link", { name: "Exportar CSV" }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(new RegExp(`^organizacoes-${slugA}-\\d{4}-\\d{2}-\\d{2}\\.csv$`));
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(c as Buffer);
  const csv = Buffer.concat(chunks).toString("utf8").replace(/^﻿/, "");
  const lines = csv.split("\r\n");
  expect(lines[0]).toBe("Nome;CNPJ;Domínio;Segmento;Responsável;Pessoas vinculadas;Etiquetas;Criada em");
  expect(csv).toContain(`Alfa Ana ${stamp};${fmt(cnpjAna)}`);
  await gestor.context().close();
});
