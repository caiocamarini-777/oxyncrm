import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { admin, createTestUser, deleteTestUser, login } from "./helpers/auth";

const stamp = Date.now();
const password = "oxyn-test-123";
const slug = `tst-e2e-fcon-${stamp}`;
const adminEmail = `tst-e2e-fcon-admin-${stamp}@oxyn.test`;

let companyId = "";
let userId = "";
let dealId = "";

// Mês de início do MRR: o próximo mês, para o dia 10 ainda estar no futuro.
const now = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
const start = new Date(Date.UTC(now.getFullYear(), now.getMonth() + 1, 1));
const startIso = start.toISOString().slice(0, 10);
const startYm = startIso.slice(0, 7);
const lastDay = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
const day10 = `10/${startIso.slice(5, 7)}/${startIso.slice(0, 4)}`;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  const a = admin();
  userId = await createTestUser({ email: adminEmail, password, fullName: "Ada Contratos", superAdmin: true });
  const c = await a.from("companies").insert({ name: `Financeiro Contratos ${stamp}`, slug }).select("id").single();
  if (c.error) throw c.error;
  companyId = c.data.id;
  const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const si = await s.auth.signInWithPassword({ email: adminEmail, password });
  if (si.error) throw si.error;
  const r = await s.from("companies").update({ finance_enabled: true }).eq("id", companyId).select("id");
  if (r.error || !r.data?.length) throw r.error ?? new Error("empresa não atualizada");

  const ins = async (table: string, row: Record<string, unknown>) => {
    const x = await a.from(table).insert(row).select("id").single();
    if (x.error) throw x.error;
    return x.data.id as string;
  };
  await ins("fin_accounts", { company_id: companyId, name: "Conta Contratos" });
  await ins("fin_expense_categories", { company_id: companyId, name: "Escritório E2E", default_nature: "fixed" });
  const category = await ins("service_categories", { company_id: companyId, name: "Consultoria E2E" });
  const org = await ins("organizations", { company_id: companyId, name: `Cliente E2E ${stamp}`, owner_id: userId });
  const pipe = await ins("pipelines", { company_id: companyId, name: "Funil E2E", position: 0 });
  const stage = await ins("stages", { company_id: companyId, pipeline_id: pipe, name: "Entrada", position: 0 });
  dealId = await ins("deals", {
    company_id: companyId,
    owner_id: userId,
    pipeline_id: pipe,
    stage_id: stage,
    position: 1024,
    title: `Negócio E2E ${stamp}`,
    organization_id: org,
    service_category_id: category,
    mrr: 5000,
    mrr_start: startIso,
    contract_months: 12,
  });
  // O contrato rascunho nasce no UPDATE do status (gatilho).
  const w = await a.from("deals").update({ status: "won" }).eq("id", dealId);
  if (w.error) throw w.error;
});

test.afterAll(async () => {
  const a = admin();
  if (companyId) await a.from("companies").delete().eq("id", companyId);
  if (userId) await deleteTestUser(userId).catch(() => {});
});

test("1) configurações: informar saldo de uma conta e criar categoria", async ({ page }) => {
  await login(page, adminEmail, password);
  await page.waitForURL((u) => !u.pathname.startsWith("/entrar"));
  await page.goto(`/${slug}/financeiro/configuracoes`);
  await page.getByRole("button", { name: "Informar saldo de Conta Contratos" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Saldo", { exact: true }).fill("12.000,00");
  await dialog.getByRole("button", { name: "Salvar saldo" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText(/Saldo .*12\.000,00/)).toBeVisible();

  // categoria de receita em uma linha
  await page.getByLabel("Nova categoria de receita").fill("Parcerias E2E");
  await page.getByRole("button", { name: "Adicionar categoria" }).last().click();
  await expect(page.getByLabel("Nome de Parcerias E2E")).toBeVisible();
});

test("2) contrato pendente: falta de dados, ativação e lançamento no mês; despesa recorrente", async ({ page }) => {
  await login(page, adminEmail, password);
  await page.waitForURL((u) => !u.pathname.startsWith("/entrar"));

  // 1) o rascunho aparece em Pendentes
  await page.goto(`/${slug}/financeiro/contratos`);
  await expect(page.getByRole("link", { name: "Pendentes (1)" })).toBeVisible();
  await page.getByRole("link", { name: `Negócio E2E ${stamp}` }).click();
  await expect(page.getByLabel("Título")).toHaveValue(`Negócio E2E ${stamp}`);

  // 2) ativar sem preencher
  await page.getByRole("button", { name: "Ativar", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Faltam:" })).toHaveText(
    "Faltam: Dia de vencimento, Conta, Regra de fim de vigência",
  );

  // 2b) linha de comissão: só ela mostra os campos de %; salva e persiste
  await expect(page.getByLabel("% sobre o recorrente (linha 1)")).toHaveCount(0);
  await page.getByRole("button", { name: "Adicionar linha" }).click();
  await page.getByLabel("Tipo (linha 2)").selectOption({ label: "Comissão" });
  await page.getByLabel("Descrição (linha 2)").fill("Comissão E2E");
  await page.getByLabel("Categoria de serviço (linha 2)").selectOption({ label: "Consultoria E2E" });
  await page.getByRole("button", { name: "Salvar", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Linha 2: Informe ao menos um percentual." })).toBeVisible();
  await page.getByLabel("% sobre o recorrente (linha 2)").fill("10");
  await page.getByRole("button", { name: "Salvar", exact: true }).click();
  await expect(page.getByText("Contrato salvo.")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Descrição (linha 2)")).toHaveValue("Comissão E2E");
  await expect(page.getByLabel("% sobre o recorrente (linha 2)")).toHaveValue("10");

  // 3) preencher e ativar
  await page.getByLabel("Dia de vencimento").fill("10");
  await page.getByLabel("Conta", { exact: true }).selectOption({ label: "Conta Contratos" });
  await page.getByLabel("Regra de fim de vigência").selectOption({ label: "Renova automaticamente" });
  await page.getByRole("button", { name: "Ativar", exact: true }).click();
  await expect(page.getByText("Ativo", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Ativar", exact: true })).toHaveCount(0);

  // 4) a entrada de 5.000 no dia 10 do mês de início
  await page.goto(`/${slug}/financeiro?from=${startYm}-01&to=${lastDay}`);
  await expect(page.getByText(day10).first()).toBeVisible();
  await expect(page.getByText(/5\.000,00/).first()).toBeVisible();

  // 5) despesa recorrente "Aluguel"
  await page.goto(`/${slug}/financeiro/despesas`);
  await page.getByRole("button", { name: "Nova despesa" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Descrição").fill("Aluguel");
  await dialog.getByLabel("Categoria").selectOption({ label: "Escritório E2E" });
  await dialog.getByLabel("Natureza").selectOption({ label: "Fixa" });
  await dialog.getByLabel("Valor", { exact: true }).fill("4.674,11");
  await dialog.getByLabel("Dia de vencimento").fill("1");
  await dialog.getByLabel("Mês inicial").fill(startYm);
  await dialog.getByRole("button", { name: "Salvar" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("cell", { name: "Aluguel" })).toBeVisible();

  await page.goto(`/${slug}/financeiro?from=${startYm}-01&to=${lastDay}`);
  await expect(page.getByText("Aluguel").first()).toBeVisible();
  await expect(page.getByText(/4\.674,11/).first()).toBeVisible();
});
