import { expect, test, type Browser, type Page } from "@playwright/test";
import { admin, createTestUser, deleteTestUser, login } from "./helpers/auth";

const stamp = Date.now();
const password = "oxyn-test-123";
const slugA = `tst-e2e-pes-a-${stamp}`;
const emails = {
  ana: `tst-e2e-pes-ana-${stamp}@oxyn.test`,
  bruno: `tst-e2e-pes-bruno-${stamp}@oxyn.test`,
  gestor: `tst-e2e-pes-gestor-${stamp}@oxyn.test`,
};
const roleNames = [`tst-e2e-pes-padrao-${stamp}`, `tst-e2e-pes-gestor-${stamp}`];
const ids = { ana: "", bruno: "", gestor: "" };
let companyA = "";
const rec: Record<string, string> = {};

const dupEmail = `tst-dup-${stamp}@exemplo.com`;
const dupPhone = String(11900000000 + (stamp % 100000000)); // 11 dígitos, 9 depois do DDD

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
  const ca = await a.from("companies").insert({ name: `Pes A ${stamp}`, slug: slugA }).select("id").single();
  if (ca.error) throw ca.error;
  companyA = ca.data.id;
  const rp = await a.from("roles").insert({ name: roleNames[0], permissions: permissions(false) }).select("id").single();
  const rg = await a.from("roles").insert({ name: roleNames[1], permissions: permissions(true) }).select("id").single();
  if (rp.error) throw rp.error;
  if (rg.error) throw rg.error;
  const m = await a.from("memberships").insert([
    { user_id: ids.ana, company_id: companyA, role_id: rp.data.id },
    { user_id: ids.bruno, company_id: companyA, role_id: rp.data.id },
    { user_id: ids.gestor, company_id: companyA, role_id: rg.data.id },
  ]);
  if (m.error) throw m.error;

  async function org(key: string, name: string, owner: string, trashed = false) {
    const r = await a
      .from("organizations")
      .insert({ company_id: companyA, owner_id: owner, name, deleted_at: trashed ? new Date().toISOString() : null })
      .select("id")
      .single();
    if (r.error) throw r.error;
    rec[key] = r.data.id;
  }
  await org("orgOwn", `Org Propria ${stamp}`, ids.bruno);
  await org("orgAna", `Org da Ana ${stamp}`, ids.ana);
  await org("orgTrash", `Org Lixeira ${stamp}`, ids.bruno, true);

  async function person(key: string, row: Record<string, unknown>) {
    const r = await a
      .from("persons")
      .insert({ company_id: companyA, ...row })
      .select("id")
      .single();
    if (r.error) throw r.error;
    rec[key] = r.data.id;
  }
  await person("dup", {
    owner_id: ids.ana,
    full_name: `Duplicada Ana ${stamp}`,
    emails: [{ label: "Trabalho", value: dupEmail }],
    phones: [{ label: "Celular", value: dupPhone }],
  });
  await person("pOwn", { owner_id: ids.bruno, full_name: `Bruno Org Ok ${stamp}`, organization_id: rec.orgOwn });
  await person("pAna", { owner_id: ids.bruno, full_name: `Bruno Sem Acesso ${stamp}`, organization_id: rec.orgAna });
  await person("pTrash", { owner_id: ids.bruno, full_name: `Bruno Lixeira ${stamp}`, organization_id: rec.orgTrash });
  await person("wa", {
    owner_id: ids.bruno,
    full_name: `Whats ${stamp}`,
    phones: [
      { label: "Celular", value: "11999990000" },
      { label: "Trabalho", value: "1133334444" },
      { label: "Outro", value: "11977770000" },
      { label: "Outro", value: "11866660000" },
    ],
  });
});

test.afterAll(async () => {
  const a = admin();
  if (companyA) await a.from("companies").delete().eq("id", companyA);
  await a.from("roles").delete().in("name", roleNames);
  for (const id of Object.values(ids)) if (id) await deleteTestUser(id).catch(() => {});
});

test("cria pessoa com dois e-mails e organização nova inline", async ({ browser }) => {
  const page = await newPage(browser, emails.gestor);
  const name = `Maria Nova ${stamp}`;
  const orgName = `Org Inline ${stamp}`;
  await page.goto(`/${slugA}/contatos`);
  await expect(page.getByRole("heading", { level: 1, name: "Pessoas" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Pessoas", exact: true })).toHaveAttribute("aria-current", "page");
  await page.getByRole("button", { name: "Nova pessoa" }).click();
  await page.getByLabel("Nome", { exact: true }).fill(name);
  await page.getByLabel("Cargo").fill("Diretora");
  await page.getByRole("button", { name: "Adicionar e-mail" }).click();
  await page.getByLabel("E-mail 1", { exact: true }).fill(`maria${stamp}@Nova.com`);
  await page.getByRole("button", { name: "Adicionar e-mail" }).click();
  await page.getByLabel("E-mail 2", { exact: true }).fill(`maria.pessoal${stamp}@nova.com`);
  await page.getByLabel("Rótulo do e-mail 2").selectOption("Pessoal");
  await page.getByRole("button", { name: "Criar organização" }).click();
  await page.getByLabel("Nome da nova organização").fill(orgName);
  await page.getByRole("button", { name: "Criar e vincular" }).click();
  await expect(page.getByTestId("person-organization")).toHaveText(orgName);
  await page.getByRole("button", { name: "Criar pessoa" }).click();
  const row = page.getByRole("row").filter({ hasText: name });
  await expect(row).toBeVisible();
  await expect(row).toContainText(orgName);
  await expect(row).toContainText(`maria${stamp}@nova.com`);

  const { data } = await admin()
    .from("persons")
    .select("emails, organization_id, owner_id, job_title")
    .eq("company_id", companyA)
    .eq("full_name", name)
    .single();
  expect(data?.emails).toEqual([
    { label: "Trabalho", value: `maria${stamp}@nova.com` },
    { label: "Pessoal", value: `maria.pessoal${stamp}@nova.com` },
  ]);
  expect(data?.owner_id).toBe(ids.gestor);
  const o = await admin().from("organizations").select("id, company_id").eq("name", orgName).single();
  expect(o.data?.company_id).toBe(companyA);
  expect(data?.organization_id).toBe(o.data?.id);
  await page.context().close();
});

test("aviso de duplicidade por e-mail e por telefone", async ({ browser }) => {
  const bruno = await newPage(browser, emails.bruno);
  await bruno.goto(`/${slugA}/contatos`);
  await bruno.getByRole("button", { name: "Nova pessoa" }).click();
  await bruno.getByRole("button", { name: "Adicionar e-mail" }).click();
  await bruno.getByLabel("E-mail 1", { exact: true }).fill(dupEmail.toUpperCase());
  const warning = bruno.getByTestId("duplicate-warning");
  await expect(warning).toHaveCount(1);
  await expect(warning).toContainText("Já existe uma pessoa com este e-mail nesta empresa.");
  await expect(warning).toContainText("Responsável: Ana E2E");
  await expect(warning).not.toContainText("Duplicada");
  await bruno.getByRole("button", { name: "Adicionar telefone" }).click();
  await bruno.getByLabel("Telefone 1", { exact: true }).fill(dupPhone);
  await expect(warning).toHaveCount(2);
  await expect(warning.nth(1)).toContainText("com este telefone");
  await expect(bruno.getByRole("link", { name: "Abrir" })).toHaveCount(0);
  await bruno.context().close();

  const gestor = await newPage(browser, emails.gestor);
  await gestor.goto(`/${slugA}/contatos`);
  await gestor.getByRole("button", { name: "Nova pessoa" }).click();
  await gestor.getByRole("button", { name: "Adicionar telefone" }).click();
  await gestor.getByLabel("Telefone 1", { exact: true }).fill(dupPhone);
  await expect(gestor.getByTestId("duplicate-warning")).toContainText("com este telefone");
  await expect(gestor.getByRole("link", { name: "Abrir" })).toHaveAttribute(
    "href",
    `/${slugA}/contatos/pessoas/${rec.dup}`,
  );
  await gestor.context().close();
});

test("organização sem acesso ou na lixeira aparece sem link", async ({ browser }) => {
  const page = await newPage(browser, emails.bruno);

  await page.goto(`/${slugA}/contatos/pessoas/${rec.pOwn}`);
  const ok = page.getByTestId("person-organization-link");
  await expect(ok).toHaveText(`Org Propria ${stamp}`);
  await expect(ok).toHaveAttribute("href", `/${slugA}/contatos/organizacoes/${rec.orgOwn}`);

  await page.goto(`/${slugA}/contatos/pessoas/${rec.pAna}`);
  const semAcesso = page.getByTestId("person-organization-link");
  await expect(semAcesso).toContainText("(sem acesso)");
  await expect(semAcesso).not.toHaveAttribute("href", /.+/);
  await expect(page.locator(`a[href*="${rec.orgAna}"]`)).toHaveCount(0);

  await page.goto(`/${slugA}/contatos/pessoas/${rec.pTrash}`);
  const lixeira = page.getByTestId("person-organization-link");
  await expect(lixeira).toContainText("(na lixeira)");
  await expect(lixeira).not.toHaveAttribute("href", /.+/);
  await expect(page.locator(`a[href*="${rec.orgTrash}"]`)).toHaveCount(0);
  await page.context().close();
});

test("link de WhatsApp só para celular", async ({ browser }) => {
  const page = await newPage(browser, emails.bruno);
  await page.goto(`/${slugA}/contatos/pessoas/${rec.wa}`);
  const contacts = page.getByTestId("person-contacts");
  const wa = contacts.getByRole("link", { name: /^WhatsApp/ });
  await expect(wa).toHaveCount(2);
  await expect(wa.nth(0)).toHaveAttribute("href", "https://wa.me/5511999990000");
  await expect(wa.nth(0)).toHaveAttribute("target", "_blank");
  await expect(wa.nth(0)).toHaveAttribute("rel", "noopener noreferrer");
  await expect(wa.nth(1)).toHaveAttribute("href", "https://wa.me/5511977770000");
  await expect(contacts.locator('a[href^="tel:"]')).toHaveCount(4);
  await expect(contacts.locator('a[href^="tel:"]').first()).toHaveAttribute("href", "tel:+5511999990000");
  await page.context().close();
});

test("edita a pessoa e usuário padrão não vê pessoa de outro", async ({ browser }) => {
  const page = await newPage(browser, emails.bruno);
  await page.goto(`/${slugA}/contatos`);
  await expect(page.getByRole("row").filter({ hasText: `Whats ${stamp}` })).toBeVisible();
  await expect(page.getByText(`Duplicada Ana ${stamp}`)).toHaveCount(0);

  await page.goto(`/${slugA}/contatos/pessoas/${rec.wa}`);
  await page.getByLabel("Cargo").fill("Analista");
  await page.getByLabel("LinkedIn").fill("https://example.com/in/x");
  await page.getByRole("button", { name: "Salvar", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Use um endereço https:// do linkedin.com." })).toBeVisible();
  await page.getByLabel("LinkedIn").fill("https://www.linkedin.com/in/whats");
  await page.getByRole("button", { name: "Salvar", exact: true }).click();
  await expect.poll(async () => {
    const { data } = await admin().from("persons").select("job_title, linkedin_url").eq("id", rec.wa).single();
    return data;
  }).toEqual({ job_title: "Analista", linkedin_url: "https://www.linkedin.com/in/whats" });

  const semAcesso = await page.goto(`/${slugA}/contatos/pessoas/${rec.dup}`);
  expect(semAcesso?.status()).toBe(404);
  await page.context().close();
});

test("exportar CSV de pessoas só com permissão", async ({ browser }) => {
  const bruno = await newPage(browser, emails.bruno);
  const denied = await bruno.request.get(`/${slugA}/exportar/pessoas`);
  expect(denied.status()).toBe(403);
  await bruno.context().close();

  const gestor = await newPage(browser, emails.gestor);
  await gestor.goto(`/${slugA}/contatos`);
  const [download] = await Promise.all([
    gestor.waitForEvent("download"),
    gestor.getByRole("link", { name: "Exportar CSV" }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(new RegExp(`^pessoas-${slugA}-\\d{4}-\\d{2}-\\d{2}\\.csv$`));
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(c as Buffer);
  const csv = Buffer.concat(chunks).toString("utf8").replace(/^﻿/, "");
  expect(csv.split("\r\n")[0]).toBe("Nome;Cargo;Organização;E-mail principal;Telefone principal;Responsável;Etiquetas;Criada em");
  expect(csv).toContain(`Duplicada Ana ${stamp};`);
  await gestor.context().close();
});

test("busca na lista por e-mail e por telefone", async ({ browser }) => {
  const gestor = await newPage(browser, emails.gestor);
  const row = gestor.getByRole("row").filter({ hasText: `Duplicada Ana ${stamp}` });

  await gestor.goto(`/${slugA}/contatos?q=${encodeURIComponent(dupEmail.toUpperCase())}`);
  await expect(row).toBeVisible();
  await expect(gestor.getByRole("row").filter({ hasText: `Whats ${stamp}` })).toHaveCount(0);

  const formatted = `(${dupPhone.slice(0, 2)}) ${dupPhone.slice(2, 7)}-${dupPhone.slice(7)}`;
  await gestor.goto(`/${slugA}/contatos?q=${encodeURIComponent(formatted)}`);
  await expect(row).toBeVisible();
  await expect(gestor.getByRole("row").filter({ hasText: `Whats ${stamp}` })).toHaveCount(0);

  await gestor.goto(`/${slugA}/contatos?q=${encodeURIComponent(`+55 ${dupPhone}`)}`);
  await expect(row).toBeVisible();
  await gestor.context().close();
});

test("telefone com +55 acusa duplicidade da forma nacional", async ({ browser }) => {
  const gestor = await newPage(browser, emails.gestor);
  await gestor.goto(`/${slugA}/contatos`);
  await gestor.getByRole("button", { name: "Nova pessoa" }).click();
  await gestor.getByRole("button", { name: "Adicionar telefone" }).click();
  await gestor.getByLabel("Telefone 1", { exact: true }).fill(`+55 ${dupPhone}`);
  await expect(gestor.getByTestId("duplicate-warning")).toContainText("com este telefone");
  await gestor.context().close();
});
