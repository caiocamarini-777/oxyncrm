import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { admin, createTestUser, deleteTestUser, login } from "./helpers/auth";

const stamp = Date.now();
const password = "oxyn-test-123";
const slug = `tst-e2e-fvw-${stamp}`;
const adminEmail = `tst-e2e-fvw-admin-${stamp}@oxyn.test`;

let companyId = "";
let userId = "";
let orgA = "";

const today = new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
const month = `${today.slice(0, 7)}-01`;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  const a = admin();
  userId = await createTestUser({ email: adminEmail, password, fullName: "Ada Visões", superAdmin: true });
  const c = await a.from("companies").insert({ name: `Financeiro Visões ${stamp}`, slug }).select("id").single();
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
  const account = await ins("fin_accounts", { company_id: companyId, name: "Conta Visões" });
  const expenseCat = await ins("fin_expense_categories", { company_id: companyId, name: "Escritório Visões", default_nature: "fixed" });
  const catA = await ins("service_categories", { company_id: companyId, name: "Serviço Alfa" });
  const catB = await ins("service_categories", { company_id: companyId, name: "Serviço Beta" });
  orgA = await ins("organizations", { company_id: companyId, name: `Cliente A ${stamp}`, owner_id: userId });
  const orgB = await ins("organizations", { company_id: companyId, name: `Cliente B ${stamp}`, owner_id: userId });

  // Contratos ativos: as linhas geram os lançamentos mensais (gatilho).
  for (const [org, title, amount, cat] of [
    [orgA, "Contrato A", 60000, catA],
    [orgB, "Contrato B", 40000, catB],
  ] as const) {
    const contract = await ins("fin_contracts", {
      company_id: companyId,
      organization_id: org,
      title,
      status: "active",
      due_day: 28,
      account_id: account,
      end_rule: "ends",
    });
    await ins("fin_contract_lines", {
      company_id: companyId,
      contract_id: contract,
      kind: "recurring",
      description: "Mensalidade",
      service_category_id: cat,
      amount,
      first_month: month,
      months: 12,
    });
  }
  await ins("fin_entries", {
    company_id: companyId,
    direction: "out",
    source_kind: "manual",
    due_date: today,
    competence: month,
    gross: 50000,
    nature: "fixed",
    expense_category_id: expenseCat,
    account_id: account,
    description: "Aluguel Visões",
  });
});

test.afterAll(async () => {
  const a = admin();
  if (companyId) await a.from("companies").delete().eq("id", companyId);
  if (userId) await deleteTestUser(userId).catch(() => {});
});

test("Clientes, Projeção, Custos e Serviços", async ({ page }) => {
  await login(page, adminEmail, password);
  await page.waitForURL((u) => !u.pathname.startsWith("/entrar"));

  // Clientes: 60% e 40%
  await page.goto(`/${slug}/financeiro/clientes`);
  await expect(page.getByRole("row", { name: new RegExp(`Cliente A ${stamp}`) })).toContainText("60,0%");
  await expect(page.getByRole("row", { name: new RegExp(`Cliente B ${stamp}`) })).toContainText("40,0%");
  await expect(page.getByRole("row", { name: new RegExp(`Cliente A ${stamp}`) })).toContainText("60.000,00");

  // Projeção de 12 meses: 12 colunas
  await page.goto(`/${slug}/financeiro/projecao`);
  await expect(page.getByTestId("proj-month")).toHaveCount(12);
  await expect(page.getByRole("rowheader", { name: "Saldo no fim do mês" })).toBeVisible();
  await expect(page.getByText("Informe o saldo de uma conta em Configurações › Contas para ver o saldo projetado.")).toBeVisible();

  // Custos: ponto de equilíbrio = custo fixo (sem variável); sem saldo, cobertura "—"
  await page.goto(`/${slug}/financeiro/custos`);
  const be = page.locator("div.rounded-xl", { has: page.getByText("Ponto de equilíbrio", { exact: true }) }).first();
  await expect(be).toContainText("50.000,00");
  const cov = page.locator("div.rounded-xl", { has: page.getByText("Cobertura", { exact: true }) }).first();
  await expect(cov).toContainText("—");
  await expect(page.getByRole("rowheader", { name: "Escritório Visões" })).toBeVisible();

  // Serviços: sem filtro, as duas categorias; filtrando pelo Cliente A, só a dele
  await page.goto(`/${slug}/financeiro/servicos`);
  await expect(page.getByRole("rowheader", { name: "Serviço Alfa" })).toBeVisible();
  await expect(page.getByRole("rowheader", { name: "Serviço Beta" })).toBeVisible();
  await page.goto(`/${slug}/financeiro/servicos?clients=${orgA}`);
  await expect(page.getByRole("rowheader", { name: "Serviço Alfa" })).toBeVisible();
  await expect(page.getByRole("rowheader", { name: "Serviço Beta" })).toHaveCount(0);
});
