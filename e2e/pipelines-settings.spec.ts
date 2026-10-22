import { expect, test } from "@playwright/test";
import { admin, login } from "./helpers/auth";

const stamp = Date.now();
const slug = `tst-pip-${stamp}`;
const PIPE = `Funil Tst ${stamp}`;
let companyId = "";
let adminId = "";
let pipelineId = "";
let betaId = "";

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  const a = admin();
  const company = await a.from("companies").insert({ name: `Tst Funis ${stamp}`, slug }).select("id").single();
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

async function stageNames(): Promise<string[]> {
  const { data, error } = await admin().from("stages").select("name, position").eq("pipeline_id", pipelineId).order("position");
  if (error) throw error;
  return data.map((s) => s.name);
}

test("cria funil com 3 etapas e reordena arrastando", async ({ page }) => {
  await page.goto(`/configuracoes/funis?empresa=${slug}`);
  await page.getByLabel("Novo funil").fill(PIPE);
  await page.getByRole("button", { name: "Criar funil" }).click();
  const row = page.getByTestId("pipeline-row").filter({ hasText: PIPE });
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: `Editar ${PIPE}` }).click();
  for (const n of ["Alfa", "Beta", "Gama"]) {
    await row.getByLabel("Nova etapa").fill(n);
    await row.getByRole("button", { name: "Adicionar etapa" }).click();
    await expect(row.getByTestId("stage-row").filter({ has: page.locator(`input[value="${n}"]`) })).toBeVisible();
  }
  const p = await admin().from("pipelines").select("id").eq("company_id", companyId).eq("name", PIPE).single();
  if (p.error) throw p.error;
  pipelineId = p.data.id;
  expect(await stageNames()).toEqual(["Alfa", "Beta", "Gama"]);

  // Teclado: foco na alça de Gama, Espaço, seta para cima duas vezes, Espaço.
  const handle = row.getByRole("button", { name: "Arrastar etapa Gama" });
  await handle.focus();
  // Pausas curtas: o dnd-kit precisa de um quadro entre cada tecla para medir e mover.
  await page.keyboard.press("Space");
  await page.waitForTimeout(250);
  await page.keyboard.press("ArrowUp");
  await page.waitForTimeout(250);
  await page.keyboard.press("ArrowUp");
  await page.waitForTimeout(250);
  await page.keyboard.press("Space");
  await expect.poll(stageNames).toEqual(["Gama", "Alfa", "Beta"]);
  await page.reload();
  await page.getByRole("button", { name: `Editar ${PIPE}` }).click();
  const names = await page.getByTestId("stage-row").evaluateAll((els) => els.map((e) => e.getAttribute("data-stage-name")));
  expect(names).toEqual(["Gama", "Alfa", "Beta"]);
  const b = await admin().from("stages").select("id").eq("pipeline_id", pipelineId).eq("name", "Beta").single();
  if (b.error) throw b.error;
  betaId = b.data.id;
});

test("marca Data de fechamento esperada como obrigatória", async ({ page }) => {
  await page.goto(`/configuracoes/funis?empresa=${slug}`);
  await page.getByRole("button", { name: `Editar ${PIPE}` }).click();
  const stage = page.getByTestId("stage-row").filter({ hasText: "Campos obrigatórios" }).nth(1); // Alfa
  await expect(stage.getByLabel("Nome da etapa")).toHaveValue("Alfa");
  await stage.getByText("Campos obrigatórios").click();
  await stage.getByLabel("Data de fechamento esperada").check();
  await stage.getByLabel("Probabilidade (%)").fill("30");
  await stage.getByRole("button", { name: "Salvar etapa Alfa" }).click();
  await expect
    .poll(async () => {
      const { data } = await admin().from("stages").select("required_fields, probability").eq("pipeline_id", pipelineId).eq("name", "Alfa").single();
      return data;
    })
    .toEqual({ required_fields: ["expected_close_date"], probability: 30 });
});

test("probabilidade inválida mostra erro", async ({ page }) => {
  await page.goto(`/configuracoes/funis?empresa=${slug}`);
  await page.getByRole("button", { name: `Editar ${PIPE}` }).click();
  const stage = page.getByTestId("stage-row").nth(2); // Beta
  await stage.getByLabel("Probabilidade (%)").fill("101");
  await stage.getByRole("button", { name: "Salvar etapa Beta" }).click();
  await expect(stage.getByText("A probabilidade vai de 0 a 100.")).toBeVisible();
});

test("excluir etapa com negócio mostra a mensagem", async ({ page }) => {
  const deal = await admin()
    .from("deals")
    .insert({ company_id: companyId, owner_id: adminId, title: `Tst Negócio ${stamp}`, pipeline_id: pipelineId, stage_id: betaId })
    .select("id")
    .single();
  if (deal.error) throw deal.error;
  await page.goto(`/configuracoes/funis?empresa=${slug}`);
  await page.getByRole("button", { name: `Editar ${PIPE}` }).click();
  await page.getByRole("button", { name: "Excluir etapa Beta" }).click();
  await expect(page.getByText("Mova os negócios desta etapa antes de excluí-la.")).toBeVisible();
  expect(await stageNames()).toContain("Beta");
});

test("arquivar funil com negócios funciona", async ({ page }) => {
  await page.goto(`/configuracoes/funis?empresa=${slug}`);
  await page.getByRole("button", { name: `Arquivar ${PIPE}` }).click();
  const row = page.getByTestId("pipeline-row").filter({ hasText: PIPE });
  await expect(row).toHaveAttribute("data-archived", "true");
  const { data } = await admin().from("pipelines").select("archived_at").eq("id", pipelineId).single();
  expect(data?.archived_at).not.toBeNull();
  // Some do seletor do quadro (Tarefa 6 acrescenta a asserção de UI).
  const active = await admin().from("pipelines").select("id").eq("company_id", companyId).is("archived_at", null);
  expect((active.data ?? []).map((r) => r.id)).not.toContain(pipelineId);
});

test("produto: criar, mudar tipo bloqueado quando usado, desativar", async ({ page }) => {
  await page.goto(`/configuracoes/produtos?empresa=${slug}`);
  await page.getByLabel("Novo produto").fill("Implantação");
  await page.getByLabel("Tipo", { exact: true }).selectOption("setup");
  await page.getByLabel("Preço padrão").fill("1.500,00");
  await page.getByRole("button", { name: "Adicionar produto" }).click();
  const row = page.getByTestId("product-row").filter({ hasText: "Implantação" });
  await expect(row).toContainText("Setup");
  const prod = await admin().from("products").select("id, default_price, kind").eq("company_id", companyId).eq("name", "Implantação").single();
  if (prod.error) throw prod.error;
  expect(Number(prod.data.default_price)).toBe(1500);

  // Sem itens, o tipo muda.
  await row.getByRole("button", { name: "Editar Implantação" }).click();
  await page.getByLabel("Tipo de Implantação").selectOption("recurring");
  await page.getByRole("button", { name: "Salvar", exact: true }).click();
  await expect(page.getByTestId("product-row").filter({ hasText: "Implantação" })).toContainText("Recorrente");

  // Com item, bloqueia.
  const dealId = (await admin().from("deals").select("id").eq("company_id", companyId).single()).data!.id;
  const upd = await admin().from("deals").update({ mrr_start: "2026-11-01", contract_months: 12 }).eq("id", dealId);
  if (upd.error) throw upd.error;
  const item = await admin().from("deal_items").insert({ deal_id: dealId, company_id: companyId, product_id: prod.data.id, quantity: 1, unit_price: 100 });
  if (item.error) throw item.error;
  await page.reload();
  await page.getByRole("button", { name: "Editar Implantação" }).click();
  await page.getByLabel("Tipo de Implantação").selectOption("setup");
  await page.getByRole("button", { name: "Salvar", exact: true }).click();
  await expect(page.getByText("O tipo não pode mudar depois de usado em negócios.")).toBeVisible();
  const still = await admin().from("products").select("kind").eq("id", prod.data.id).single();
  expect(still.data?.kind).toBe("recurring");

  await page.getByRole("button", { name: "Cancelar" }).click();
  await page.getByRole("button", { name: "Desativar Implantação" }).click();
  await expect(page.getByTestId("product-row").filter({ hasText: "Implantação" })).toHaveAttribute("data-active", "false");
  const off = await admin().from("products").select("active").eq("id", prod.data.id).single();
  expect(off.data?.active).toBe(false);
});

test("motivos de perda: adicionar e desativar", async ({ page }) => {
  await page.goto(`/configuracoes/motivos-perda?empresa=${slug}`);
  await page.getByLabel("Novo motivo").fill("Preço alto demais");
  await page.getByRole("button", { name: "Adicionar" }).click();
  const row = page.getByTestId("list-item-row").filter({ hasText: "Preço alto demais" });
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "Desativar" }).click();
  await expect(row).toHaveAttribute("data-active", "false");
});

test("campos personalizados têm a aba Negócios", async ({ page }) => {
  await page.goto(`/configuracoes/campos?empresa=${slug}`);
  await page.getByRole("tab", { name: "Negócios" }).click();
  await page.getByRole("button", { name: "Novo campo" }).click();
  await page.getByLabel("Nome do campo").fill("Origem do contrato");
  await page.getByRole("button", { name: "Salvar" }).click();
  await expect(page.getByTestId("custom-field-row").filter({ hasText: "Origem do contrato" })).toBeVisible();
  const { data } = await admin().from("custom_field_defs").select("entity").eq("company_id", companyId).eq("label", "Origem do contrato").single();
  expect(data?.entity).toBe("deals");
});
