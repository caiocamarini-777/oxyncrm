import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { admin, createTestUser, deleteTestUser, login } from "./helpers/auth";

const stamp = Date.now();
const password = "oxyn-test-123";
const slug = `tst-e2e-finm-${stamp}`;
const adminEmail = `tst-e2e-finm-admin-${stamp}@oxyn.test`;

let companyId = "";
let userId = "";

const today = new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  const a = admin();
  userId = await createTestUser({ email: adminEmail, password, fullName: "Ada Mês", superAdmin: true });
  const c = await a.from("companies").insert({ name: `Financeiro Mês ${stamp}`, slug }).select("id").single();
  if (c.error) throw c.error;
  companyId = c.data.id;
  // O gatilho de ativação exige sessão de admin geral.
  const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const si = await s.auth.signInWithPassword({ email: adminEmail, password });
  if (si.error) throw si.error;
  const r = await s.from("companies").update({ finance_enabled: true }).eq("id", companyId).select("id");
  if (r.error || !r.data?.length) throw r.error ?? new Error("empresa não atualizada");
  const cat = await a.from("fin_expense_categories").insert({ company_id: companyId, name: "Tecnologia E2E", default_nature: "fixed" });
  if (cat.error) throw cat.error;
});

test.afterAll(async () => {
  const a = admin();
  if (companyId) await a.from("companies").delete().eq("id", companyId);
  if (userId) await deleteTestUser(userId).catch(() => {});
});

test("fluxo do mês: aviso sem saldo, projeção, baixa e CSV", async ({ page }) => {
  await login(page, adminEmail, password);
  await page.waitForURL((u) => !u.pathname.startsWith("/entrar"));

  // 1) sem saldo: aviso no lugar dos cards
  await page.goto(`/${slug}/financeiro`);
  await expect(page.getByText("Informe o saldo de pelo menos uma conta para ver a projeção.")).toBeVisible();
  await expect(page.getByText("Saldo atual")).toHaveCount(0);

  // 2) saldo de 10.000 (snapshot de hoje; a tela de contas vem na Task 12)
  const a = admin();
  const acc = await a.from("fin_accounts").insert({ company_id: companyId, name: "Conta E2E" }).select("id").single();
  if (acc.error) throw acc.error;
  const snap = await a.from("fin_balance_snapshots").insert({ company_id: companyId, account_id: acc.data.id, as_of: today, balance: 10000 });
  if (snap.error) throw snap.error;

  await page.goto(`/${slug}/financeiro`);
  await expect(page.getByText("Saldo atual")).toBeVisible();

  // 3) saída avulsa de 2.000 vencendo hoje
  await page.getByRole("button", { name: "Novo lançamento" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Descrição").fill("Servidor E2E");
  await dialog.getByLabel("Valor", { exact: true }).fill("2000,00");
  await dialog.getByLabel("Categoria").selectOption({ label: "Tecnologia E2E" });
  await dialog.getByRole("button", { name: "Salvar" }).click();
  await expect(dialog).toHaveCount(0);

  const projected = page.locator("div", { has: page.getByText("Saldo projetado no fim do mês", { exact: true }) }).last();
  await expect(projected).toContainText("8.000,00");

  // 4) seleciona e liquida
  await page.getByRole("checkbox", { name: /Selecionar Servidor E2E/ }).check();
  await page.getByRole("button", { name: /Liquidar selecionados/ }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Liquidar", exact: true }).click();
  await expect(page.getByText("Liquidado", { exact: true }).first()).toBeVisible();

  // 5) Lançamentos: tabela e exportação
  await page.goto(`/${slug}/financeiro/lancamentos`);
  await expect(page.getByRole("cell", { name: "Servidor E2E" })).toBeVisible();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("link", { name: "Exportar CSV" }).click(),
  ]);
  const csv = readFileSync((await download.path())!, "utf8");
  expect(csv).toContain("Vencimento;Tipo;Descrição;Cliente;Categoria;Natureza;Valor bruto;Retenção;Valor;Status;Liquidado em;Valor liquidado");
  expect(csv).toContain("Servidor E2E");
});
