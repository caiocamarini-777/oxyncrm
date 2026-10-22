import { expect, test, type Browser, type Page } from "@playwright/test";
import { admin, createTestUser, deleteTestUser, login } from "./helpers/auth";

const stamp = Date.now();
const password = "oxyn-test-123";
const slug = `tst-e2e-nt-${stamp}`;
const emails = {
  ana: `tst-e2e-nt-ana-${stamp}@oxyn.test`,
  bruno: `tst-e2e-nt-bruno-${stamp}@oxyn.test`,
  gestor: `tst-e2e-nt-gestor-${stamp}@oxyn.test`,
};
const roleNames = [`tst-e2e-nt-padrao-${stamp}`, `tst-e2e-nt-gestor-${stamp}`];
const ids = { ana: "", bruno: "", gestor: "" };
let companyId = "";
let orgId = "";
let orgPath = "";

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
  const ctx = await browser.newContext({ baseURL: "http://localhost:3000" });
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
  const c = await a.from("companies").insert({ name: `NT ${stamp}`, slug }).select("id").single();
  if (c.error) throw c.error;
  companyId = c.data.id;
  const rp = await a.from("roles").insert({ name: roleNames[0], permissions: permissions(false) }).select("id").single();
  const rg = await a.from("roles").insert({ name: roleNames[1], permissions: permissions(true) }).select("id").single();
  if (rp.error) throw rp.error;
  if (rg.error) throw rg.error;
  const m = await a.from("memberships").insert([
    { user_id: ids.ana, company_id: companyId, role_id: rp.data.id },
    { user_id: ids.bruno, company_id: companyId, role_id: rp.data.id },
    { user_id: ids.gestor, company_id: companyId, role_id: rg.data.id },
  ]);
  if (m.error) throw m.error;
  const o = await a
    .from("organizations")
    .insert({ company_id: companyId, owner_id: ids.ana, name: `Org NT ${stamp}` })
    .select("id")
    .single();
  if (o.error) throw o.error;
  orgId = o.data.id;
  orgPath = `/${slug}/contatos/organizacoes/${orgId}`;
});

test.afterAll(async () => {
  const a = admin();
  if (companyId) await a.from("companies").delete().eq("id", companyId);
  await a.from("roles").delete().in("name", roleNames);
  for (const id of Object.values(ids)) if (id) await deleteTestUser(id).catch(() => {});
});

test("anotação aparece na linha do tempo e só o autor edita", async ({ browser }) => {
  const gestor = await newPage(browser, emails.gestor);
  await gestor.goto(orgPath);
  const save = gestor.getByRole("button", { name: "Salvar anotação" });
  await expect(save).toBeDisabled();
  await gestor.getByLabel("Anotação", { exact: true }).fill("Primeira linha\nvisite https://exemplo.com/a depois");
  await gestor.getByLabel("Anotação", { exact: true }).press("Control+Enter");
  const note = gestor.getByTestId("timeline-note").first();
  await expect(note).toContainText("Primeira linha");
  await expect(note).toContainText("Gestor E2E");
  const link = note.getByRole("link", { name: "https://exemplo.com/a" });
  await expect(link).toHaveAttribute("target", "_blank");
  await expect(link).toHaveAttribute("rel", "noopener noreferrer");
  await expect(note.getByRole("button", { name: "Editar" })).toBeVisible();
  await expect(gestor.getByText("As atividades chegam na próxima fase.")).toBeVisible();

  // edição pelo autor
  await note.getByRole("button", { name: "Editar" }).click();
  await gestor.getByLabel("Editar anotação").fill("Texto editado");
  await note.getByRole("button", { name: "Salvar", exact: true }).click();
  await expect(gestor.getByTestId("timeline-note").first()).toContainText("Texto editado");

  // outra pessoa vê, mas não edita
  const ana = await newPage(browser, emails.ana);
  await ana.goto(orgPath);
  const anaNote = ana.getByTestId("timeline-note").first();
  await expect(anaNote).toContainText("Texto editado");
  await expect(anaNote.getByRole("button", { name: "Editar" })).toHaveCount(0);
  await expect(anaNote.getByRole("button", { name: "Excluir" })).toHaveCount(0);
  await ana.context().close();

  // exclusão pelo autor
  gestor.once("dialog", (d) => void d.accept());
  await gestor.getByTestId("timeline-note").first().getByRole("button", { name: "Excluir" }).click();
  await expect(gestor.getByTestId("timeline-note")).toHaveCount(0);
  await gestor.context().close();
});

test("trocar responsável registra o evento", async ({ browser }) => {
  const gestor = await newPage(browser, emails.gestor);
  await gestor.goto(orgPath);
  await gestor.getByLabel("Responsável").selectOption({ label: "Bruno E2E" });
  await expect(gestor.getByTestId("timeline-event").first()).toContainText(
    "Trocou o responsável de Ana E2E para Bruno E2E",
  );
  await expect(gestor.getByTestId("timeline-event").first()).toContainText("Gestor E2E");
  await gestor.context().close();
});

test("texto com <script> é exibido como texto", async ({ browser }) => {
  const gestor = await newPage(browser, emails.gestor);
  await gestor.goto(orgPath);
  let dialogs = 0;
  gestor.on("dialog", (d) => {
    dialogs++;
    void d.dismiss();
  });
  const payload = `<script>window.__xss=1</script><img src=x onerror="window.__xss=1"> javascript:alert(1)`;
  await gestor.getByLabel("Anotação", { exact: true }).fill(payload);
  await gestor.getByRole("button", { name: "Salvar anotação" }).click();
  const note = gestor.getByTestId("timeline-note").first();
  await expect(note).toContainText(payload);
  await expect(note.locator("script, img")).toHaveCount(0);
  await expect(note.getByRole("link")).toHaveCount(0);
  expect(await gestor.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();
  expect(dialogs).toBe(0);
  await gestor.context().close();
});
