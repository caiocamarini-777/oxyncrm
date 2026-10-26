import { expect, test } from "@playwright/test";
import { admin, login } from "./helpers/auth";

const stamp = Date.now();
const slug = `tst-cfg-${stamp}`;
let companyId = "";
let adminId = "";

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  const a = admin();
  const company = await a.from("companies").insert({ name: `Tst Config ${stamp}`, slug }).select("id").single();
  if (company.error) throw company.error;
  companyId = company.data.id;
  const profile = await a.from("profiles").select("id").eq("email", "admin@oxyn.test").single();
  if (profile.error) throw profile.error;
  adminId = profile.data.id;
});

test.afterAll(async () => {
  if (companyId) await admin().from("companies").delete().eq("id", companyId);
});

test.beforeEach(async ({ page }) => {
  await login(page, "admin@oxyn.test", "oxyn-dev-123");
  await page.waitForURL((u) => !u.pathname.startsWith("/entrar"));
});

test("cria campo de seleção em organizações", async ({ page }) => {
  await page.goto(`/configuracoes/campos?empresa=${slug}`);
  await page.getByRole("button", { name: "Novo campo" }).click();
  await page.getByLabel("Nome do campo").fill("Porte da empresa");
  await page.getByLabel("Tipo").selectOption("select");
  await page.getByLabel("Opções (uma por linha)").fill("Pequeno\nMédio\nGrande");
  await page.getByRole("button", { name: "Salvar" }).click();
  const row = page.getByTestId("custom-field-row").filter({ hasText: "Porte da empresa" });
  await expect(row).toBeVisible();
  await expect(row).toContainText("Seleção única");
  await expect(row).toContainText("Pequeno, Médio, Grande");
  const { data } = await admin()
    .from("custom_field_defs")
    .select("key, entity")
    .eq("company_id", companyId)
    .eq("label", "Porte da empresa")
    .single();
  expect(data).toEqual({ key: "porte_da_empresa", entity: "organizations" });
});

test("arquivar campo esconde da lista ativa e mantém o valor", async ({ page }) => {
  const a = admin();
  const org = await a
    .from("organizations")
    .insert({
      company_id: companyId,
      owner_id: adminId,
      name: `Tst Org ${stamp}`,
      custom_fields: { porte_da_empresa: "Médio" },
    })
    .select("id")
    .single();
  if (org.error) throw org.error;

  await page.goto(`/configuracoes/campos?empresa=${slug}`);
  const row = page.getByTestId("custom-field-row").filter({ hasText: "Porte da empresa" });
  await row.getByRole("button", { name: "Arquivar" }).click();
  await expect(row).toHaveAttribute("data-archived", "true");
  await expect(row.getByText("Arquivado")).toBeVisible();

  const stored = await a.from("organizations").select("custom_fields").eq("id", org.data.id).single();
  expect(stored.data?.custom_fields).toEqual({ porte_da_empresa: "Médio" });
  const def = await a
    .from("custom_field_defs")
    .select("archived_at")
    .eq("company_id", companyId)
    .eq("key", "porte_da_empresa")
    .single();
  expect(def.data?.archived_at).not.toBeNull();

  // Arquivado: some do detalhe da organização, mas o valor segue no banco.
  await page.goto(`/${slug}/contatos/organizacoes/${org.data.id}`);
  await expect(page.getByLabel("Nome", { exact: true })).toHaveValue(`Tst Org ${stamp}`);
  await expect(page.getByText("Porte da empresa")).toHaveCount(0);
  await page.goto(`/configuracoes/campos?empresa=${slug}`);

  await row.getByRole("button", { name: "Restaurar" }).click();
  await expect(row).toHaveAttribute("data-archived", "false");
  const after = await a.from("organizations").select("custom_fields").eq("id", org.data.id).single();
  expect(after.data?.custom_fields).toEqual({ porte_da_empresa: "Médio" });

  // Restaurado: volta ao detalhe com o valor.
  await page.goto(`/${slug}/contatos/organizacoes/${org.data.id}`);
  await expect(page.getByLabel("Porte da empresa")).toHaveValue("Médio");
});

test("cria etiqueta e não aceita nome repetido", async ({ page }) => {
  await page.goto(`/configuracoes/etiquetas?empresa=${slug}`);
  await page.getByLabel("Nome da etiqueta").fill("Cliente VIP");
  await page.getByRole("radio", { name: "Roxo" }).first().click();
  await page.getByRole("button", { name: "Criar etiqueta" }).click();
  await expect(page.getByTestId("label-row").filter({ hasText: "Cliente VIP" })).toBeVisible();
  await page.getByLabel("Nome da etiqueta").fill("Cliente VIP");
  await page.getByRole("button", { name: "Criar etiqueta" }).click();
  await expect(page.getByText("Já existe uma etiqueta com esse nome.")).toBeVisible();
  await expect(page.getByTestId("label-row").filter({ hasText: "Cliente VIP" })).toHaveCount(1);
  const { data } = await admin().from("labels").select("color").eq("company_id", companyId).eq("name", "Cliente VIP");
  expect(data).toEqual([{ color: "purple" }]);
});

test("desativar origem mantém o lead com a origem e marca como inativa", async ({ page }) => {
  // Task 9 acrescenta a asserção no formulário de lead.
  const a = admin();
  const source = await a
    .from("lead_sources")
    .select("id, name")
    .eq("company_id", companyId)
    .order("position")
    .limit(1)
    .single();
  if (source.error) throw source.error;
  const lead = await a
    .from("leads")
    .insert({ company_id: companyId, owner_id: adminId, title: `Tst Lead ${stamp}`, source_id: source.data.id })
    .select("id")
    .single();
  if (lead.error) throw lead.error;

  await page.goto(`/configuracoes/origens?empresa=${slug}`);
  const row = page.getByTestId("list-item-row").filter({ hasText: source.data.name }).first();
  await row.getByRole("button", { name: "Desativar" }).click();
  await expect(row).toHaveAttribute("data-active", "false");
  await expect(row.getByText("Inativo")).toBeVisible();

  const src = await a.from("lead_sources").select("active").eq("id", source.data.id).single();
  expect(src.data?.active).toBe(false);
  const after = await a.from("leads").select("source_id").eq("id", lead.data.id).single();
  expect(after.data?.source_id).toBe(source.data.id);

  await row.getByRole("button", { name: "Ativar" }).click();
  await expect(row).toHaveAttribute("data-active", "true");
});

test("renomeia e reordena motivo de desqualificação", async ({ page }) => {
  await page.goto(`/configuracoes/motivos?empresa=${slug}`);
  await page.getByLabel("Novo motivo").fill("Prazo incompatível");
  await page.getByRole("button", { name: "Adicionar" }).click();
  const rows = page.getByTestId("list-item-row");
  await expect(rows.last()).toContainText("Prazo incompatível");
  await page.getByRole("button", { name: "Subir Prazo incompatível" }).click();
  await expect(rows.last()).not.toContainText("Prazo incompatível");
  await rows.filter({ hasText: "Prazo incompatível" }).getByRole("button", { name: "Renomear" }).click();
  await page.getByLabel("Novo nome de Prazo incompatível").fill("Prazo longo");
  await page.getByRole("button", { name: "Salvar" }).click();
  await expect(rows.filter({ hasText: "Prazo longo" })).toBeVisible();
});
