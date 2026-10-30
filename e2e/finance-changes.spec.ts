import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { admin, createTestUser, deleteTestUser, login } from "./helpers/auth";

const stamp = Date.now();
const password = "oxyn-test-123";
const slug = `tst-e2e-fchg-${stamp}`;
const adminEmail = `tst-e2e-fchg-admin-${stamp}@oxyn.test`;

let companyId = "";
let userId = "";

const today = new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
const ym = (delta: number) => {
  const [y, m] = today.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + delta, 1)).toISOString().slice(0, 7);
};
const startDate = `${ym(1)}-10`;
const endDate = ym(3);
const range = `from=${ym(1)}-01&to=${ym(3)}-28`;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  const a = admin();
  userId = await createTestUser({ email: adminEmail, password, fullName: "Ada Selo", superAdmin: true });
  const c = await a.from("companies").insert({ name: `Financeiro Selo ${stamp}`, slug }).select("id").single();
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
  const acc = await ins("fin_accounts", { company_id: companyId, name: "Conta Selo" });
  await ins("fin_balance_snapshots", { company_id: companyId, account_id: acc, as_of: today, balance: 1000 });
  await ins("fin_income_categories", { company_id: companyId, name: "Mensalidades Selo" });
});

test.afterAll(async () => {
  const a = admin();
  if (companyId) await a.from("companies").delete().eq("id", companyId);
  if (userId) await deleteTestUser(userId).catch(() => {});
});

test("selo de edição, de pago diferente e filtro Só alterados", async ({ page }) => {
  await login(page, adminEmail, password);
  await page.waitForURL((u) => !u.pathname.startsWith("/entrar"));
  await page.goto(`/${slug}/financeiro/lancamentos?${range}`);

  await page.getByRole("button", { name: "Novo lançamento" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("radio", { name: "Entrada" }).click();
  await dialog.getByLabel("Descrição").fill("Mensal Selo");
  await dialog.getByLabel("Valor", { exact: true }).fill("2.000,00");
  await dialog.getByLabel("Categoria").selectOption({ label: "Mensalidades Selo" });
  await dialog.getByLabel("Periodicidade").selectOption({ label: "Mensal" });
  await dialog.getByLabel("Início").fill(startDate);
  await dialog.getByLabel("Fim").fill(endDate);
  await dialog.getByRole("button", { name: "Salvar" }).click();
  await expect(dialog).toHaveCount(0);

  await page.goto(`/${slug}/financeiro/lancamentos?${range}`);
  const rows = page.getByRole("row", { name: /Mensal Selo/ });
  await expect(rows).toHaveCount(3);
  await expect(page.locator("[data-change]")).toHaveCount(0);

  // editar o valor da primeira
  await rows.nth(0).getByRole("button", { name: "Editar" }).click();
  const edit = page.getByRole("dialog");
  await edit.getByLabel("Valor", { exact: true }).fill("2.500,00");
  await edit.getByRole("button", { name: "Salvar" }).click();
  await expect(edit).toHaveCount(0);
  await expect(rows.nth(0)).toContainText("editado");
  await expect(rows.nth(0)).toContainText(/previsto R\$\s2\.000,00/);

  // liquidar a segunda com valor diferente
  await rows.nth(1).getByRole("button", { name: "Liquidar" }).click();
  const settle = page.getByRole("dialog");
  await settle.getByLabel("Valor liquidado").fill("1.800,00");
  await settle.getByRole("button", { name: "Liquidar", exact: true }).click();
  await expect(settle).toHaveCount(0);
  await expect(rows.nth(1)).toContainText(/pago R\$\s1\.800,00/);
  await expect(rows.nth(1)).toContainText(/previsto R\$\s2\.000,00/);

  // Só alterados: a terceira (intocada) some
  await page.getByLabel("Só alterados").click();
  await expect(page).toHaveURL(/changed=1/);
  await expect(rows).toHaveCount(2);
  await expect(page.locator("[data-change]")).toHaveCount(2);
});
