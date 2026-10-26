import { expect, test, type Browser, type Page } from "@playwright/test";
import { admin, createTestUser, deleteTestUser, login } from "./helpers/auth";

const stamp = Date.now();
const password = "oxyn-test-123";
const slug = `tst-e2e-cv-${stamp}`;
const slugBulk = `tst-e2e-cvb-${stamp}`;
const email = `tst-e2e-cv-admin-${stamp}@oxyn.test`;
const leadTitle = `Lead Conversao ${stamp}`;
const dealTitle = `Negocio Convertido ${stamp}`;
const trashedTitle = `Negocio Lixeira ${stamp}`;

let userId = "";
let companyId = "";
let bulkCompanyId = "";
let pipelineId = "";
let personId = "";
let orgId = "";
let leadId = "";
let labelId = "";
let dealId = "";
let proposalStage = "";
let readerId = "";
const readerEmail = `tst-e2e-cv-leitor-${stamp}@oxyn.test`;
const readerRole = `tst-e2e-cv-leitor-${stamp}`;

test.describe.configure({ mode: "serial" });
test.setTimeout(180_000);

async function insert(table: string, row: Record<string, unknown>): Promise<string> {
  const r = await admin().from(table).insert(row).select("id").single();
  if (r.error) throw r.error;
  return r.data.id as string;
}

async function newPage(browser: Browser): Promise<Page> {
  const ctx = await browser.newContext({ baseURL: "http://localhost:3000" });
  const page = await ctx.newPage();
  await login(page, email, password);
  await page.waitForURL((u) => !u.pathname.startsWith("/entrar"));
  return page;
}

test.beforeAll(async () => {
  userId = await createTestUser({ email, password, fullName: "Ada Conversao", superAdmin: true });
  companyId = await insert("companies", { name: `Conversao E2E ${stamp}`, slug });
  const a = admin();
  const p = await a.from("pipelines").select("id").eq("company_id", companyId).single();
  if (p.error) throw p.error;
  pipelineId = p.data.id;
  const st = await a.from("stages").select("id, name").eq("pipeline_id", pipelineId);
  if (st.error) throw st.error;
  proposalStage = st.data.find((s) => s.name === "Proposta")!.id;
  const req = await a.from("stages").update({ required_fields: ["expected_close_date"] }).eq("id", proposalStage);
  if (req.error) throw req.error;

  personId = await insert("persons", { company_id: companyId, owner_id: userId, full_name: `Pessoa Conv ${stamp}` });
  orgId = await insert("organizations", { company_id: companyId, owner_id: userId, name: `Org Conv ${stamp}` });
  labelId = await insert("labels", { company_id: companyId, name: `conv-${stamp}`, color: "teal" });
  leadId = await insert("leads", {
    company_id: companyId,
    owner_id: userId,
    title: leadTitle,
    person_id: personId,
    organization_id: orgId,
    estimated_value: 4200,
  });
  const l = await a.from("record_labels").insert({ label_id: labelId, entity: "leads", record_id: leadId });
  if (l.error) throw l.error;
  const stage = await a.from("stages").select("id").eq("pipeline_id", pipelineId).eq("name", "Qualificação").single();
  if (stage.error) throw stage.error;
  await insert("deals", {
    company_id: companyId,
    owner_id: userId,
    pipeline_id: pipelineId,
    stage_id: stage.data.id,
    title: trashedTitle,
    deleted_at: new Date().toISOString(),
  });
});

test.afterAll(async () => {
  for (const id of [companyId, bulkCompanyId]) if (id) await admin().from("companies").delete().eq("id", id);
  await admin().from("roles").delete().eq("name", readerRole);
  for (const id of [userId, readerId]) if (id) await deleteTestUser(id).catch(() => {});
});

test("converter lead cria negócio com pessoa, organização, valor e etiquetas", async ({ browser }) => {
  const page = await newPage(browser);
  await page.goto(`/${slug}/leads/${leadId}`);
  await page.getByRole("button", { name: "Converter em negócio" }).click();
  const dlg = page.getByRole("dialog");
  await expect(dlg.getByLabel("Título do negócio")).toHaveValue(leadTitle);
  await expect(dlg.getByLabel("Funil")).toHaveValue(pipelineId);

  // Etapa com obrigatório faltando: mostra a lista e sugere outra etapa.
  await dlg.getByLabel("Etapa").selectOption({ label: "Proposta" });
  await dlg.getByRole("button", { name: "Converter", exact: true }).click();
  await expect(dlg.getByRole("alert")).toHaveText("Esta etapa exige: Data de fechamento esperada. Escolha outra etapa.");

  await dlg.getByLabel("Etapa").selectOption({ label: "Qualificação" });
  await dlg.getByLabel("Título do negócio").fill(dealTitle);
  await dlg.getByRole("button", { name: "Converter", exact: true }).click();
  await page.waitForURL(new RegExp(`/${slug}/negocios/[0-9a-f-]{36}$`));
  await expect(page.getByRole("heading", { level: 1, name: dealTitle })).toBeVisible();

  dealId = page.url().split("/").pop()!;
  const d = await admin()
    .from("deals")
    .select("person_id, organization_id, estimated_value, title")
    .eq("id", dealId)
    .single();
  expect(d.data?.person_id).toBe(personId);
  expect(d.data?.organization_id).toBe(orgId);
  expect(Number(d.data?.estimated_value)).toBe(4200);
  const labels = await admin().from("record_labels").select("label_id").eq("entity", "deals").eq("record_id", dealId);
  expect(labels.data?.map((l) => l.label_id)).toEqual([labelId]);
  await page.context().close();
});

test("lead convertido aparece na aba Convertidos com link", async ({ browser }) => {
  const page = await newPage(browser);
  await page.goto(`/${slug}/leads`);
  await page.getByRole("link", { name: "Convertidos" }).click();
  await expect(page).toHaveURL(/status=converted/);
  await expect(page.getByRole("row").filter({ hasText: leadTitle })).toBeVisible();

  await page.goto(`/${slug}/leads/${leadId}`);
  await expect(page.getByTestId("lead-status")).toHaveText("Convertido");
  await expect(page.getByRole("button", { name: "Converter em negócio" })).toHaveCount(0);
  const link = page.getByTestId("lead-deal-link");
  await expect(link).toHaveText(dealTitle);
  await link.click();
  await expect(page).toHaveURL(new RegExp(`/${slug}/negocios/${dealId}$`));
  await page.context().close();
});

test("busca encontra negócio pelo título", async ({ browser }) => {
  const page = await newPage(browser);
  await page.goto(`/${slug}/negocios`);
  await page.getByRole("button", { name: /^Buscar/ }).click();
  await page.getByPlaceholder("Buscar empresas, registros e páginas").fill(dealTitle);
  const option = page.getByRole("option", { name: new RegExp(dealTitle) });
  await expect(option).toBeVisible();
  await option.click();
  await expect(page).toHaveURL(new RegExp(`/${slug}/negocios/${dealId}$`));
  await page.context().close();
});

test("negócio na lixeira pode ser restaurado", async ({ browser }) => {
  const page = await newPage(browser);
  await page.goto(`/${slug}/lixeira?aba=negocios`);
  const row = page.getByRole("row").filter({ hasText: trashedTitle });
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "Restaurar" }).click();
  await expect(page.getByRole("row").filter({ hasText: trashedTitle })).toHaveCount(0);
  const back = await admin().from("deals").select("deleted_at").eq("title", trashedTitle).eq("company_id", companyId).single();
  expect(back.data?.deleted_at).toBeNull();
  await page.context().close();
});

test("filtro por etiqueta continua funcionando nas listas", async ({ browser }) => {
  const a = admin();
  bulkCompanyId = await insert("companies", { name: `Conversao Bulk ${stamp}`, slug: slugBulk });
  const bulkLabel = await insert("labels", { company_id: bulkCompanyId, name: `bulk-${stamp}`, color: "blue" });
  const N = 1200;
  const BATCH = 300;
  const specs = [
    { table: "persons", entity: "persons", row: (i: number) => ({ full_name: `Bulk ${i} ${stamp}` }), path: "contatos" },
    { table: "organizations", entity: "organizations", row: (i: number) => ({ name: `Bulk ${i} ${stamp}` }), path: "contatos/organizacoes" },
    { table: "leads", entity: "leads", row: (i: number) => ({ title: `Bulk ${i} ${stamp}` }), path: "leads" },
  ];
  for (const s of specs) {
    for (let from = 0; from < N; from += BATCH) {
      const rows = Array.from({ length: BATCH }, (_, k) => ({
        company_id: bulkCompanyId,
        owner_id: userId,
        ...s.row(from + k),
      }));
      const ins = await a.from(s.table).insert(rows).select("id");
      if (ins.error) throw ins.error;
      const rl = await a
        .from("record_labels")
        .insert(ins.data.map((r) => ({ label_id: bulkLabel, entity: s.entity, record_id: r.id })));
      if (rl.error) throw rl.error;
    }
  }

  const page = await newPage(browser);
  for (const s of specs) {
    await page.goto(`/${slugBulk}/${s.path}?label=${bulkLabel}`);
    await expect(page.getByText(`1 a 50 de ${N}`)).toBeVisible();
    await page.goto(`/${slugBulk}/${s.path}?label=${bulkLabel}&page=24`);
    await expect(page.getByText(`1151 a ${N} de ${N}`)).toBeVisible();
  }
  await page.context().close();
});

test("sem permissão de criar negócios, o lead não mostra Converter em negócio", async ({ browser }) => {
  const a = admin();
  readerId = await createTestUser({ email: readerEmail, password, fullName: "Leo Sem Criar" });
  const role = await a
    .from("roles")
    .insert({
      name: readerRole,
      permissions: {
        visibility: { leads: "own", deals: "own", persons: "own", organizations: "own", activities: "own" },
        actions: { create: false, edit: true, delete: false, export: false, reassign_owner: false },
        settings: {
          manage_pipelines: false,
          manage_custom_fields: false,
          manage_products: false,
          view_reports: false,
          create_dashboards: false,
          share_dashboards: false,
        },
      },
    })
    .select("id")
    .single();
  if (role.error) throw role.error;
  const m = await a.from("memberships").insert({ user_id: readerId, company_id: companyId, role_id: role.data.id });
  if (m.error) throw m.error;
  const lead = await insert("leads", { company_id: companyId, owner_id: readerId, title: `Lead Leitor ${stamp}` });

  const ctx = await browser.newContext({ baseURL: "http://localhost:3000" });
  const page = await ctx.newPage();
  await login(page, readerEmail, password);
  await page.waitForURL((u) => !u.pathname.startsWith("/entrar"));
  await page.goto(`/${slug}/leads/${lead}`);
  await expect(page.getByTestId("lead-status")).toHaveText("Aberto");
  await expect(page.getByRole("button", { name: "Desqualificar" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Converter em negócio" })).toHaveCount(0);
  await ctx.close();
});
