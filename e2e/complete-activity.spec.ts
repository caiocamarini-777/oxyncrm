import { expect, test, type Page } from "@playwright/test";
import { admin, createTestUser, deleteTestUser, login } from "./helpers/auth";

const stamp = Date.now();
const password = "oxyn-test-123";
const slug = `tst-e2e-ca-${stamp}`;
const email = `tst-e2e-ca-${stamp}@oxyn.test`;
const personName = `Pessoa CA ${stamp}`;

let userId = "";
let companyId = "";
let personId = "";
let leadId = "";
let dealId = "";
let pipelineId = "";
let typeTask = "";
let channelLinkedin = "";

test.describe.configure({ mode: "serial" });
test.setTimeout(60_000);

async function insertActivity(row: Record<string, unknown>): Promise<string> {
  const r = await admin()
    .from("activities")
    .insert({ company_id: companyId, owner_id: userId, type_id: typeTask, channel_id: channelLinkedin, ...row })
    .select("id")
    .single();
  if (r.error) throw r.error;
  return r.data.id as string;
}

async function setLeadRule(rule: string) {
  const r = await admin().from("companies").update({ settings: { lead_next_activity_rule: rule } }).eq("id", companyId);
  if (r.error) throw r.error;
}

const planned = (page: Page, subject: string) => page.getByTestId("planned-activity").filter({ hasText: subject });
const hoursFromNow = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();

async function open(page: Page, path: string) {
  await page.goto(path);
  await expect(page.getByRole("tab", { name: "Atividade", exact: true })).toBeVisible();
}

test.beforeAll(async () => {
  userId = await createTestUser({ email, password, fullName: "Ada Atividades", superAdmin: true });
  const a = admin();
  const c = await a.from("companies").insert({ name: `Atividades E2E ${stamp}`, slug }).select("id").single();
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
  channelLinkedin = channels.data.find((ch) => ch.name === "LinkedIn")!.id;
  pipelineId = pipe.data.id;
  const stage = await a.from("stages").select("id").eq("pipeline_id", pipelineId).order("position").limit(1).single();
  if (stage.error) throw stage.error;

  const p = await a.from("persons").insert({ company_id: companyId, owner_id: userId, full_name: personName }).select("id").single();
  if (p.error) throw p.error;
  personId = p.data.id;
  const l = await a
    .from("leads")
    .insert({ company_id: companyId, owner_id: userId, title: `Lead CA ${stamp}`, person_id: personId })
    .select("id")
    .single();
  if (l.error) throw l.error;
  leadId = l.data.id;
  const d = await a
    .from("deals")
    .insert({ company_id: companyId, owner_id: userId, pipeline_id: pipelineId, stage_id: stage.data.id, title: `Negocio CA ${stamp}` })
    .select("id")
    .single();
  if (d.error) throw d.error;
  dealId = d.data.id;
  const rule = await a.from("pipelines").update({ next_activity_rule: "require" }).eq("id", pipelineId);
  if (rule.error) throw rule.error;
});

test.afterAll(async () => {
  const a = admin();
  if (companyId) {
    const del = await a.from("companies").delete().eq("id", companyId);
    if (del.error) console.error("limpeza da empresa:", del.error.message);
  }
  if (userId) await deleteTestUser(userId).catch(() => {});
});

test("cria tarefa no LinkedIn, agenda reunião pelo resultado e conclui a reunião", async ({ page }) => {
  await login(page, email, password);
  await page.waitForURL((u) => !u.pathname.startsWith("/entrar"));
  await open(page, `/${slug}/leads/${leadId}`);

  await page.getByRole("tab", { name: "Atividade", exact: true }).click();
  const subject = `Contato LinkedIn ${stamp}`;
  await page.getByLabel("Assunto").fill(subject);
  await expect(page.getByRole("button", { name: "Salvar atividade" })).toBeDisabled(); // canal obrigatório
  await page.getByLabel("Canal").selectOption({ label: "LinkedIn" });
  await page.getByRole("button", { name: "Salvar atividade" }).click();
  const item = planned(page, subject);
  await expect(item).toBeVisible();
  await expect(item).toContainText("LinkedIn");
  await expect(item).toContainText("Ada Atividades");

  // concluir exige resultado
  await item.getByRole("button", { name: /^Concluir/ }).click();
  const concluir = page.getByRole("button", { name: "Concluir", exact: true });
  await expect(concluir).toBeDisabled();

  // resultado que agenda reunião exige a reunião
  await page.getByRole("radio", { name: "Reunião agendada" }).click();
  await expect(page.getByTestId("schedule-meeting")).toBeVisible();
  await expect(page.getByLabel("Assunto da reunião")).toHaveValue(`Reunião com ${personName}`);
  await expect(concluir).toBeDisabled();
  await page.getByLabel("Data e hora da reunião").fill("2031-03-10T14:30");
  await expect(concluir).toBeEnabled();
  await concluir.click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await expect(planned(page, subject)).toHaveCount(0);
  const meeting = planned(page, `Reunião com ${personName}`);
  await expect(meeting).toBeVisible();
  await expect(meeting).toContainText("LinkedIn"); // canal herdado

  // reunião: Realizada
  await meeting.getByRole("button", { name: /^Concluir/ }).click();
  await expect(page.getByRole("radio", { name: "No-show" })).toBeVisible();
  await expect(page.getByRole("radio", { name: "Remarcada" })).toBeVisible();
  await expect(page.getByRole("radio", { name: "Cancelada" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Concluir", exact: true })).toBeDisabled();
  await page.getByRole("radio", { name: "Realizada" }).click();
  await page.getByRole("button", { name: "Concluir", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(planned(page, `Reunião com ${personName}`)).toHaveCount(0);
  await expect(page.getByText("Nenhuma atividade planejada.")).toBeVisible();
});

test("regra Sugerir abre o formulário de próxima atividade e dá para fechar", async ({ page }) => {
  await setLeadRule("suggest");
  const subject = `Sugerir ${stamp}`;
  await insertActivity({ lead_id: leadId, subject, due_at: hoursFromNow(48) });
  await login(page, email, password);
  await page.waitForURL((u) => !u.pathname.startsWith("/entrar"));
  await open(page, `/${slug}/leads/${leadId}`);

  await planned(page, subject).getByRole("button", { name: /^Concluir/ }).click();
  await page.getByRole("radio", { name: "Sem resposta" }).click();
  await page.getByRole("button", { name: "Concluir", exact: true }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "Próxima atividade" })).toBeVisible();
  await expect(dialog.getByLabel("Canal")).toHaveValue(channelLinkedin); // já preenchido
  await dialog.getByRole("button", { name: "Agora não" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByTestId("planned-activity")).toHaveCount(0);
  await setLeadRule("off");
});

test("regra Obrigar não conclui sem a próxima atividade", async ({ page }) => {
  const subject = `Obrigar ${stamp}`;
  await insertActivity({ deal_id: dealId, subject, due_at: hoursFromNow(48) });
  await login(page, email, password);
  await page.waitForURL((u) => !u.pathname.startsWith("/entrar"));
  await open(page, `/${slug}/negocios/${dealId}`);

  await planned(page, subject).getByRole("button", { name: /^Concluir/ }).click();
  await page.getByRole("radio", { name: "Sem resposta" }).click();
  await page.getByRole("button", { name: "Concluir", exact: true }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog.getByTestId("next-required")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Concluir", exact: true })).toHaveCount(0);
  await expect(planned(page, subject)).toBeVisible(); // segue aberta

  const nextSubject = `Proxima ${stamp}`;
  await dialog.getByLabel("Assunto").fill(nextSubject);
  await dialog.getByRole("button", { name: "Concluir e agendar" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(planned(page, subject)).toHaveCount(0);
  await expect(planned(page, nextSubject)).toBeVisible();
});

test("atividade atrasada mostra o chip vermelho", async ({ page }) => {
  const subject = `Atrasada ${stamp}`;
  await insertActivity({ person_id: personId, subject, due_at: hoursFromNow(-30) });
  await login(page, email, password);
  await page.waitForURL((u) => !u.pathname.startsWith("/entrar"));
  await open(page, `/${slug}/contatos/pessoas/${personId}`);
  const chip = planned(page, subject).getByTestId("activity-chip");
  await expect(chip).toHaveText("Atrasada");
  await expect(chip).toHaveAttribute("data-status", "overdue");
});
