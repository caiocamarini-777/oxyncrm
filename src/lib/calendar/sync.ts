import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { GmailAuthError } from "@/lib/gmail/client";
import { hasCalendarScope, isUuid } from "@/lib/gmail/connect";
import { pickRecord } from "@/lib/meet/match";
import { loadCandidates } from "@/lib/meet/match-loader";
import { SyncTokenExpiredError, type CalendarClient, type CalendarEvent } from "./google";
import {
  classifyInbound,
  DEFAULT_MINUTES,
  eventGuests,
  eventTimes,
  isPipedriveEvent,
  meetingLink,
  newActivityFields,
  newerSide,
  RECURRING_WINDOW_DAYS,
} from "./mapping";
import { type CalendarDeps, markReconnect, MAX_CALENDAR_ATTEMPTS, pushActivity } from "./push";
import { readCalendarSettings } from "./settings";

/**
 * Rodada da sincronização com a Agenda do Google (cron `/api/cron/agenda`, a cada 5 min). Regras na spec, seções
 * "Entrada", "Ligar na virada" e "Erros". Uma caixa de cada vez, enquanto houver orçamento, a parada há mais tempo
 * primeiro: as ativas, com o escopo da Agenda, cujo dono é membro de uma empresa (não arquivada) com a Agenda ligada, e
 * com o lease `calendar_lock_until`.
 *
 * - **Primeira rodada** (`calendar_since` nulo): adota os eventos que o Pipedrive deixou (início a até 5 min e o mesmo
 *   título, sem diferenciar maiúsculas, acentos e espaços), aplica as regras de entrada ao resto da lista (o evento do
 *   Pipedrive que não foi adotado fica de fora), cria os eventos que faltam **sem convidar** e só então grava
 *   `calendar_since` e o token. Se algo ficou por fazer, nada é gravado e a primeira rodada recomeça na próxima (é
 *   idempotente: o que já foi ligado é reconhecido pelo vínculo).
 * - **Rodadas seguintes:** lê as mudanças desde o token (410 recomeça a lista a partir de agora, sem adoção), aplica e
 *   grava o token novo; depois envia as pendentes e faz a passada de janela das recorrentes. A entrada vem antes do
 *   envio para religar o evento órfão (criado no Google sem a gravação de volta) antes que o envio crie outro, e para o
 *   conflito valer pela mudança mais recente em vez de o envio sempre ganhar.
 *
 * Toda gravação na atividade passa pelas funções `calendar_apply_inbound`, `calendar_insert_inbound` e
 * `calendar_mark_synced`, que ligam a marca `oxyn.calendar_inbound`: o gatilho não marca a atividade como pendente de
 * novo (sem eco).
 */

/** Duração do lease de uma caixa: o `maxDuration` da rota. Rodada que morre solta a caixa sozinha. */
export const LEASE_MS = 300_000;
/** Pendente gravada há menos que isto fica com a ação do vendedor, que envia na hora (dois envios criariam dois eventos). */
export const FRESH_PENDING_MS = 2 * 60_000;
/** Diferença de início aceita na adoção do evento do Pipedrive (arredondamentos e pequenos ajustes de horário). */
export const ADOPT_TOLERANCE_MS = 5 * 60_000;
/** Atividades enviadas por caixa numa rodada, em cada fila (pendentes e com erro). */
const PUSH_BATCH = 100;
/** Teto de atividades abertas lidas na primeira rodada (o PostgREST devolve no máximo 1.000 linhas). */
const FIRST_RUN_LIMIT = 1000;
/** Ids por consulta `in (...)`, para a URL não estourar. */
const CHUNK = 100;
const MAX_SUBJECT = 200;
const DAY_MS = 24 * 3600_000;
/** Nome do tipo usado nos compromissos sem convidados nem link. */
const TASK_TYPE = "Tarefa";
/** Canal de cada tipo de evento; sem canal claro (ou sem esse nome na empresa), vale o canal legado ("Não informado"). */
const CHANNEL_NAMES = { video: "Videochamada", in_person: "Presencial" } as const;
/** Coluna da atividade para cada vínculo escolhido pelo casador. */
const LINK_COLUMN = { deals: "deal_id", leads: "lead_id", persons: "person_id" } as const;

const DEFERRED = "Envio adiado (limite de uso do Google, rede ou token recusado); a caixa retoma na próxima rodada";
const FIRST_RUN_PENDING = "A primeira rodada não conseguiu criar todos os eventos; ela recomeça na próxima";

export type CalendarRunResult = {
  accountId: string;
  /** Atividades enviadas à Agenda (evento criado, atualizado ou apagado). */
  pushed: number;
  /** Atividades mudadas pela Agenda: adoção, horário ou título, conclusão como cancelada e lixeira. */
  pulled: number;
  /** Atividades criadas a partir de eventos novos. */
  created: number;
  /** Eventos da entrada que falharam e foram pulados (o token avança; o detalhe vai para o log). */
  eventErrors?: number;
  /** Primeira rodada: eventos do Pipedrive que não casaram com nenhuma atividade e ficaram de fora (para conferir). */
  unmatchedPipedrive?: number;
  /** Falha da caixa (Google ou banco); as outras caixas seguem. */
  error?: string;
};

type AccountRow = {
  id: string;
  user_id: string;
  company_id: string;
  email: string;
  scopes: string[] | null;
  calendar_since: string | null;
  calendar_sync_token: string | null;
  calendar_lock_until: string | null;
};

/** Atividade ligada (ou que pode ser religada) a um evento. */
type LinkedRow = {
  id: string;
  owner_id: string;
  type_id: string;
  subject: string;
  due_at: string;
  duration_minutes: number;
  done: boolean;
  deleted_at: string | null;
  updated_at: string;
  calendar_account_id: string | null;
  calendar_event_id: string | null;
  calendar_etag: string | null;
  meet_url: string | null;
  calendar_state: string;
  calendar_local_changed_at: string | null;
  calendar_invited_email: string | null;
};
const LINKED_COLUMNS =
  "id, owner_id, type_id, subject, due_at, duration_minutes, done, deleted_at, updated_at, calendar_account_id, " +
  "calendar_event_id, calendar_etag, meet_url, calendar_state, calendar_local_changed_at, calendar_invited_email";

/** Atividade aberta do dono, candidata à adoção na primeira rodada. */
type OpenRow = {
  id: string;
  company_id: string;
  subject: string;
  due_at: string;
  calendar_state: string;
  calendar_attempts: number;
  created_at?: string;
};

/**
 * O que o evento é para esta caixa:
 * - `known`: ligado a uma atividade (pelo vínculo, ou religado pelo `oxynActivityId` quando é um órfão: evento que o
 *   CRM criou sem conseguir gravar o vínculo de volta, ou cuja caixa foi desconectada e conectada de novo, o que apaga
 *   a linha antiga e deixa `calendar_account_id` nulo);
 * - `foreign`: evento do próprio CRM que não é desta caixa (atividade ligada a outro evento, ou que já desfez o
 *   vínculo: lixeira, cancelada, dono trocado). Nunca vira atividade nova;
 * - `unknown`: evento de fora do CRM (ou de uma atividade apagada de vez), sujeito às regras de entrada.
 */
type Resolved = { kind: "known"; row: LinkedRow; relink: boolean } | { kind: "foreign" } | { kind: "unknown" };

/** Colunas que `calendar_apply_inbound` aceita (chave ausente mantém o valor). */
type InboundPatch = {
  subject?: string;
  due_at?: string;
  duration_minutes?: number;
  deleted_at?: string;
  done?: boolean;
  completed_at?: string;
  meeting_outcome?: "canceled";
  calendar_account_id?: string | null;
  calendar_event_id?: string | null;
  calendar_etag?: string | null;
  calendar_state?: "pending" | "synced";
  meet_url?: string;
  calendar_invited_email?: string;
};

type TypeRow = { id: string; name: string; is_meeting: boolean; active: boolean };
type ChannelRow = { id: string; name: string; active: boolean; is_legacy: boolean };

/** Estado da rodada de uma caixa. */
type AccountRun = {
  deps: CalendarDeps;
  acc: AccountRow;
  calendar: CalendarClient;
  result: CalendarRunResult;
  /** Empresas com a Agenda ligada (e não arquivadas). */
  enabled: Set<string>;
  /** Quando a Agenda foi ligada em cada empresa ligada (`calendar_sync.enabled_at`; nulo se não houver). */
  enabledAt: Map<string, string | null>;
  timeLeft: () => boolean;
  /** Atividades religadas a um evento órfão nesta rodada (a primeira rodada não as cria de novo). */
  relinked: Set<string>;
  catalog?: Promise<{ types: TypeRow[]; channels: ChannelRow[] }>;
  meetingTypes: Map<string, boolean>;
};

const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));

function check(error: { message: string } | null, what: string): void {
  if (error) throw new Error(`Falha ao ${what}: ${error.message}`);
}

function chunks<T>(list: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += CHUNK) out.push(list.slice(i, i + CHUNK));
  return out;
}

/** Corta em `max` caracteres (pontos de código, como o check do banco conta). */
const truncate = (text: string, max: number) => (text.length <= max ? text : Array.from(text).slice(0, max).join(""));
/** Título comparável: sem diferenciar maiúsculas, acentos e espaços (pontas e repetidos). */
const titleKey = (s: string | undefined) =>
  (s ?? "").normalize("NFD").replace(/\p{M}/gu, "").trim().replace(/\s+/g, " ").toLowerCase();
const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
const isPrivate = (ev: CalendarEvent) => ev.visibility === "private" || ev.visibility === "confidential";

// ---- rodada ----------------------------------------------------------------------------------------------------

/**
 * Caixas ativas com o escopo da Agenda cujo dono é membro de alguma empresa (não arquivada) com a Agenda ligada: a
 * atividade do dono sem caixa na empresa dela vai para a caixa mais antiga dele, que pode ser de uma empresa com a
 * Agenda desligada. Ordem: a parada há mais tempo primeiro (`calendar_lock_until` guarda o fim da última rodada; a
 * que nunca rodou vem antes), para o orçamento não ficar sempre com as mesmas.
 */
async function loadAccounts(
  db: SupabaseClient,
): Promise<{ accounts: AccountRow[]; enabled: Set<string>; enabledAt: Map<string, string | null> }> {
  const { data, error } = await db
    .from("email_accounts")
    .select("id, user_id, company_id, email, scopes, calendar_since, calendar_sync_token, calendar_lock_until")
    .eq("status", "active")
    .order("created_at", { ascending: true })
    .limit(200);
  check(error, "listar as caixas");
  const accounts = ((data ?? []) as AccountRow[]).filter((a) => hasCalendarScope(a.scopes));
  if (accounts.length === 0) return { accounts: [], enabled: new Set(), enabledAt: new Map() };

  // Todas as empresas, não só as das caixas: a atividade do dono sem caixa na empresa dela vai para a caixa mais
  // antiga dele, de outra empresa.
  const companies = await db.from("companies").select("id, settings, archived_at").limit(1000);
  check(companies.error, "ler as empresas");
  const enabledAt = new Map(
    ((companies.data ?? []) as { id: string; settings: unknown; archived_at: string | null }[])
      .map((c) => ({ id: c.id, archived: !!c.archived_at, settings: readCalendarSettings(c.settings) }))
      .filter((c) => !c.archived && c.settings.enabled)
      .map((c) => [c.id, c.settings.enabledAt] as const),
  );
  const enabled = new Set(enabledAt.keys());
  if (enabled.size === 0) return { accounts: [], enabled, enabledAt };

  const members = await db
    .from("memberships")
    .select("user_id, company_id")
    .in("user_id", [...new Set(accounts.map((a) => a.user_id))]);
  check(members.error, "ler as empresas dos donos das caixas");
  const serving = new Set(
    ((members.data ?? []) as { user_id: string; company_id: string }[])
      .filter((m) => enabled.has(m.company_id))
      .map((m) => m.user_id),
  );
  const lastRun = (a: AccountRow) => (a.calendar_lock_until ? Date.parse(a.calendar_lock_until) : -Infinity);
  return {
    accounts: accounts
      .filter((a) => enabled.has(a.company_id) || serving.has(a.user_id))
      .sort((a, b) => lastRun(a) - lastRun(b)),
    enabled,
    enabledAt,
  };
}

/**
 * Uma rodada: as caixas uma de cada vez enquanto houver orçamento. A falha de uma caixa vai para o resultado dela e não
 * interrompe as demais. Caixa segura por outra rodada (lease) fica de fora do resultado. Token recusado põe a caixa em
 * "reconectar" (as atividades do dono ficam pendentes até a reconexão).
 */
export async function runCalendarSync(deps: CalendarDeps, opts: { budgetMs: number }): Promise<CalendarRunResult[]> {
  const { db } = deps;
  const nowMs = () => deps.now().getTime();
  const end = nowMs() + opts.budgetMs;

  const { accounts, enabled, enabledAt } = await loadAccounts(db);
  const results: CalendarRunResult[] = [];
  for (const acc of accounts) {
    if (nowMs() >= end) break; // as demais entram na próxima rodada

    // Lease: só pega a caixa se ninguém a segura (ou se o lease anterior venceu).
    const leaseUntil = new Date(nowMs() + LEASE_MS).toISOString();
    const claimed = await db
      .from("email_accounts")
      .update({ calendar_lock_until: leaseUntil })
      .eq("id", acc.id)
      .eq("status", "active")
      .or(`calendar_lock_until.is.null,calendar_lock_until.lt."${new Date(nowMs()).toISOString()}"`)
      .select("id");
    if (claimed.error || !claimed.data?.length) continue;

    const result: CalendarRunResult = { accountId: acc.id, pushed: 0, pulled: 0, created: 0 };
    try {
      await runAccount({
        deps,
        acc,
        calendar: deps.clientFor(acc.id),
        result,
        enabled,
        enabledAt,
        timeLeft: () => nowMs() < end,
        relinked: new Set(),
        meetingTypes: new Map(),
      });
    } catch (e) {
      const msg = errorMessage(e);
      result.error = msg;
      if (e instanceof GmailAuthError) await markReconnect(db, acc.id, msg);
      console.error("agenda: falha na caixa", acc.id, msg);
    } finally {
      // Solta só o próprio lease (se venceu e outra rodada pegou a caixa, o dela fica). Solta com a hora do fim da
      // rodada (já vencida para a próxima), que ordena as caixas na rodada seguinte.
      const released = await db
        .from("email_accounts")
        .update({ calendar_lock_until: new Date(nowMs()).toISOString() })
        .eq("id", acc.id)
        .eq("calendar_lock_until", leaseUntil);
      if (released.error) console.error("agenda: falha ao soltar a caixa", acc.id, released.error.message);
    }
    results.push(result);
  }
  return results;
}

async function runAccount(run: AccountRun): Promise<void> {
  if (!run.acc.calendar_since) return firstRun(run);

  const since = new Date(run.acc.calendar_since);
  const now = run.deps.now();
  // 1. Mudanças desde o token. Token vencido (410), ou ausente, recomeça a lista a partir de agora, sem adoção.
  let listing: { events: CalendarEvent[]; nextSyncToken: string };
  const token = run.acc.calendar_sync_token;
  try {
    if (!token) throw new SyncTokenExpiredError("Caixa sem token da Agenda");
    listing = await run.calendar.listChanges(token);
  } catch (e) {
    if (!(e instanceof SyncTokenExpiredError)) throw e;
    listing = await run.calendar.listFrom(now);
  }
  if (!(await applyEvents(run, listing.events, since, now))) return;
  await saveAccount(run, { calendar_sync_token: listing.nextSyncToken });

  // 2. Pendentes do dono.
  if (!(await pushQueue(run))) return;

  // 3. Recorrentes que entraram na janela de 7 dias.
  if (run.timeLeft()) await windowPass(run, since, now);
}

async function saveAccount(run: AccountRun, fields: { calendar_sync_token: string; calendar_since?: string }) {
  const { error } = await run.deps.db.from("email_accounts").update(fields).eq("id", run.acc.id);
  check(error, "gravar o token da Agenda na caixa");
}

/**
 * Quais empresas esta caixa atende: a atividade vai para a caixa do dono na empresa dela, senão para a mais antiga do
 * dono (a escolha de `calendarAccountFor`, sem conferir o estado). Assim duas caixas do mesmo dono não enviam a mesma
 * atividade, e a da caixa em "reconectar" espera a reconexão.
 */
async function servedCompanies(run: AccountRun): Promise<(companyId: string) => boolean> {
  const { data, error } = await run.deps.db
    .from("email_accounts")
    .select("id, company_id")
    .eq("user_id", run.acc.user_id)
    .order("created_at", { ascending: true });
  check(error, "ler as caixas do dono");
  const rows = (data ?? []) as { id: string; company_id: string }[];
  return (companyId) => (rows.find((r) => r.company_id === companyId) ?? rows[0])?.id === run.acc.id;
}

// ---- envio -----------------------------------------------------------------------------------------------------

/**
 * Envia as pendentes do dono paradas há mais de 2 min (as recentes ficam com a ação do vendedor) e as com erro abaixo
 * de 3 tentativas. Envio adiado (limite de uso, rede, token) para a rodada da caixa: devolve `false`.
 */
async function pushQueue(run: AccountRun): Promise<boolean> {
  const { db } = run.deps;
  const enabled = [...run.enabled];
  const cutoff = new Date(run.deps.now().getTime() - FRESH_PENDING_MS).toISOString();
  const [pending, failed] = await Promise.all([
    db
      .from("activities")
      .select("id, company_id")
      .eq("owner_id", run.acc.user_id)
      .eq("calendar_state", "pending")
      .lt("updated_at", cutoff)
      .in("company_id", enabled)
      .order("updated_at", { ascending: true })
      .limit(PUSH_BATCH),
    db
      .from("activities")
      .select("id, company_id")
      .eq("owner_id", run.acc.user_id)
      .eq("calendar_state", "error")
      .lt("calendar_attempts", MAX_CALENDAR_ATTEMPTS)
      .in("company_id", enabled)
      .order("updated_at", { ascending: true })
      .limit(PUSH_BATCH),
  ]);
  check(pending.error, "listar as atividades pendentes");
  check(failed.error, "listar as atividades com erro");
  const queue = [...(pending.data ?? []), ...(failed.data ?? [])] as { id: string; company_id: string }[];
  if (queue.length === 0) return true;

  const serves = await servedCompanies(run);
  for (const a of queue) {
    if (!serves(a.company_id)) continue;
    if (!run.timeLeft()) return false;
    const r = await pushActivity(run.deps, a.id);
    if (r === "synced") run.result.pushed++;
    if (r === "deferred") {
      run.result.error = DEFERRED;
      return false;
    }
  }
  return true;
}

// ---- primeira rodada -------------------------------------------------------------------------------------------

/**
 * Primeira rodada da caixa (a virada): ninguém é convidado de novo e nenhum evento do Pipedrive é duplicado.
 *
 * 1. Adota: cada atividade aberta do dono, futura e ainda sem evento, fica com o evento da lista de início mais próximo,
 *    a até 5 min, e com o mesmo título (sem diferenciar maiúsculas, acentos e espaços). Cada evento é adotado uma vez
 *    só. O convidado que o evento já tem fica registrado (o evento dele não recebe a descrição interna).
 * 2. Os eventos não adotados seguem as regras de entrada (inclusive religar órfãos), menos os do Pipedrive: o que não
 *    casou com nenhuma atividade fica de fora (viraria a mesma reunião duas vezes) e é contado no resultado.
 * 3. Cria o evento das atividades que sobraram (inclusive as recém-gravadas: até a primeira rodada terminar, o envio na
 *    hora não passa por esta caixa, então ninguém mais está enviando). Sem convite para as criadas antes de ligar a
 *    Agenda na empresa (`enabled_at`; sem a data, também sem convite): o Pipedrive já convidou. A reunião criada
 *    depois de ligar (entre ligar e a primeira rodada) convida o cliente como no envio normal.
 * 4. Grava `calendar_since` e o token, só se tudo foi feito. Envio adiado ou com erro deixa a primeira rodada para a
 *    próxima, que repete sem convite. A atividade que já falhou 3 vezes fica só no "Tentar de novo" e não segura a
 *    virada.
 */
async function firstRun(run: AccountRun): Promise<void> {
  const { db } = run.deps;
  const now = run.deps.now();
  const { events, nextSyncToken } = await run.calendar.listFrom(now);
  const resolved = await resolveEvents(run, events);

  const { data, error } = await db
    .from("activities")
    .select("id, company_id, subject, due_at, calendar_state, calendar_attempts, created_at")
    .eq("owner_id", run.acc.user_id)
    .eq("done", false)
    .is("deleted_at", null)
    .is("calendar_event_id", null)
    .gte("due_at", now.toISOString())
    .in("company_id", [...run.enabled])
    .order("due_at", { ascending: true })
    .limit(FIRST_RUN_LIMIT);
  check(error, "listar as atividades abertas do dono");
  const serves = await servedCompanies(run);
  const open = ((data ?? []) as OpenRow[]).filter((a) => serves(a.company_id));

  // 1. Adoção.
  const adopted = new Set<string>();
  const claimed = new Set<string>();
  for (const a of open) {
    let best: { ev: CalendarEvent; diff: number } | null = null;
    for (const e of events) {
      if (claimed.has(e.id) || e.status === "cancelled" || resolved.get(e.id)?.kind !== "unknown") continue;
      const times = eventTimes(e);
      if (!times || titleKey(e.summary) !== titleKey(a.subject)) continue;
      const diff = Math.abs(Date.parse(times.dueAt) - Date.parse(a.due_at));
      if (diff <= ADOPT_TOLERANCE_MS && (!best || diff < best.diff)) best = { ev: e, diff };
    }
    if (!best) continue;
    const ev = best.ev;
    claimed.add(ev.id);
    adopted.add(a.id);
    const patch: InboundPatch = { calendar_account_id: run.acc.id, calendar_event_id: ev.id, calendar_etag: ev.etag ?? null };
    // Mudança do CRM ainda por enviar continua pendente (vira atualização do evento adotado, sem convidar ninguém).
    if (a.calendar_state !== "pending") patch.calendar_state = "synced";
    const link = meetingLink(ev);
    if (link) patch.meet_url = link;
    const guest = eventGuests(ev, run.acc.email)[0];
    if (guest) patch.calendar_invited_email = guest;
    await applyInbound(db, a.id, patch);
    run.result.pulled++;
  }

  // 2. Regras de entrada para o resto da lista. O evento do Pipedrive que não foi adotado fica de fora.
  const leftover = (e: CalendarEvent) =>
    resolved.get(e.id)?.kind === "unknown" && e.status !== "cancelled" && isPipedriveEvent(e);
  const unmatched = events.filter((e) => !claimed.has(e.id) && leftover(e)).length;
  if (unmatched > 0) run.result.unmatchedPipedrive = unmatched;
  const rest = events.filter((e) => !claimed.has(e.id) && !leftover(e));
  if (!(await applyEvents(run, rest, now, now, resolved))) return;

  // 3. Cria o que falta: sem convite, menos o que foi criado depois de ligar a Agenda na empresa.
  let finished = true;
  for (const a of open) {
    if (adopted.has(a.id) || run.relinked.has(a.id)) continue;
    if (a.calendar_state === "error" && a.calendar_attempts >= MAX_CALENDAR_ATTEMPTS) continue;
    if (!run.timeLeft()) return;
    const enabledAt = run.enabledAt.get(a.company_id);
    const afterEnable = !!enabledAt && !!a.created_at && Date.parse(a.created_at) >= Date.parse(enabledAt);
    const r = await pushActivity(run.deps, a.id, afterEnable ? { firstRun: true } : { invite: false });
    if (r === "synced") run.result.pushed++;
    if (r === "deferred") {
      run.result.error = DEFERRED;
      return;
    }
    if (r === "error") {
      run.result.error = FIRST_RUN_PENDING;
      finished = false;
    }
  }

  // 4. A entrada passa a contar a partir de agora.
  if (finished) await saveAccount(run, { calendar_since: now.toISOString(), calendar_sync_token: nextSyncToken });
}

// ---- entrada ---------------------------------------------------------------------------------------------------

/** Atividades ligadas aos eventos (pelo vínculo desta caixa, ou pelo `oxynActivityId`). */
async function resolveEvents(run: AccountRun, events: CalendarEvent[]): Promise<Map<string, Resolved>> {
  const { db } = run.deps;
  const byEvent = new Map<string, LinkedRow>();
  for (const part of chunks([...new Set(events.map((e) => e.id))])) {
    const { data, error } = await db
      .from("activities")
      .select(LINKED_COLUMNS)
      .eq("calendar_account_id", run.acc.id)
      .in("calendar_event_id", part);
    check(error, "ler as atividades ligadas aos eventos");
    for (const r of (data ?? []) as unknown as LinkedRow[]) byEvent.set(r.calendar_event_id!, r);
  }

  // Id vindo do Google: só uuid vai para a consulta (outro texto daria erro de tipo no banco).
  const oxynId = (e: CalendarEvent) => {
    const id = e.extendedProperties?.private?.oxynActivityId;
    return isUuid(id) ? id : null;
  };
  const byId = new Map<string, LinkedRow>();
  const wanted = [...new Set(events.filter((e) => !byEvent.has(e.id)).map(oxynId))].filter((id) => id !== null);
  for (const part of chunks(wanted)) {
    const { data, error } = await db.from("activities").select(LINKED_COLUMNS).in("id", part);
    check(error, "ler as atividades dos eventos do CRM");
    for (const r of (data ?? []) as unknown as LinkedRow[]) byId.set(r.id, r);
  }

  const out = new Map<string, Resolved>();
  for (const e of events) {
    const linked = byEvent.get(e.id);
    if (linked) {
      out.set(e.id, { kind: "known", row: linked, relink: false });
      continue;
    }
    const id = oxynId(e);
    const row = id ? byId.get(id) : undefined;
    // Atividade apagada de vez: o evento é tratado como novo (spec, "Erros").
    if (!row) {
      out.set(e.id, { kind: "unknown" });
      continue;
    }
    // Órfão: o evento existe e a atividade do mesmo dono ficou sem vínculo (ou sem a caixa). Evento apagado nunca
    // religa: é o eco do CRM apagando (lixeira, cancelada, dono trocado), e a atividade não pode ser concluída por isso.
    const unlinked = !row.calendar_event_id || (row.calendar_event_id === e.id && !row.calendar_account_id);
    const orphan = e.status !== "cancelled" && unlinked && row.owner_id === run.acc.user_id;
    out.set(e.id, orphan ? { kind: "known", row, relink: true } : { kind: "foreign" });
  }
  return out;
}

/**
 * Aplica as regras de entrada a uma lista. Devolve `false` se o orçamento acabou no meio (o token não é gravado).
 * Evento novo só vira atividade com a Agenda ligada na empresa da caixa; a mudança num evento já ligado vale sempre.
 * Um evento que falha (banco, regra) vai para o resultado e o log e é pulado: o token avança, para um erro fixo num
 * evento não travar a caixa.
 */
async function applyEvents(
  run: AccountRun,
  events: CalendarEvent[],
  since: Date,
  now: Date,
  resolved?: Map<string, Resolved>,
): Promise<boolean> {
  const map = resolved ?? (await resolveEvents(run, events));
  const createsNew = run.enabled.has(run.acc.company_id);
  for (const ev of events) {
    if (!run.timeLeft()) return false;
    try {
      const res = map.get(ev.id) ?? { kind: "unknown" };
      if (res.kind === "foreign") continue;
      const known = res.kind === "known" ? res.row : null;
      const c = classifyInbound(ev, { knownActivityId: known?.id ?? null, since, now });
      if (c.kind === "linked") await applyLinked(run, ev, known!, res.kind === "known" && res.relink);
      else if (c.kind === "cancelled") await applyCancelled(run, known!, now);
      else if (c.kind === "new" && createsNew) {
        map.set(ev.id, { kind: "known", row: await createFromEvent(run, ev), relink: false });
      }
    } catch (e) {
      eventFailed(run, ev, e);
    }
  }
  return true;
}

function eventFailed(run: AccountRun, ev: CalendarEvent, e: unknown): void {
  run.result.eventErrors = (run.result.eventErrors ?? 0) + 1;
  console.error("agenda: falha no evento; pulado", run.acc.id, ev.id, errorMessage(e));
}

/** Horário, duração e título do evento que diferem da atividade (duração 0 no CRM vale os 15 min do evento). */
function eventChanges(row: LinkedRow, ev: CalendarEvent): InboundPatch {
  const out: InboundPatch = {};
  // Evento de dia inteiro (ou sem horário legível): o horário fica como está.
  const times = eventTimes(ev);
  if (times) {
    if (Date.parse(times.dueAt) !== Date.parse(row.due_at)) out.due_at = times.dueAt;
    const current = row.duration_minutes > 0 ? row.duration_minutes : DEFAULT_MINUTES;
    if (times.durationMinutes !== current) out.duration_minutes = times.durationMinutes;
  }
  // O título de evento particular não entra no CRM (a atividade dele mostra "Ocupado").
  const title = isPrivate(ev) ? "" : truncate(ev.summary?.trim() ?? "", MAX_SUBJECT);
  if (title && title !== row.subject.trim()) out.subject = title;
  return out;
}

/**
 * Evento ligado a uma atividade:
 * - mesmo `etag` que o CRM gravou: é o eco do próprio envio, ignora;
 * - horário ou título diferentes: com a atividade em dia (`synced` ou `none`), não há mudança do CRM por enviar e a
 *   Agenda vence. Com mudança do CRM por enviar (`pending` ou `error`), vale o lado mais recente: a hora da mudança no
 *   CRM (`calendar_local_changed_at`) contra o `updated` do evento. Agenda → aplica com a marca de entrada (a pendente
 *   continua pendente, e o envio leva o estado já mesclado); CRM → a atividade volta a ser pendente e o envio leva a
 *   versão do CRM;
 * - só o `etag` mudou (convidado respondeu, descrição, Meet criado depois): grava o `etag` e preenche o Meet vazio,
 *   sem marcar pendente (um envio à toa mandaria e-mail ao cliente).
 * O primeiro convidado lido fica registrado quando a atividade ainda não tinha nenhum: o evento com convidado não
 * recebe mais a descrição interna. Atividade concluída ou na lixeira não muda de horário nem de título: o evento ficou
 * como histórico.
 */
async function applyLinked(run: AccountRun, ev: CalendarEvent, row: LinkedRow, relink: boolean): Promise<void> {
  const { db } = run.deps;
  if (relink && row.calendar_account_id && row.calendar_event_id !== ev.id) return; // já religada a outro evento
  if (!relink && ev.etag && ev.etag === row.calendar_etag) return;

  const base: InboundPatch = relink ? { calendar_account_id: run.acc.id, calendar_event_id: ev.id } : {};
  base.calendar_etag = ev.etag ?? null;
  const link = meetingLink(ev);
  if (!row.meet_url && link) base.meet_url = link;
  const guest = row.calendar_invited_email ? undefined : eventGuests(ev, run.acc.email)[0];
  if (guest) base.calendar_invited_email = guest;
  if (relink) run.relinked.add(row.id);

  const changes = row.done || row.deleted_at ? {} : eventChanges(row, ev);
  if (Object.keys(changes).length === 0) {
    await applyInbound(db, row.id, base);
    Object.assign(row, base);
    return;
  }
  const crmChanged = row.calendar_state === "pending" || row.calendar_state === "error";
  if (!crmChanged || newerSide(row.calendar_local_changed_at, ev.updated) === "google") {
    await applyInbound(db, row.id, { ...base, ...changes });
    Object.assign(row, base, changes);
    run.result.pulled++;
    return;
  }
  const fields = { ...base, calendar_state: "pending" as const, calendar_attempts: 0, calendar_error: null };
  const { error } = await db.rpc("calendar_mark_synced", { p_activity: row.id, p_fields: fields });
  check(error, "marcar a atividade para reenviar à Agenda");
  Object.assign(row, base, { calendar_state: "pending" });
}

/**
 * Evento ligado apagado ou cancelado na Agenda: reunião aberta é concluída como cancelada, os outros tipos vão para a
 * lixeira. O vínculo é desfeito (como no envio que apaga), para restaurar da lixeira criar um evento novo. Atividade já
 * concluída ou na lixeira é ignorada: é o eco do próprio CRM apagando o evento.
 */
async function applyCancelled(run: AccountRun, row: LinkedRow, now: Date): Promise<void> {
  if (row.done || row.deleted_at) return;
  const at = now.toISOString();
  const unlink: InboundPatch = { calendar_account_id: null, calendar_event_id: null, calendar_etag: null, calendar_state: "synced" };
  // `done` e `completed_at` andam juntos (check da tabela).
  const patch: InboundPatch = (await isMeetingType(run, row.type_id))
    ? { ...unlink, done: true, completed_at: at, meeting_outcome: "canceled" }
    : { ...unlink, deleted_at: at };
  await applyInbound(run.deps.db, row.id, patch);
  Object.assign(row, patch);
  run.result.pulled++;
}

async function isMeetingType(run: AccountRun, typeId: string): Promise<boolean> {
  const cached = run.meetingTypes.get(typeId);
  if (cached !== undefined) return cached;
  const { data, error } = await run.deps.db.from("activity_types").select("is_meeting").eq("id", typeId).maybeSingle();
  check(error, "ler o tipo da atividade");
  const meeting = (data as { is_meeting: boolean } | null)?.is_meeting === true;
  run.meetingTypes.set(typeId, meeting);
  return meeting;
}

/** Tipos e canais da empresa da caixa, lidos uma vez por rodada (só se algum evento novo precisar). */
function catalog(run: AccountRun): Promise<{ types: TypeRow[]; channels: ChannelRow[] }> {
  run.catalog ??= (async () => {
    const { db } = run.deps;
    const [types, channels] = await Promise.all([
      db
        .from("activity_types")
        .select("id, name, is_meeting, active")
        .eq("company_id", run.acc.company_id)
        .order("position", { ascending: true }),
      db
        .from("activity_channels")
        .select("id, name, active, is_legacy")
        .eq("company_id", run.acc.company_id)
        .order("position", { ascending: true }),
    ]);
    check(types.error, "ler os tipos de atividade");
    check(channels.error, "ler os canais de atividade");
    return { types: (types.data ?? []) as TypeRow[], channels: (channels.data ?? []) as ChannelRow[] };
  })();
  return run.catalog;
}

/**
 * Tipo da atividade nova: reunião → o primeiro tipo de reunião ativo; tarefa → "Tarefa", senão o primeiro tipo ativo
 * que não é reunião. Faltando o tipo procurado, vale o outro (a empresa sempre tem um tipo de reunião ativo).
 */
function pickType(types: TypeRow[], kind: "meeting" | "task"): string {
  const active = types.filter((t) => t.active);
  const meeting = active.find((t) => t.is_meeting);
  const task = active.find((t) => sameName(t.name, TASK_TYPE)) ?? active.find((t) => !t.is_meeting);
  const chosen = kind === "meeting" ? (meeting ?? task) : (task ?? meeting);
  if (!chosen) throw new Error("A empresa não tem tipo de atividade ativo");
  return chosen.id;
}

/** Canal da atividade nova: pelo nome; sem canal claro, ou sem esse nome ativo na empresa, o canal legado. */
function pickChannel(channels: ChannelRow[], channel: "video" | "in_person" | "unknown"): string {
  const named = channel === "unknown" ? undefined : channels.find((c) => c.active && sameName(c.name, CHANNEL_NAMES[channel]));
  const chosen = named ?? channels.find((c) => c.is_legacy) ?? channels.find((c) => c.active);
  if (!chosen) throw new Error("A empresa não tem canal de atividade");
  return chosen.id;
}

/**
 * Evento novo criado direto na Agenda vira atividade (`source = 'google_calendar'`), da empresa e do dono da caixa,
 * já em dia com o evento (`synced`). O vínculo vem do casador do assistente de reuniões; sem candidato, fica sem
 * vínculo.
 */
async function createFromEvent(run: AccountRun, ev: CalendarEvent): Promise<LinkedRow> {
  const { db } = run.deps;
  const f = newActivityFields(ev, { selfEmail: run.acc.email });
  const { types, channels } = await catalog(run);
  const typeId = pickType(types, f.kind);

  const link: Partial<Record<(typeof LINK_COLUMN)[keyof typeof LINK_COLUMN], string>> = {};
  if (f.attendeeEmails.length > 0) {
    const picked = pickRecord(await loadCandidates(db, run.acc.company_id, f.attendeeEmails), new Date(f.dueAt));
    if (picked) link[LINK_COLUMN[picked.entity]] = picked.recordId;
  }

  const { data, error } = await db.rpc("calendar_insert_inbound", {
    p_row: {
      company_id: run.acc.company_id,
      owner_id: run.acc.user_id,
      type_id: typeId,
      channel_id: pickChannel(channels, f.channel),
      subject: f.subject,
      description: f.description,
      due_at: f.dueAt,
      duration_minutes: f.durationMinutes,
      ...link,
      calendar_account_id: run.acc.id,
      calendar_event_id: ev.id,
      calendar_etag: ev.etag ?? null,
      calendar_state: "synced",
      meet_url: f.meetUrl,
      calendar_is_organizer: ev.organizer?.self === true,
    },
  });
  check(error, "criar a atividade do evento da Agenda");
  if (typeof data !== "string") throw new Error("Falha ao criar a atividade do evento da Agenda: sem id");
  run.result.created++;
  return {
    id: data,
    owner_id: run.acc.user_id,
    type_id: typeId,
    subject: f.subject,
    due_at: f.dueAt,
    duration_minutes: f.durationMinutes,
    done: false,
    deleted_at: null,
    updated_at: run.deps.now().toISOString(),
    calendar_account_id: run.acc.id,
    calendar_event_id: ev.id,
    calendar_etag: ev.etag ?? null,
    meet_url: f.meetUrl,
    calendar_state: "synced",
    calendar_local_changed_at: null,
    calendar_invited_email: null,
  };
}

/**
 * Passada de janela: as ocorrências de recorrentes desconhecidas que agora estão a até 7 dias viram atividade. As
 * conhecidas ficam com a leitura incremental. Só cria com a Agenda ligada na empresa da caixa.
 */
async function windowPass(run: AccountRun, since: Date, now: Date): Promise<void> {
  if (!run.enabled.has(run.acc.company_id)) return;
  const until = new Date(now.getTime() + RECURRING_WINDOW_DAYS * DAY_MS);
  const events = (await run.calendar.listWindow(now, until)).filter((e) => e.recurringEventId);
  if (events.length === 0) return;
  const resolved = await resolveEvents(run, events);
  for (const ev of events) {
    if (!run.timeLeft()) return;
    if (resolved.get(ev.id)?.kind !== "unknown") continue;
    if (classifyInbound(ev, { knownActivityId: null, since, now }).kind !== "new") continue;
    try {
      resolved.set(ev.id, { kind: "known", row: await createFromEvent(run, ev), relink: false });
    } catch (e) {
      eventFailed(run, ev, e);
    }
  }
}

/** Grava a mudança da Agenda com a marca de entrada (o gatilho não marca a atividade como pendente). */
async function applyInbound(db: SupabaseClient, activityId: string, patch: InboundPatch): Promise<void> {
  const { error } = await db.rpc("calendar_apply_inbound", { p_activity: activityId, p_patch: patch });
  check(error, "gravar a mudança da Agenda na atividade");
}
