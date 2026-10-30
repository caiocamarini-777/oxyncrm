import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { admin, createTestUser, deleteTestUser, login } from "./helpers/auth";

const stamp = Date.now();
const password = "oxyn-test-123";
const slug = `tst-e2e-fsal-${stamp}`;
const adminEmail = `tst-e2e-fsal-admin-${stamp}@oxyn.test`;
const sellerEmail = `tst-e2e-fsal-seller-${stamp}@oxyn.test`;
const roleName = `Vendedor ${stamp}`;
const contractTitle = `Harpix Operação ${stamp}`;
const orgName = `Harpix ${stamp}`;
const buyer = `Cliente Final ${stamp}`;
const sellerName = "Tst Vendedor Vendas";

const now = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
const thisMonth = new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1)).toISOString().slice(0, 7);
const next = new Date(Date.UTC(now.getFullYear(), now.getMonth() + 1, 1));
const nextYm = next.toISOString().slice(0, 7);
const nextLast = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);

let companyId = "";
let contractId = "";
const userIds: string[] = [];

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  const a = admin();
  const adminId = await createTestUser({ email: adminEmail, password, fullName: "Ada Vendas", superAdmin: true });
  userIds.push(adminId);
  const c = await a.from("companies").insert({ name: `Financeiro Vendas ${stamp}`, slug }).select("id").single();
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
  const account = await ins("fin_accounts", { company_id: companyId, name: "Conta Vendas" });
  // A visão Mês só lista os lançamentos quando há saldo informado.
  await ins("fin_balance_snapshots", { company_id: companyId, account_id: account, as_of: `${thisMonth}-01`, balance: 1000 });
  await ins("service_categories", { company_id: companyId, name: "Comissionamento E2E" });
  const org = await ins("organizations", { company_id: companyId, name: orgName, owner_id: adminId });
  contractId = await ins("fin_contracts", {
    company_id: companyId,
    title: contractTitle,
    organization_id: org,
    status: "active",
    due_day: 10,
    account_id: account,
    end_rule: "auto_renew",
  });

  // Papel só com register_sales (e visibilidade padrão).
  const sellerId = await createTestUser({ email: sellerEmail, password, fullName: sellerName });
  userIds.push(sellerId);
  const role = await a
    .from("roles")
    .insert({
      name: roleName,
      permissions: {
        visibility: { leads: "own", deals: "own", persons: "own", organizations: "own", activities: "own" },
        actions: { create: true, edit: true, delete: false, export: false, reassign_owner: false },
        settings: {
          manage_pipelines: false,
          manage_custom_fields: false,
          manage_products: false,
          view_reports: false,
          create_dashboards: false,
          share_dashboards: false,
          register_sales: true,
        },
      },
    })
    .select("id")
    .single();
  if (role.error) throw role.error;
  const m = await a.from("memberships").insert({ user_id: sellerId, company_id: companyId, role_id: role.data.id });
  if (m.error) throw m.error;
});

test.afterAll(async () => {
  const a = admin();
  if (companyId) {
    // fin_client_sales referencia contratos e linhas com ON DELETE RESTRICT: as vendas saem primeiro.
    await a.from("fin_client_sales").delete().eq("company_id", companyId);
    await a.from("memberships").delete().eq("company_id", companyId);
    await a.from("companies").delete().eq("id", companyId);
  }
  await a.from("roles").delete().eq("name", roleName);
  for (const id of userIds) await deleteTestUser(id).catch(() => {});
});

async function signIn(page: import("@playwright/test").Page, email: string) {
  await login(page, email, password);
  await page.waitForURL((u) => !u.pathname.startsWith("/entrar"));
}

test("1) o admin cria a linha de comissão e autoriza o vendedor", async ({ page }) => {
  await signIn(page, adminEmail);
  await page.goto(`/${slug}/financeiro/contratos/${contractId}`);
  await expect(page.getByRole("heading", { name: "Vendedores autorizados" })).toHaveCount(0);

  await page.getByRole("button", { name: "Adicionar linha" }).click();
  await page.getByLabel("Tipo (linha 1)").selectOption({ label: "Comissão" });
  await page.getByLabel("Descrição (linha 1)").fill("Comissão de vendas");
  await page.getByLabel("Categoria de serviço (linha 1)").selectOption({ label: "Comissionamento E2E" });
  await page.getByLabel("Mês inicial (linha 1)").fill(thisMonth);
  await page.getByLabel("Duração em meses (linha 1)").fill("12");
  await page.getByLabel("% sobre o setup (linha 1)").fill("10");
  await page.getByLabel("% sobre o recorrente (linha 1)").fill("5");
  await page.getByRole("button", { name: "Salvar", exact: true }).click();
  await expect(page.getByText("Contrato salvo.")).toBeVisible();
  await page.reload();

  await expect(page.getByRole("heading", { name: "Vendedores autorizados" })).toBeVisible();
  await page.getByLabel(sellerName).check();
  await page.getByRole("button", { name: "Salvar vendedores" }).click();
  await expect(page.getByText("Vendedores salvos.")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel(sellerName)).toBeChecked();
});

test("2) o vendedor vê Vendas, não vê Financeiro e cadastra uma venda", async ({ page }) => {
  await signIn(page, sellerEmail);
  await page.goto(`/${slug}/inicio`);
  await expect(page.getByRole("link", { name: "Vendas", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Financeiro" })).toHaveCount(0);
  const res = await page.goto(`/${slug}/financeiro`);
  expect(res?.status()).toBe(404);

  await page.goto(`/${slug}/vendas`);
  await expect(page.getByRole("heading", { name: "Minhas vendas" })).toBeVisible();
  await page.getByRole("button", { name: "Nova venda" }).click();
  const dialog = page.getByRole("dialog");
  // o select mostra "Contrato – Cliente" e nenhum percentual ou comissão
  await dialog.getByLabel("Contrato").selectOption({ label: `${contractTitle} – ${orgName}` });
  await expect(dialog.getByText("%")).toHaveCount(0);
  await dialog.getByLabel("Cliente final").fill(buyer);
  await dialog.getByLabel("Valor do setup").fill("3.000,00");
  await dialog.getByLabel("Parcelas do setup").fill("1");
  await dialog.getByLabel("Primeiro recebimento do setup").fill(thisMonth);
  await dialog.getByRole("button", { name: "Salvar" }).click();
  await expect(dialog).toHaveCount(0);
  const row = page.getByRole("row", { name: new RegExp(buyer) });
  await expect(row).toBeVisible();
  await expect(row).toContainText("3.000,00");
  await expect(page.getByText(/300,00/)).toHaveCount(0);
});

test("3) o admin vê a comissão prevista em Vendas e o lançamento do mês seguinte", async ({ page }) => {
  await signIn(page, adminEmail);
  await page.goto(`/${slug}/financeiro/vendas`);
  const row = page.getByRole("row", { name: new RegExp(buyer) });
  await expect(row).toContainText(sellerName);
  await expect(row).toContainText(contractTitle);
  await expect(row).toContainText("R$ 300,00");

  await page.goto(`/${slug}/financeiro/vendas?vendedor=00000000-0000-4000-8000-000000000000`);
  await expect(page.getByText("Nenhuma venda encontrada.")).toBeVisible();

  await page.goto(`/${slug}/financeiro?from=${nextYm}-01&to=${nextLast}`);
  await expect(page.getByText(`Comissão – ${buyer}`).first()).toBeVisible();
});

test("4) o vendedor edita e cancela a venda; o admin vê a comissão sumir", async ({ page }) => {
  await signIn(page, sellerEmail);
  await page.goto(`/${slug}/vendas`);
  await page.getByRole("button", { name: `Editar venda ${buyer}` }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Valor do setup")).toHaveValue("3000,00");
  await dialog.getByLabel("Valor do setup").fill("4.000,00");
  await dialog.getByRole("button", { name: "Salvar" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("row", { name: new RegExp(buyer) })).toContainText("4.000,00");

  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: `Cancelar venda ${buyer}` }).click();
  await expect(page.getByRole("row", { name: new RegExp(buyer) })).toContainText("Cancelada");

  const open = await admin().from("fin_entries").select("id, status").eq("company_id", companyId).eq("source_kind", "sale");
  expect(open.data ?? []).toHaveLength(0);
});

test("5) o gestor edita e cancela a venda de um vendedor em Financeiro > Vendas", async ({ page }) => {
  const a = admin();
  const line = await a.from("fin_contract_lines").select("id").eq("contract_id", contractId).eq("kind", "commission").single();
  if (line.error) throw line.error;
  const buyer2 = `Cliente Gestor ${stamp}`;
  const sale = await a
    .from("fin_client_sales")
    .insert({
      company_id: companyId,
      contract_id: contractId,
      contract_line_id: line.data.id,
      buyer: buyer2,
      sold_on: `${thisMonth}-05`,
      setup_value: 3000,
      setup_installments: 1,
      setup_first_month: `${thisMonth}-01`,
    })
    .select("id")
    .single();
  if (sale.error) throw sale.error;

  await signIn(page, adminEmail);
  await page.goto(`/${slug}/financeiro/vendas`);
  const row = () => page.getByRole("row", { name: new RegExp(buyer2) });
  await expect(row()).toContainText("R$ 300,00");

  await page.getByRole("button", { name: `Editar venda ${buyer2}` }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Valor do setup").fill("5.000,00");
  await dialog.getByRole("button", { name: "Salvar" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(row()).toContainText("R$ 500,00");

  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: `Cancelar venda ${buyer2}` }).click();
  await expect(row()).toContainText("Cancelada");
  await expect(row()).toContainText("R$ 0,00");
  await expect(row()).not.toContainText("R$ 500,00");
});
