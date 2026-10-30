import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { admin, createTestUser, deleteTestUser, login } from "./helpers/auth";

const stamp = Date.now();
const password = "oxyn-test-123";
const slug = `tst-e2e-fvig-${stamp}`;
const adminEmail = `tst-e2e-fvig-admin-${stamp}@oxyn.test`;

let companyId = "";
let userId = "";

const today = new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
const ym = (delta: number) => {
  const [y, m] = today.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + delta, 1)).toISOString().slice(0, 7);
};
// Início: dia 10 do mês que vem (sempre no futuro); fim: dois meses depois.
const startDate = `${ym(1)}-10`;
const endDate = `${ym(3)}-10`;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  const a = admin();
  userId = await createTestUser({ email: adminEmail, password, fullName: "Ada Vigências", superAdmin: true });
  const c = await a.from("companies").insert({ name: `Financeiro Vigências ${stamp}`, slug }).select("id").single();
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
  const acc = await ins("fin_accounts", { company_id: companyId, name: "Conta Vigências" });
  await ins("fin_balance_snapshots", { company_id: companyId, account_id: acc, as_of: today, balance: 1000 });
  await ins("fin_income_categories", { company_id: companyId, name: "Mensalidades E2E" });
  const contract = await ins("fin_contracts", { company_id: companyId, title: `Contrato Vigência ${stamp}`, status: "draft" });
  void contract;
});

test.afterAll(async () => {
  const a = admin();
  if (companyId) await a.from("companies").delete().eq("id", companyId);
  if (userId) await deleteTestUser(userId).catch(() => {});
});

test("1) entrada mensal com início e fim aparece no mês; sem fim, avisa", async ({ page }) => {
  await login(page, adminEmail, password);
  await page.waitForURL((u) => !u.pathname.startsWith("/entrar"));
  await page.goto(`/${slug}/financeiro?from=${ym(1)}-01&to=${ym(1)}-28`);

  await page.getByRole("button", { name: "Novo lançamento" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("radio", { name: "Entrada" }).click();
  await dialog.getByLabel("Descrição").fill("Mensalidade E2E");
  await dialog.getByLabel("Valor", { exact: true }).fill("2.000,00");
  await dialog.getByLabel("Categoria").selectOption({ label: "Mensalidades E2E" });
  await dialog.getByLabel("Periodicidade").selectOption({ label: "Mensal" });
  await dialog.getByLabel("Início").fill(startDate);

  // sem fim: o erro aparece e nada é gravado
  await dialog.getByRole("button", { name: "Salvar" }).click();
  await expect(dialog.getByText("Informe o fim.")).toBeVisible();

  await dialog.getByLabel("Fim").fill(endDate);
  await dialog.getByRole("button", { name: "Salvar" }).click();
  await expect(dialog).toHaveCount(0);

  await page.goto(`/${slug}/financeiro?from=${ym(1)}-01&to=${ym(1)}-28`);
  await expect(page.getByText("Mensalidade E2E").first()).toBeVisible();
  await expect(page.getByText(/2\.000,00/).first()).toBeVisible();

  // são 3 meses (início a fim), nem mais nem menos
  const a = admin();
  const n = await a.from("fin_entries").select("id", { count: "exact", head: true }).eq("company_id", companyId).eq("description", "Mensalidade E2E");
  expect(n.count).toBe(3);

  // a aba Recorrentes lista o item com sentido, início e fim
  await page.goto(`/${slug}/financeiro/despesas`);
  const row = page.getByRole("row", { name: /Mensalidade E2E/ });
  await expect(row).toContainText("Entrada");
  await expect(row).toContainText(`${ym(1).slice(5)}/${ym(1).slice(0, 4)}`);
  await expect(row).toContainText(`${ym(3).slice(5)}/${ym(3).slice(0, 4)}`);
});

test("2) linha de contrato com início e fim grava 12 meses e mostra a vigência", async ({ page }) => {
  await login(page, adminEmail, password);
  await page.waitForURL((u) => !u.pathname.startsWith("/entrar"));
  await page.goto(`/${slug}/financeiro/contratos`);
  await page.getByRole("link", { name: `Contrato Vigência ${stamp}` }).click();

  await page.getByRole("button", { name: "Adicionar linha" }).click();
  await page.getByLabel("Descrição (linha 1)").fill("Mensal E2E");
  await page.getByLabel("Valor (linha 1)").fill("1.000,00");
  await page.getByLabel("Início (linha 1)").fill("2026-11");
  await page.getByLabel("Fim (linha 1)").fill("2027-10");
  await page.getByRole("button", { name: "Salvar", exact: true }).click();
  await expect(page.getByText("Contrato salvo.")).toBeVisible();

  const a = admin();
  const lines = await a.from("fin_contract_lines").select("months, first_month").eq("company_id", companyId);
  expect(lines.data).toEqual([{ months: 12, first_month: "2026-11-01" }]);

  await page.reload();
  await expect(page.getByLabel("Fim (linha 1)")).toHaveValue("2027-10");
  await expect(page.getByText("Vigência: 11/2026 – 10/2027")).toBeVisible();
});
