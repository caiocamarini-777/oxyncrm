import { expect, test, type Browser, type Page } from "@playwright/test";
import { admin, createTestUser, deleteTestUser, login } from "./helpers/auth";

const stamp = Date.now();
const password = "oxyn-test-123";
const slugA = `tst-e2e-led-a-${stamp}`;
const email = `tst-e2e-led-gestor-${stamp}@oxyn.test`;
const roleName = `tst-e2e-led-gestor-${stamp}`;
let userId = "";
let companyA = "";
let reasonName = "";
const rec: Record<string, string> = {};
const inactiveSource = `tst-origem-inativa-${stamp}`;

const permissions = {
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
};

async function newPage(browser: Browser): Promise<Page> {
  const ctx = await browser.newContext({ baseURL: "http://localhost:3000", acceptDownloads: true });
  const page = await ctx.newPage();
  await login(page, email, password);
  await page.waitForURL((u) => !u.pathname.startsWith("/entrar"));
  return page;
}

async function lead(key: string, row: Record<string, unknown>) {
  const r = await admin()
    .from("leads")
    .insert({ company_id: companyA, owner_id: userId, ...row })
    .select("id")
    .single();
  if (r.error) throw r.error;
  rec[key] = r.data.id;
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  const a = admin();
  userId = await createTestUser({ email, password, fullName: "Gestor Leads E2E" });
  const ca = await a.from("companies").insert({ name: `Led A ${stamp}`, slug: slugA }).select("id").single();
  if (ca.error) throw ca.error;
  companyA = ca.data.id;
  const role = await a.from("roles").insert({ name: roleName, permissions }).select("id").single();
  if (role.error) throw role.error;
  const m = await a.from("memberships").insert({ user_id: userId, company_id: companyA, role_id: role.data.id });
  if (m.error) throw m.error;

  const reason = await a
    .from("disqualification_reasons")
    .select("name")
    .eq("company_id", companyA)
    .eq("active", true)
    .order("position")
    .limit(1)
    .single();
  if (reason.error) throw reason.error;
  reasonName = reason.data.name;

  await lead("disq", { title: `Lead Desq ${stamp}` });
  await lead("reopen", { title: `Lead Reabrir ${stamp}` });
  await lead("age", {
    title: `Lead Antigo ${stamp}`,
    created_at: new Date(Date.now() - 10 * 86_400_000).toISOString(),
  });
  const reasonRow = await a.from("disqualification_reasons").select("id").eq("company_id", companyA).eq("name", reasonName).single();
  if (reasonRow.error) throw reasonRow.error;
  const up = await a
    .from("leads")
    .update({ status: "disqualified", disqualification_reason_id: reasonRow.data.id, disqualification_note: "sem orçamento" })
    .eq("id", rec.reopen);
  if (up.error) throw up.error;

  const src = await a
    .from("lead_sources")
    .insert({ company_id: companyA, name: inactiveSource, active: false })
    .select("id")
    .single();
  if (src.error) throw src.error;
  await lead("inactive", { title: `Lead Origem Inativa ${stamp}`, source_id: src.data.id });
});

test.afterAll(async () => {
  const a = admin();
  if (companyA) await a.from("companies").delete().eq("id", companyA);
  await a.from("roles").delete().eq("name", roleName);
  if (userId) await deleteTestUser(userId).catch(() => {});
});

test("lista mostra a próxima atividade e o último canal", async ({ browser }) => {
  const a = admin();
  await lead("act", { title: `Lead Atividade ${stamp}` });
  await lead("noact", { title: `Lead Sem Atividade ${stamp}` });
  const [type, ch] = await Promise.all([
    a.from("activity_types").select("id").eq("company_id", companyA).limit(1).single(),
    a.from("activity_channels").select("id, name").eq("company_id", companyA).eq("is_legacy", false).order("position").limit(2),
  ]);
  if (type.error) throw type.error;
  if (ch.error) throw ch.error;
  expect(ch.data.length).toBeGreaterThanOrEqual(2);
  const base = { company_id: companyA, owner_id: userId, type_id: type.data.id, lead_id: rec.act };
  const open = await a
    .from("activities")
    .insert({ ...base, channel_id: ch.data[0].id, subject: `Retornar ${stamp}`, due_at: new Date(Date.now() - 3_600_000).toISOString() });
  if (open.error) throw open.error;
  // Concluída: o canal dela é o "último canal" (a conclusão direta vale só para o seed do teste).
  const outcome = await a.from("activity_outcomes").select("id").eq("company_id", companyA).limit(1).single();
  if (outcome.error) throw outcome.error;
  const done = await a.from("activities").insert({
    ...base,
    channel_id: ch.data[1].id,
    subject: `Feita ${stamp}`,
    due_at: new Date(Date.now() - 86_400_000).toISOString(),
    done: true,
    completed_at: new Date(Date.now() - 80_000_000).toISOString(),
    outcome_id: outcome.data.id,
  });
  if (done.error) throw done.error;

  const page = await newPage(browser);
  await page.goto(`/${slugA}/leads?q=${encodeURIComponent(`${stamp}`)}`);
  const row = page.getByRole("row").filter({ hasText: `Lead Atividade ${stamp}` });
  await expect(row.getByTestId("next-activity")).toHaveText("Atrasada");
  await expect(row.getByTestId("next-activity")).toHaveAttribute("title", `Retornar ${stamp}`);
  await expect(row).toContainText(ch.data[1].name);
  const none = page.getByRole("row").filter({ hasText: `Lead Sem Atividade ${stamp}` });
  await expect(none.getByTestId("next-activity")).toHaveText("Sem atividade");
  await page.context().close();
});

test("cria lead criando pessoa e organização juntas", async ({ browser }) => {
  const page = await newPage(browser);
  const title = `Lead Novo ${stamp}`;
  const personName = `Pessoa Nova ${stamp}`;
  const orgName = `Org Nova ${stamp}`;
  await page.goto(`/${slugA}/leads`);
  await expect(page.getByRole("heading", { level: 1, name: "Leads" })).toBeVisible();
  await page.getByRole("button", { name: "Novo lead" }).click();
  await page.getByLabel("Título", { exact: true }).fill(title);
  await page.getByRole("combobox", { name: "Pessoa" }).fill(personName);
  await page.getByRole("button", { name: `Criar pessoa nova: ${personName}` }).click();
  await page.getByRole("combobox", { name: "Organização" }).fill(orgName);
  await page.getByRole("button", { name: `Criar organização nova: ${orgName}` }).click();
  await page.getByLabel("Valor estimado (R$)").fill("1500,50");
  await page.getByRole("button", { name: "Criar lead" }).click();

  const row = page.getByRole("row").filter({ hasText: title });
  await expect(row).toBeVisible();
  await expect(row).toContainText(personName);
  await expect(row).toContainText(orgName);
  await expect(row).toContainText("hoje");

  const a = admin();
  const l = await a
    .from("leads")
    .select("person_id, organization_id, owner_id, estimated_value")
    .eq("company_id", companyA)
    .eq("title", title)
    .single();
  expect(l.data?.owner_id).toBe(userId);
  expect(Number(l.data?.estimated_value)).toBe(1500.5);
  const p = await a.from("persons").select("id, company_id, owner_id, organization_id").eq("full_name", personName).single();
  const o = await a.from("organizations").select("id, company_id, owner_id").eq("name", orgName).single();
  expect(p.data?.company_id).toBe(companyA);
  expect(o.data?.company_id).toBe(companyA);
  expect(p.data?.owner_id).toBe(userId);
  expect(l.data?.person_id).toBe(p.data?.id);
  expect(l.data?.organization_id).toBe(o.data?.id);
  expect(p.data?.organization_id).toBe(o.data?.id);
  await page.context().close();
});

test("desqualificar exige motivo e move para a aba Desqualificados", async ({ browser }) => {
  const page = await newPage(browser);
  const title = `Lead Desq ${stamp}`;
  await page.goto(`/${slugA}/leads/${rec.disq}`);
  await expect(page.getByTestId("lead-status")).toHaveText("Aberto");
  await expect(page.getByRole("button", { name: "Converter em negócio" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Reabrir" })).toHaveCount(0);
  await page.getByRole("button", { name: "Desqualificar" }).click();
  await page.getByRole("button", { name: "Confirmar desqualificação" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Escolha um motivo." })).toBeVisible();
  await page.getByLabel("Motivo").selectOption({ label: reasonName });
  await page.getByLabel("Observação").fill("Sem orçamento este ano");
  await page.getByRole("button", { name: "Confirmar desqualificação" }).click();
  await expect(page.getByTestId("lead-status")).toHaveText("Desqualificado");
  await expect(page.getByTestId("lead-reason")).toHaveText(reasonName);

  await page.goto(`/${slugA}/leads`);
  await expect(page.getByRole("row").filter({ hasText: title })).toHaveCount(0);
  await page.getByRole("link", { name: "Desqualificados" }).click();
  await expect(page).toHaveURL(/status=disqualified/);
  await expect(page.getByRole("row").filter({ hasText: title })).toBeVisible();

  const d = await admin().from("leads").select("status, disqualification_reason_id, disqualification_note").eq("id", rec.disq).single();
  expect(d.data?.status).toBe("disqualified");
  expect(d.data?.disqualification_reason_id).not.toBeNull();
  expect(d.data?.disqualification_note).toBe("Sem orçamento este ano");
  await page.context().close();
});

test("lead desqualificado pode ser arquivado", async ({ browser }) => {
  const page = await newPage(browser);
  await page.goto(`/${slugA}/leads/${rec.disq}`);
  await expect(page.getByTestId("lead-status")).toHaveText("Desqualificado");
  await page.getByRole("button", { name: "Arquivar" }).click();
  await expect(page.getByText("Lead arquivado.")).toBeVisible();
  await expect(page.getByTestId("lead-status")).toHaveText("Arquivado");
  const d = await admin().from("leads").select("status").eq("id", rec.disq).single();
  expect(d.data?.status).toBe("archived");
  await page.context().close();
});

test("reabrir lead", async ({ browser }) => {
  const page = await newPage(browser);
  await page.goto(`/${slugA}/leads/${rec.reopen}`);
  await expect(page.getByTestId("lead-status")).toHaveText("Desqualificado");
  await expect(page.getByRole("button", { name: "Desqualificar" })).toHaveCount(0);
  await page.getByRole("button", { name: "Reabrir" }).click();
  await expect(page.getByTestId("lead-status")).toHaveText("Aberto");
  const d = await admin().from("leads").select("status, disqualification_reason_id, disqualification_note").eq("id", rec.reopen).single();
  expect(d.data).toEqual({ status: "open", disqualification_reason_id: null, disqualification_note: null });

  await page.getByRole("button", { name: "Arquivar" }).click();
  await expect(page.getByTestId("lead-status")).toHaveText("Arquivado");
  await page.getByRole("button", { name: "Reabrir" }).click();
  await expect(page.getByTestId("lead-status")).toHaveText("Aberto");
  await page.context().close();
});

test("origem inativa não aparece no formulário mas continua no lead", async ({ browser }) => {
  const page = await newPage(browser);
  await page.goto(`/${slugA}/leads`);
  await page.getByRole("button", { name: "Novo lead" }).click();
  const options = page.getByLabel("Origem", { exact: true }).locator("option");
  await expect(options.first()).toBeAttached();
  await expect(options.filter({ hasText: inactiveSource })).toHaveCount(0);
  expect(await options.count()).toBeGreaterThan(1);
  await page.keyboard.press("Escape");

  await page.goto(`/${slugA}/leads/${rec.inactive}`);
  await expect(page.getByTestId("lead-source")).toHaveText(inactiveSource);
  await page.goto(`/${slugA}/leads`);
  await expect(page.getByRole("row").filter({ hasText: `Lead Origem Inativa ${stamp}` })).toContainText(inactiveSource);
  await page.context().close();
});

test("idade do lead", async ({ browser }) => {
  const page = await newPage(browser);
  await page.goto(`/${slugA}/leads`);
  await expect(page.getByRole("row").filter({ hasText: `Lead Antigo ${stamp}` })).toContainText("10 dias");
  await page.context().close();
});

test("exporta leads em CSV", async ({ browser }) => {
  const page = await newPage(browser);
  const res = await page.request.get(`/${slugA}/exportar/leads`);
  expect(res.status()).toBe(200);
  const csv = await res.text();
  expect(csv).toContain("Título");
  expect(csv).toContain(`Lead Antigo ${stamp}`);
  await page.context().close();
});
