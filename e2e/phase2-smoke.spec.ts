import { expect, test, type Browser, type Page } from "@playwright/test";
import { admin, createTestUser, deleteTestUser, login } from "./helpers/auth";
import { getLatestLink } from "./helpers/outbox";

const stamp = Date.now();
const password = "oxyn-test-123";
const slug = `tst-e2e-jor-${stamp}`;
const companyName = `Tst Jornada ${stamp}`;
const sdrEmail = `tst-e2e-jor-sdr-${stamp}@oxyn.test`;
const sdrName = `SDR Jornada ${stamp}`;
const gestorEmail = `tst-e2e-jor-gestor-${stamp}@oxyn.test`;
const roleName = `tst-e2e-jor-gestor-${stamp}`;
const fieldLabel = `Interesse ${stamp}`;
const labelName = `Quente ${stamp}`;
const orgName = `Org Jornada ${stamp}`;
const personName = `Pessoa Jornada ${stamp}`;
const leadTitle = `Lead Jornada ${stamp}`;
const gestorLeadTitle = `Lead do Gestor ${stamp}`;

let companyId = "";
let gestorId = "";
let leadId = "";

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  const a = admin();
  const c = await a.from("companies").insert({ name: companyName, slug }).select("id").single();
  if (c.error) throw c.error;
  companyId = c.data.id;
  gestorId = await createTestUser({ email: gestorEmail, password, fullName: "Gestor Jornada" });
  const role = await a
    .from("roles")
    .insert({
      name: roleName,
      permissions: {
        visibility: { leads: "company", deals: "own", persons: "company", organizations: "company", activities: "own" },
        actions: { create: true, edit: true, delete: true, export: true, reassign_owner: true },
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
  const m = await a.from("memberships").insert({ user_id: gestorId, company_id: companyId, role_id: role.data.id });
  if (m.error) throw m.error;
  const own = await a.from("leads").insert({ company_id: companyId, owner_id: gestorId, title: gestorLeadTitle });
  if (own.error) throw own.error;
});

test.afterAll(async () => {
  const a = admin();
  const errors: string[] = [];
  if (companyId) {
    const r = await a.from("companies").delete().eq("id", companyId);
    if (r.error) errors.push(`empresa: ${r.error.message}`);
  }
  const r = await a.from("roles").delete().eq("name", roleName);
  if (r.error) errors.push(`papel: ${r.error.message}`);
  const { data } = await a.from("profiles").select("id").eq("email", sdrEmail);
  const ids = [...(data ?? []).map((p) => p.id), gestorId].filter(Boolean);
  for (const id of ids) {
    await deleteTestUser(id).catch((e) => errors.push(`usuário ${id}: ${String(e?.message ?? e)}`));
  }
  if (errors.length) {
    console.error("Falha na limpeza do E2E da jornada:", errors);
    throw new Error(`Limpeza incompleta: ${errors.join("; ")}`);
  }
});

async function loggedIn(browser: Browser, email: string): Promise<Page> {
  const ctx = await browser.newContext({ baseURL: "http://localhost:3000" });
  const page = await ctx.newPage();
  await login(page, email, password);
  await page.waitForURL((u) => !u.pathname.startsWith("/entrar"));
  return page;
}

test("jornada da fase 2: admin cria campo personalizado e etiqueta e convida o SDR", async ({ browser }) => {
  const ctx = await browser.newContext({ baseURL: "http://localhost:3000" });
  const p = await ctx.newPage();
  await login(p, "admin@oxyn.test", "oxyn-dev-123");
  await p.waitForURL((u) => !u.pathname.startsWith("/entrar"));

  await p.goto(`/configuracoes/campos?empresa=${slug}`);
  await p.getByRole("tab", { name: "Leads" }).click();
  await p.getByRole("button", { name: "Novo campo" }).click();
  await p.getByLabel("Nome do campo").fill(fieldLabel);
  await p.getByLabel("Tipo").selectOption("text");
  await p.getByRole("button", { name: "Salvar", exact: true }).click();
  await expect(p.getByTestId("custom-field-row").filter({ hasText: fieldLabel })).toBeVisible();

  await p.goto(`/configuracoes/etiquetas?empresa=${slug}`);
  await p.getByLabel("Nome da etiqueta", { exact: true }).fill(labelName);
  await p.getByRole("button", { name: "Criar etiqueta" }).click();
  await expect(p.getByTestId("label-row").filter({ hasText: labelName })).toBeVisible();

  await p.goto("/configuracoes/usuarios");
  await p.getByRole("button", { name: "Convidar usuário" }).click();
  const dialog = p.getByRole("dialog");
  await dialog.getByLabel("Nome").fill(sdrName);
  await dialog.getByLabel("E-mail").fill(sdrEmail);
  await dialog.getByRole("combobox", { name: "Empresa" }).click();
  await p.getByRole("option", { name: companyName }).click();
  await dialog.getByRole("combobox", { name: "Papel" }).click();
  await p.getByRole("option", { name: "Usuário padrão" }).click();
  await dialog.getByRole("button", { name: "Enviar convite" }).click();
  await expect(p.getByRole("dialog")).toHaveCount(0);
  await ctx.close();

  const link = await getLatestLink(sdrEmail);
  const sctx = await browser.newContext({ baseURL: "http://localhost:3000" });
  const s = await sctx.newPage();
  await s.goto(link);
  await expect(s).toHaveURL(/definir-senha/);
  await s.getByLabel("Nova senha", { exact: true }).fill(password);
  await s.getByLabel("Confirmar senha").fill(password);
  await s.getByRole("button", { name: "Salvar senha" }).click();
  await expect(s).toHaveURL(new RegExp(`/${slug}/inicio$`));
  await sctx.close();
});

test("SDR cria organização, pessoa e lead com etiqueta, campo e anotação, e desqualifica", async ({ browser }) => {
  const page = await loggedIn(browser, sdrEmail);

  await page.goto(`/${slug}/contatos/organizacoes`);
  await page.getByRole("button", { name: "Nova organização" }).click();
  await page.getByLabel("Nome", { exact: true }).fill(orgName);
  await page.getByRole("button", { name: "Criar organização" }).click();
  await expect(page.getByRole("row").filter({ hasText: orgName })).toBeVisible();

  await page.goto(`/${slug}/contatos`);
  await page.getByRole("button", { name: "Nova pessoa" }).click();
  await page.getByLabel("Nome", { exact: true }).fill(personName);
  await page.getByRole("button", { name: "Criar pessoa" }).click();
  await expect(page.getByRole("row").filter({ hasText: personName })).toBeVisible();

  await page.goto(`/${slug}/leads`);
  await page.getByRole("button", { name: "Novo lead" }).click();
  await page.getByLabel("Título", { exact: true }).fill(leadTitle);
  await page.getByRole("combobox", { name: "Pessoa" }).fill(personName);
  await page.getByRole("option", { name: new RegExp(personName) }).click();
  await page.getByRole("combobox", { name: "Organização" }).fill(orgName);
  await page.getByRole("option", { name: new RegExp(orgName) }).click();
  await page.getByLabel(fieldLabel).fill("Alto");
  await page.getByRole("button", { name: "Criar lead" }).click();
  const row = page.getByRole("row").filter({ hasText: leadTitle });
  await expect(row).toBeVisible();
  await row.getByRole("link", { name: leadTitle }).click();
  await expect(page).toHaveURL(/\/leads\/[0-9a-f-]{36}$/);
  leadId = page.url().split("/").pop()!;

  await page.getByRole("button", { name: "Etiqueta", exact: true }).click();
  await page.getByRole("menuitem", { name: labelName }).click();
  await expect(page.getByText(labelName)).toBeVisible();

  await page.getByLabel("Anotação", { exact: true }).fill("Primeiro contato feito");
  await page.getByRole("button", { name: "Salvar anotação" }).click();
  await expect(page.getByTestId("timeline-note").first()).toContainText("Primeiro contato feito");

  await page.getByRole("button", { name: "Desqualificar" }).click();
  await page.getByLabel("Motivo").selectOption({ index: 1 });
  await page.getByRole("button", { name: "Confirmar desqualificação" }).click();
  await expect(page.getByTestId("lead-status")).toHaveText("Desqualificado");

  const d = await admin()
    .from("leads")
    .select("status, custom_fields, company_id")
    .eq("id", leadId)
    .single();
  expect(d.data?.status).toBe("disqualified");
  expect(d.data?.company_id).toBe(companyId);
  expect(Object.values(d.data?.custom_fields ?? {})).toContain("Alto");
  const labels = await admin().from("record_labels").select("label_id").eq("record_id", leadId);
  expect(labels.data?.length).toBe(1);
  await page.context().close();
});

test("SDR vê só os próprios leads e o gestor vê todos da empresa", async ({ browser }) => {
  const sdr = await loggedIn(browser, sdrEmail);
  await sdr.goto(`/${slug}/leads?status=disqualified`);
  await expect(sdr.getByRole("row").filter({ hasText: leadTitle })).toBeVisible();
  const sdrProfile = await admin().from("profiles").select("id").eq("email", sdrEmail).single();
  if (sdrProfile.error) throw sdrProfile.error;
  const ownOpen = `Lead Aberto do SDR ${stamp}`;
  const ins = await admin().from("leads").insert({ company_id: companyId, owner_id: sdrProfile.data.id, title: ownOpen });
  if (ins.error) throw ins.error;
  await sdr.goto(`/${slug}/leads`);
  await expect(sdr.getByRole("row").filter({ hasText: ownOpen })).toBeVisible();
  await expect(sdr.getByRole("row").filter({ hasText: gestorLeadTitle })).toHaveCount(0);
  await sdr.context().close();

  const gestor = await loggedIn(browser, gestorEmail);
  await gestor.goto(`/${slug}/leads`);
  await expect(gestor.getByRole("row").filter({ hasText: gestorLeadTitle })).toBeVisible();
  await gestor.goto(`/${slug}/leads?status=disqualified`);
  await expect(gestor.getByRole("row").filter({ hasText: leadTitle })).toBeVisible();
  await gestor.goto(`/${slug}/contatos`);
  await expect(gestor.getByRole("row").filter({ hasText: personName })).toBeVisible();
  await gestor.goto(`/${slug}/contatos/organizacoes`);
  await expect(gestor.getByRole("row").filter({ hasText: orgName })).toBeVisible();
  await gestor.context().close();
});
