import { expect, test, type Page } from "@playwright/test";
import { admin, createTestUser, deleteTestUser, login } from "./helpers/auth";
import { runSql } from "./helpers/db";

const stamp = Date.now();
const password = "oxyn-test-123";
const slug = `tst-e2e-p4-${stamp}`;
const email = `tst-e2e-p4-${stamp}@oxyn.test`;
const personName = `Pessoa P4 ${stamp}`;
const leadTitle = `Lead P4 ${stamp}`;
const dealTitle = `Negócio P4 ${stamp}`;
const lateDealTitle = `Negócio atrasado P4 ${stamp}`;

let userId = "";
let companyId = "";
let personId = "";
let leadId = "";
let dealId = "";
let pipelineId = "";
let typeTask = "";
let typeCall = "";
let channelLinkedin = "";
let firstStage = "";

test.describe.configure({ mode: "serial" });
test.setTimeout(120_000);

const planned = (page: Page, subject: string) => page.getByTestId("planned-activity").filter({ hasText: subject });
const hoursFromNow = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();

async function signIn(page: Page) {
  await login(page, email, password);
  await page.waitForURL((u) => !u.pathname.startsWith("/entrar"));
}

async function open(page: Page, path: string) {
  await page.goto(path);
  await expect(page.getByRole("tab", { name: "Atividade", exact: true })).toBeVisible();
}

test.beforeAll(async () => {
  userId = await createTestUser({ email, password, fullName: "Sara SDR", superAdmin: true });
  const a = admin();
  const c = await a.from("companies").insert({ name: `Fase 4 E2E ${stamp}`, slug }).select("id").single();
  if (c.error) throw c.error;
  companyId = c.data.id;
  const [types, channels, pipe] = await Promise.all([
    a.from("activity_types").select("id, name").eq("company_id", companyId),
    a.from("activity_channels").select("id, name").eq("company_id", companyId),
    a.from("pipelines").select("id").eq("company_id", companyId).single(),
  ]);
  if (types.error) throw types.error;
  if (channels.error) throw channels.error;
  if (pipe.error) throw pipe.error;
  typeTask = types.data.find((t) => t.name === "Tarefa")!.id;
  typeCall = types.data.find((t) => t.name === "Ligação")!.id;
  channelLinkedin = channels.data.find((ch) => ch.name === "LinkedIn")!.id;
  pipelineId = pipe.data.id;
  const stage = await a.from("stages").select("id").eq("pipeline_id", pipelineId).order("position").limit(1).single();
  if (stage.error) throw stage.error;
  firstStage = stage.data.id;

  const rule = await a.from("pipelines").update({ next_activity_rule: "require" }).eq("id", pipelineId);
  if (rule.error) throw rule.error;
  const p = await a.from("persons").insert({ company_id: companyId, owner_id: userId, full_name: personName }).select("id").single();
  if (p.error) throw p.error;
  personId = p.data.id;
  const l = await a
    .from("leads")
    .insert({ company_id: companyId, owner_id: userId, title: leadTitle, person_id: personId })
    .select("id")
    .single();
  if (l.error) throw l.error;
  leadId = l.data.id;
});

test.afterAll(async () => {
  if (companyId) {
    const del = await admin().from("companies").delete().eq("id", companyId);
    if (del.error) console.error("limpeza da empresa:", del.error.message);
  }
  if (userId) await deleteTestUser(userId).catch(() => {});
});

test("SDR trabalha o lead: tarefa no LinkedIn, reunião agendada e realizada", async ({ page }) => {
  await signIn(page);
  await open(page, `/${slug}/leads/${leadId}`);
  await page.getByRole("tab", { name: "Atividade", exact: true }).click();

  const subject = `Contato LinkedIn P4 ${stamp}`;
  await page.getByLabel("Assunto").fill(subject);
  await page.getByLabel("Canal").selectOption({ label: "LinkedIn" });
  await page.getByRole("button", { name: "Salvar atividade" }).click();
  await expect(planned(page, subject)).toContainText("LinkedIn");

  await planned(page, subject).getByRole("button", { name: /^Concluir/ }).click();
  await page.getByRole("radio", { name: "Reunião agendada" }).click();
  await page.getByLabel("Data e hora da reunião").fill("2031-03-10T14:30");
  await page.getByRole("button", { name: "Concluir", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  const meetingSubject = `Reunião com ${personName}`;
  const meeting = planned(page, meetingSubject);
  await expect(meeting).toBeVisible();
  await expect(meeting).toContainText("LinkedIn");

  await meeting.getByRole("button", { name: /^Concluir/ }).click();
  await page.getByRole("radio", { name: "Realizada" }).click();
  await page.getByRole("button", { name: "Concluir", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(planned(page, meetingSubject)).toHaveCount(0);

  // O banco guardou o vínculo para os relatórios: canal de origem e atividade que agendou.
  const rows = await admin()
    .from("activities")
    .select("subject, origin_channel_id, booked_by_activity_id, meeting_outcome, done")
    .eq("lead_id", leadId);
  if (rows.error) throw rows.error;
  const booker = rows.data.find((r) => r.subject === subject);
  const held = rows.data.find((r) => r.subject === meetingSubject);
  expect(booker?.done).toBe(true);
  expect(held?.meeting_outcome).toBe("held");
  expect(held?.origin_channel_id).toBe(channelLinkedin);
  expect(held?.booked_by_activity_id).not.toBeNull();
});

test("lead converte no funil com regra Obrigar e a ligação exige a próxima atividade", async ({ page }) => {
  await signIn(page);
  await page.goto(`/${slug}/leads/${leadId}`);
  await page.getByRole("button", { name: "Converter em negócio" }).click();
  const dlg = page.getByRole("dialog");
  await dlg.getByLabel("Título do negócio").fill(dealTitle);
  await dlg.getByRole("button", { name: "Converter", exact: true }).click();
  await page.waitForURL(new RegExp(`/${slug}/negocios/[0-9a-f-]{36}$`));
  dealId = page.url().split("/").pop()!;

  const callSubject = `Ligação P4 ${stamp}`;
  const ins = await admin().from("activities").insert({
    company_id: companyId,
    owner_id: userId,
    type_id: typeCall,
    channel_id: channelLinkedin,
    deal_id: dealId,
    subject: callSubject,
    due_at: hoursFromNow(48),
  });
  if (ins.error) throw ins.error;
  await open(page, `/${slug}/negocios/${dealId}`);

  await planned(page, callSubject).getByRole("button", { name: /^Concluir/ }).click();
  await page.getByRole("radio", { name: "Sem resposta" }).click();
  await page.getByRole("button", { name: "Concluir", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByTestId("next-required")).toBeVisible();
  await expect(planned(page, callSubject)).toBeVisible();

  const nextSubject = `Proposta P4 ${stamp}`;
  await dialog.getByLabel("Assunto").fill(nextSubject);
  await dialog.getByRole("button", { name: "Concluir e agendar" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(planned(page, callSubject)).toHaveCount(0);
  await expect(planned(page, nextSubject)).toBeVisible();
});

test("kanban mostra a próxima atividade e o badge vermelho nas atrasadas", async ({ page }) => {
  const a = admin();
  const late = await a
    .from("deals")
    .insert({ company_id: companyId, owner_id: userId, pipeline_id: pipelineId, stage_id: firstStage, title: lateDealTitle })
    .select("id")
    .single();
  if (late.error) throw late.error;
  const lateSubject = `Retorno atrasado P4 ${stamp}`;
  const act = await a.from("activities").insert({
    company_id: companyId,
    owner_id: userId,
    type_id: typeTask,
    channel_id: channelLinkedin,
    deal_id: late.data.id,
    subject: lateSubject,
    due_at: hoursFromNow(-30),
  });
  if (act.error) throw act.error;

  await signIn(page);
  await page.goto(`/${slug}/negocios?funil=${pipelineId}`);
  await expect(page.getByTestId("kanban-column").first()).toBeVisible();
  const card = (title: string) => page.getByTestId("deal-card").filter({ hasText: title });

  const next = card(dealTitle).getByTestId("next-activity");
  await expect(next).toHaveAttribute("data-status", "upcoming");
  await expect(next).toHaveAttribute("title", `Proposta P4 ${stamp}`);

  const overdue = card(lateDealTitle).getByTestId("next-activity");
  await expect(overdue).toHaveText("Atrasada");
  await expect(overdue).toHaveAttribute("data-status", "overdue");
});

test("lembrete aparece no sino", async ({ page }) => {
  await signIn(page);
  await page.goto(`/${slug}/contatos/pessoas/${personId}`);
  await expect(page.getByRole("button", { name: "Notificações" })).toBeVisible();
  await page.waitForTimeout(2500); // dá tempo da assinatura Realtime abrir

  const subject = `Lembrete P4 ${stamp}`;
  const ins = await admin().from("activities").insert({
    company_id: companyId,
    owner_id: userId,
    type_id: typeTask,
    channel_id: channelLinkedin,
    person_id: personId,
    subject,
    due_at: new Date(Date.now() - 60_000).toISOString(),
    reminder_minutes: 0,
  });
  if (ins.error) throw ins.error;
  await runSql("select public.generate_activity_reminders()");

  await expect(page.getByTestId("notifications-count")).toHaveText("1");
  await page.getByRole("button", { name: /^Notificações/ }).click();
  const item = page.getByTestId("notification-item").filter({ hasText: `Lembrete: ${subject}` });
  await expect(item).toHaveAttribute("data-unread", "true");
});
