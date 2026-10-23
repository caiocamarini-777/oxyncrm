import { expect, test } from "@playwright/test";
import { admin, createTestUser, deleteTestUser, loadEnv, login } from "./helpers/auth";
import { runSql } from "./helpers/db";
import { getMessages } from "./helpers/outbox";

const stamp = Date.now();
const password = "oxyn-test-123";
const slug = `tst-e2e-rem-${stamp}`;
const email = `tst-e2e-rem-${stamp}@oxyn.test`;
const subject = `Ligar para cliente ${stamp}`;

let userId = "";
let companyId = "";
let personId = "";

test.describe.configure({ mode: "serial" });
test.setTimeout(90_000);

loadEnv();
const secret = process.env.CRON_SECRET;

test.beforeAll(async () => {
  userId = await createTestUser({ email, password, fullName: "Rita Lembretes", superAdmin: true });
  const a = admin();
  const c = await a.from("companies").insert({ name: `Lembretes E2E ${stamp}`, slug }).select("id").single();
  if (c.error) throw c.error;
  companyId = c.data.id;
  const p = await a.from("persons").insert({ company_id: companyId, owner_id: userId, full_name: `Pessoa Lembrete ${stamp}` }).select("id").single();
  if (p.error) throw p.error;
  personId = p.data.id;
});

test.afterAll(async () => {
  if (companyId) {
    const del = await admin().from("companies").delete().eq("id", companyId);
    if (del.error) console.error("limpeza da empresa:", del.error.message);
  }
  if (userId) await deleteTestUser(userId).catch(() => {});
});

test("sino recebe lembrete em tempo real, mostra toast e marca como lido", async ({ page }) => {
  await login(page, email, password);
  await page.waitForURL((u) => !u.pathname.startsWith("/entrar"));
  await page.goto(`/${slug}/contatos/pessoas/${personId}`);
  await expect(page.getByRole("button", { name: "Notificações" })).toBeVisible();
  await page.waitForTimeout(2500); // dá tempo da assinatura Realtime abrir

  const a = admin();
  const [types, channels] = await Promise.all([
    a.from("activity_types").select("id").eq("company_id", companyId).eq("name", "Tarefa").single(),
    a.from("activity_channels").select("id").eq("company_id", companyId).eq("name", "LinkedIn").single(),
  ]);
  if (types.error) throw types.error;
  if (channels.error) throw channels.error;
  const ins = await a.from("activities").insert({
    company_id: companyId,
    owner_id: userId,
    type_id: types.data.id,
    channel_id: channels.data.id,
    person_id: personId,
    subject,
    due_at: new Date(Date.now() - 60_000).toISOString(),
    reminder_minutes: 0,
  });
  if (ins.error) throw ins.error;
  await runSql("select public.generate_activity_reminders()");

  const toast = page.locator("[data-sonner-toast]").filter({ hasText: `Lembrete: ${subject}` });
  await expect(toast).toBeVisible();
  await expect(toast.getByRole("button", { name: "Abrir" })).toBeVisible();
  await expect(page.getByTestId("notifications-count")).toHaveText("1");

  await page.getByRole("button", { name: /^Notificações/ }).click();
  const item = page.getByTestId("notification-item").filter({ hasText: `Lembrete: ${subject}` });
  await expect(item).toHaveAttribute("data-unread", "true");
  await page.getByRole("button", { name: "Marcar todas como lidas" }).click();
  await expect(page.getByTestId("notifications-count")).toHaveCount(0);
  await expect(item).toHaveAttribute("data-unread", "false");

  // gerar de novo não duplica
  await runSql("select public.generate_activity_reminders()");
  await expect(page.getByTestId("notification-item")).toHaveCount(1);
});

test("rota de cron exige o segredo", async ({ request }) => {
  expect((await request.get("/api/cron/lembretes")).status()).toBe(401);
  expect((await request.get("/api/cron/lembretes", { headers: { Authorization: "Bearer errado" } })).status()).toBe(401);
  expect((await request.get("/api/cron/lembretes", { headers: { Authorization: "Basic abc" } })).status()).toBe(401);
});

test("rota de cron envia o e-mail uma única vez", async ({ request }) => {
  test.skip(!secret, "CRON_SECRET ausente no ambiente do teste");
  const headers = { Authorization: `Bearer ${secret}` };
  const first = await request.get("/api/cron/lembretes", { headers });
  expect(first.status()).toBe(200);
  const mine = async () => (await getMessages(email)).filter((m) => m.subject === `Lembrete: ${subject}`);
  await expect.poll(async () => (await mine()).length).toBe(1);
  const msg = (await mine())[0];
  expect(msg.html).toContain(`/${slug}/contatos/pessoas/${personId}`);

  const row = await admin().from("notifications").select("email_sent_at").eq("user_id", userId).single();
  expect(row.error).toBeNull();
  expect(row.data?.email_sent_at).not.toBeNull();

  const second = await request.get("/api/cron/lembretes", { headers });
  expect(second.status()).toBe(200);
  expect((await mine()).length).toBe(1);
});
