import { expect, test, type Browser, type Locator, type Page } from "@playwright/test";
import { admin, createTestUser, deleteTestUser, login } from "./helpers/auth";
import { withoutTriggers } from "./helpers/db";

const stamp = Date.now();
const password = "oxyn-test-123";
const slug = `tst-e2e-kb-${stamp}`;
const companyName = `Kanban E2E ${stamp}`;
const adminEmail = `tst-e2e-kb-admin-${stamp}@oxyn.test`;
const userEmail = `tst-e2e-kb-padrao-${stamp}@oxyn.test`;
const PIPE = `Funil Kanban ${stamp}`;
const PIPE_MRR = `Funil MRR ${stamp}`;
const PIPE_ARCHIVED = `Funil Arquivado ${stamp}`;

let companyId = "";
let adminId = "";
let userId = "";
const pipe: Record<string, string> = {};
const stage: Record<string, string> = {};
const deal: Record<string, string> = {};
let reasonName = "";

test.describe.configure({ mode: "serial" });

async function insert<T extends Record<string, unknown>>(table: string, row: T): Promise<string> {
  const r = await admin().from(table).insert(row).select("id").single();
  if (r.error) throw r.error;
  return r.data.id as string;
}

let pos = 0;
async function mkDeal(key: string, row: Record<string, unknown>) {
  pos += 1024;
  deal[key] = await insert("deals", {
    company_id: companyId,
    owner_id: adminId,
    pipeline_id: pipe.main,
    position: pos,
    ...row,
  });
}

test.beforeAll(async () => {
  adminId = await createTestUser({ email: adminEmail, password, fullName: "Ada Kanban", superAdmin: true });
  userId = await createTestUser({ email: userEmail, password, fullName: "Paulo Padrão" });
  companyId = await insert("companies", { name: companyName, slug });
  const a = admin();
  const role = await a.from("roles").select("id").eq("name", "Usuário padrão").single();
  if (role.error) throw role.error;
  const m = await a.from("memberships").insert({ user_id: userId, company_id: companyId, role_id: role.data.id });
  if (m.error) throw m.error;

  pipe.main = await insert("pipelines", { company_id: companyId, name: PIPE, position: -2 });
  pipe.mrr = await insert("pipelines", { company_id: companyId, name: PIPE_MRR, position: -1, card_value_field: "mrr" });
  pipe.archived = await insert("pipelines", {
    company_id: companyId,
    name: PIPE_ARCHIVED,
    position: -3,
    archived_at: new Date().toISOString(),
  });
  const mkStage = async (key: string, pipelineId: string, name: string, position: number, extra: Record<string, unknown> = {}) => {
    stage[key] = await insert("stages", { company_id: companyId, pipeline_id: pipelineId, name, position, ...extra });
  };
  await mkStage("entrada", pipe.main, "Entrada", 0, { probability: 10 });
  await mkStage("proposta", pipe.main, "Proposta", 1, { probability: 40, required_fields: ["expected_close_date"] });
  await mkStage("negociacao", pipe.main, "Negociação", 2, { probability: 70 });
  await mkStage("esfria", pipe.main, "Parado", 3, { probability: 80, rotting_days: 3 });
  await mkStage("unica", pipe.mrr, "Recorrência", 0);
  await mkStage("arq", pipe.archived, "Velha", 0);

  await mkDeal("move", { stage_id: stage.entrada, title: `Mover ${stamp}` });
  await mkDeal("req", { stage_id: stage.entrada, title: `Obrigatorio ${stamp}` });
  await mkDeal("won", { stage_id: stage.entrada, title: `Ganhar ${stamp}` });
  await mkDeal("lost", { stage_id: stage.entrada, title: `Perder ${stamp}` });
  await mkDeal("trash", { stage_id: stage.entrada, title: `Excluir ${stamp}` });
  await mkDeal("other", { stage_id: stage.entrada, title: `Outra pessoa ${stamp}` });
  await mkDeal("neg", { stage_id: stage.negociacao, title: `Negociando ${stamp}` });
  await mkDeal("rot", { stage_id: stage.esfria, title: `Esfriando ${stamp}` });
  await mkDeal("fresh", { stage_id: stage.esfria, title: `Recente ${stamp}` });
  await mkDeal("mine", { stage_id: stage.negociacao, title: `Do Paulo ${stamp}`, owner_id: userId });
  const mrrStart = "2026-11-01";
  await mkDeal("mrr1", {
    pipeline_id: pipe.mrr,
    stage_id: stage.unica,
    title: `MRR Um ${stamp}`,
    mrr: 1000,
    mrr_start: mrrStart,
    contract_months: 12,
    estimated_value: 900000,
  });
  await mkDeal("mrr2", {
    pipeline_id: pipe.mrr,
    stage_id: stage.unica,
    title: `MRR Dois ${stamp}`,
    mrr: 2500,
    mrr_start: mrrStart,
    contract_months: 6,
  });

  const old = new Date(Date.now() - 10 * 86_400_000).toISOString();
  await withoutTriggers((sql) => sql`update public.deals set stage_entered_at = ${old} where id = ${deal.rot}`);

  const reason = await a
    .from("lost_reasons")
    .select("name")
    .eq("company_id", companyId)
    .eq("active", true)
    .order("position")
    .limit(1)
    .single();
  if (reason.error) throw reason.error;
  reasonName = reason.data.name;
});

test.afterAll(async () => {
  if (companyId) await admin().from("companies").delete().eq("id", companyId);
  for (const id of [adminId, userId]) if (id) await deleteTestUser(id).catch(() => {});
});

async function newPage(browser: Browser, email = adminEmail): Promise<Page> {
  const ctx = await browser.newContext({ baseURL: "http://localhost:3000" });
  const page = await ctx.newPage();
  await login(page, email, password);
  await page.waitForURL((u) => !u.pathname.startsWith("/entrar"));
  return page;
}

// Seletor CSS (e não por papel): com um diálogo aberto o resto da página fica aria-hidden.
const column = (page: Page, name: string) => page.locator(`[data-testid="kanban-column"][aria-label="${name}"]`);
const card = (scope: Page | Locator, title: string) => scope.getByTestId("deal-card").filter({ hasText: title });
const titlesIn = (page: Page, name: string) => column(page, name).getByTestId("deal-title").allTextContents();

async function openBoard(page: Page, pipelineId = pipe.main) {
  await page.goto(`/${slug}/negocios?funil=${pipelineId}`);
  await expect(page.getByRole("heading", { level: 1, name: "Negócios" })).toBeVisible();
  await expect(page.getByTestId("kanban-column").first()).toBeVisible();
}

/** Arrasta com o mouse em passos (o sensor de ponteiro só ativa depois de 6 px). */
async function drag(
  page: Page,
  source: Locator,
  target: () => Locator,
  where: "center" | "top" = "center",
  during?: () => Promise<void>,
) {
  const s = await source.boundingBox();
  if (!s) throw new Error("card sem caixa");
  const sx = s.x + s.width / 2;
  const sy = s.y + s.height / 2;
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await page.mouse.move(sx + 12, sy + 12, { steps: 4 });
  const t = await target().boundingBox();
  if (!t) throw new Error("destino sem caixa");
  const tx = t.x + t.width / 2;
  const ty = where === "top" ? t.y + 6 : t.y + t.height / 2;
  await page.mouse.move(tx, ty, { steps: 20 });
  await page.waitForTimeout(150);
  await page.mouse.move(tx + 1, ty + 1, { steps: 2 });
  await page.waitForTimeout(150);
  if (during) await during();
  await page.mouse.up();
}

test("funil arquivado não aparece no seletor", async ({ browser }) => {
  const page = await newPage(browser);
  await page.goto(`/${slug}/negocios`);
  const options = page.getByLabel("Funil", { exact: true }).locator("option");
  await expect(options.filter({ hasText: PIPE })).toHaveCount(1);
  await expect(options.filter({ hasText: PIPE_MRR })).toHaveCount(1);
  await expect(options.filter({ hasText: PIPE_ARCHIVED })).toHaveCount(0);
  // Padrão: o primeiro funil não arquivado (o arquivado tem posição menor).
  await expect(column(page, "Entrada")).toBeVisible();
  await page.context().close();
});

test("arrastar para outra etapa persiste a etapa e a ordem", async ({ browser }) => {
  const page = await newPage(browser);
  await openBoard(page);
  const title = `Mover ${stamp}`;
  await drag(page, card(page, title), () => card(page, `Negociando ${stamp}`), "top");
  await expect(card(column(page, "Negociação"), title)).toBeVisible();
  await expect(card(column(page, "Entrada"), title)).toHaveCount(0);
  await expect.poll(async () => (await admin().from("deals").select("stage_id").eq("id", deal.move).single()).data?.stage_id).toBe(
    stage.negociacao,
  );
  await page.reload();
  await expect(card(column(page, "Negociação"), title)).toBeVisible();
  const titles = await titlesIn(page, "Negociação");
  expect(titles.indexOf(title)).toBeLessThan(titles.indexOf(`Negociando ${stamp}`));
  expect(titles.filter((t) => t === title)).toHaveLength(1);
  await page.context().close();
});

test("campo obrigatório faltando abre o modal e completa o movimento", async ({ browser }) => {
  const page = await newPage(browser);
  await openBoard(page);
  const title = `Obrigatorio ${stamp}`;
  await drag(page, card(page, title), () => column(page, "Proposta"));
  const dialog = page.getByRole("dialog", { name: "Campos obrigatórios" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Para mover para Proposta, preencha:");
  // O card voltou para a etapa de origem.
  await expect(card(column(page, "Entrada"), title)).toBeVisible();
  await expect(dialog.getByLabel("Pessoa")).toHaveCount(0);
  await dialog.getByLabel("Data de fechamento esperada").fill("2026-12-15");
  await dialog.getByRole("button", { name: "Salvar e mover" }).click();
  await expect(dialog).toBeHidden();
  const moved = card(column(page, "Proposta"), title);
  await expect(moved).toBeVisible();
  // O tremor da recusa não se repete quando o card remonta na etapa de destino.
  await expect(moved).toHaveAttribute("data-shaking", "false");
  // O foco volta para o card ao fechar o diálogo.
  await expect(moved.getByTestId("deal-title")).toBeFocused();
  const d = await admin().from("deals").select("stage_id, expected_close_date").eq("id", deal.req).single();
  expect(d.data).toEqual({ stage_id: stage.proposta, expected_close_date: "2026-12-15" });
  await page.context().close();
});

test("soltar em Perdido exige motivo", async ({ browser }) => {
  const page = await newPage(browser);
  await openBoard(page);
  const title = `Perder ${stamp}`;
  await drag(page, card(page, title), () => page.getByTestId("drop-lost"));
  const dialog = page.getByRole("dialog", { name: "Marcar como perdido" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Marcar como perdido" }).click();
  await expect(dialog.getByRole("alert").filter({ hasText: "Escolha um motivo." })).toBeVisible();
  await dialog.getByLabel("Motivo").selectOption({ label: reasonName });
  await dialog.getByLabel("Observação").fill("Preço alto");
  await dialog.getByRole("button", { name: "Marcar como perdido" }).click();
  await expect(dialog).toBeHidden();
  await expect(card(page, title)).toHaveCount(0);
  const d = await admin().from("deals").select("status, lost_note").eq("id", deal.lost).single();
  expect(d.data).toEqual({ status: "lost", lost_note: "Preço alto" });
  await page.context().close();
});

test("soltar em Ganho marca ganho e tira do quadro", async ({ browser }) => {
  const page = await newPage(browser);
  await openBoard(page);
  const title = `Ganhar ${stamp}`;
  await drag(page, card(page, title), () => page.getByTestId("drop-won"));
  await expect(page.getByText("Negócio marcado como ganho.")).toBeVisible();
  await expect(card(page, title)).toHaveCount(0);
  await expect.poll(async () => (await admin().from("deals").select("status").eq("id", deal.won).single()).data?.status).toBe("won");
  await page.reload();
  await expect(column(page, "Entrada")).toBeVisible();
  await expect(card(page, title)).toHaveCount(0);
  await page.context().close();
});

test("soltar em Excluir manda para a lixeira", async ({ browser }) => {
  const page = await newPage(browser);
  await openBoard(page);
  const title = `Excluir ${stamp}`;
  await drag(page, card(page, title), () => page.getByTestId("drop-trash"));
  await expect(page.getByText("Negócio movido para a lixeira.")).toBeVisible();
  await expect(card(page, title)).toHaveCount(0);
  await expect
    .poll(async () => (await admin().from("deals").select("deleted_at").eq("id", deal.trash).single()).data?.deleted_at)
    .not.toBeNull();
  await page.context().close();
});

test("usuário padrão só vê os próprios cards", async ({ browser }) => {
  const page = await newPage(browser, userEmail);
  await openBoard(page);
  await expect(card(page, `Do Paulo ${stamp}`)).toBeVisible();
  await expect(card(page, `Negociando ${stamp}`)).toHaveCount(0);
  await expect(page.getByTestId("deal-card")).toHaveCount(1);
  // Sem permissão de excluir, a zona Excluir não aparece durante o arraste.
  await drag(page, card(page, `Do Paulo ${stamp}`), () => column(page, "Negociação"), "center", async () => {
    await expect(page.getByTestId("drop-won")).toBeVisible();
    await expect(page.getByTestId("drop-trash")).toHaveCount(0);
  });
  await page.context().close();
});

test("card movido por outra pessoa aparece na nova etapa após atualizar", async ({ browser }) => {
  test.setTimeout(90_000);
  const page = await newPage(browser);
  await openBoard(page);
  const title = `Outra pessoa ${stamp}`;
  await expect(card(column(page, "Entrada"), title)).toBeVisible();
  const up = await admin().from("deals").update({ stage_id: stage.negociacao, position: 999_999 }).eq("id", deal.other);
  if (up.error) throw up.error;
  // Atualização periódica (30 s com a aba visível), sem recarregar a página.
  await expect(card(column(page, "Negociação"), title)).toBeVisible({ timeout: 45_000 });
  await expect(card(page, title)).toHaveCount(1);
  const titles = await titlesIn(page, "Negociação");
  expect(titles[titles.length - 1]).toBe(title);
  await page.context().close();
});

test("soma da coluna usa o campo do card do funil", async ({ browser }) => {
  const page = await newPage(browser);
  await openBoard(page, pipe.mrr);
  const col = column(page, "Recorrência");
  await expect(col.getByTestId("column-count")).toHaveText("2");
  // MRR 1.000 + 2.500 (o valor estimado e o total do contrato não entram).
  await expect(col.getByTestId("column-sum")).toHaveText(/^R\$\s3,5\smil$/);
  await expect(card(col, `MRR Um ${stamp}`)).toContainText(/R\$\s1\.000,00/);
  await page.context().close();
});

test("selo esfriando", async ({ browser }) => {
  const page = await newPage(browser);
  await openBoard(page);
  await expect(card(page, `Esfriando ${stamp}`).getByText("Esfriando", { exact: true })).toBeVisible();
  await expect(card(page, `Recente ${stamp}`).getByText("Esfriando", { exact: true })).toHaveCount(0);
  await page.context().close();
});

test("visão Todas as empresas pede a empresa para abrir o kanban", async ({ browser }) => {
  const page = await newPage(browser);
  await page.goto("/todas/negocios");
  await expect(page.getByRole("heading", { level: 1, name: "Negócios" })).toBeVisible();
  await page.getByRole("radio", { name: "Kanban" }).click();
  await page.getByRole("button", { name: companyName, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/${slug}/negocios`));
  await expect(page.getByTestId("kanban-column").first()).toBeVisible();
  await page.context().close();
});
