# Agenda do Google nos dois sentidos — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sincronizar as atividades do CRM com a Agenda do Google do vendedor, nos dois sentidos, com convite e link do Meet para reuniões com cliente. Fica desligada por empresa até a virada.

**Architecture:**
- **Banco:** colunas novas em `activities` e `email_accounts`. Um gatilho marca a atividade como pendente quando muda algo que aparece no evento, desde que a empresa esteja com a Agenda ligada.
- **Cliente HTTP da Agenda:** fica em `src/lib/calendar/google.ts`, sobre helpers do Google extraídos de `src/lib/meet/google.ts`.
- **Funções puras de conversão:** ficam em `src/lib/calendar/mapping.ts`.
- **Sincronização:** fica em `src/lib/calendar/sync.ts`.
  - **Saída:** `pushActivity`.
  - **Entrada:** `pullAccount`, uma passada de janela para as recorrentes, e a primeira rodada com adoção.
  - **Orquestração:** `runCalendarSync`, chamada pelo cron `/api/cron/agenda`.
- **Server actions de atividade:** enviam na hora depois de gravar, e o cron cobre o que ficar pendente.

**Tech Stack:** Next.js 16, Supabase (Postgres, gatilhos), Google Calendar API v3, TypeScript, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-09-agenda-google-design.md`

## Global Constraints

- **Idioma:** textos de interface, erros e comentários em português do Brasil, no estilo do código vizinho.
- **Comandos:** rodar com `export PATH=$HOME/.local/node/bin:$PATH`. Antes de cada commit, `pnpm typecheck`, `pnpm lint` e o vitest da área precisam passar.
- **Banco:** só existe o de produção. Nunca rodar migration nem nada que escreva no banco ou chame o Google de verdade, porque quem aplica é o controlador, com o ok do usuário.
- **Next.js 16:** antes de escrever server action, route handler ou componente servidor, ler o guia em `node_modules/next/dist/docs/`.
- **Rotas de cron:** toda rota nova entra em `SELF_AUTH` (`src/lib/supabase/middleware.ts`) e em `vercel.json`, e usa `isCronAuthorized`, como `src/app/api/cron/meet/route.ts`.
- **Edição:** não reformatar arquivos inteiros; mexer só nas linhas da tarefa.
- **Commits:** em português, terminando com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Valores da spec:**
  - escopo `https://www.googleapis.com/auth/calendar.events`, que substitui o `calendar.events.readonly`;
  - cron a cada 5 min, `maxDuration` 300;
  - duração 0 vira 15 min;
  - recorrentes só quando faltam até 7 dias;
  - evento particular entra como "Ocupado";
  - 3 tentativas antes de ficar só no "Tentar de novo";
  - fuso `America/Sao_Paulo`;
  - `extendedProperties.private.oxynActivityId`.

## Review Focus

1. **A mesma mudança indo e voltando sem fim (eco).** Um evento gravado pelo CRM não pode voltar como mudança, e uma mudança aplicada pela entrada não pode voltar a ser pendente. Testes nas Tasks 4 e 5.
2. **Reunião antiga do Pipedrive na primeira rodada.** O cliente não pode receber convite de novo, e não pode surgir um evento duplicado. Teste na Task 5.
3. **Evento apagado pelo próprio CRM** (lixeira, ou reunião cancelada no CRM). Quando ele volta na entrada, não pode concluir de novo nem mandar outra atividade para a lixeira. Teste na Task 5.
4. **Vendedor sem caixa conectada, ou com a caixa em "reconectar".** As atividades dele ficam pendentes, sem erro em cascata e sem travar as outras caixas. Teste na Task 5.
5. **Atividade de uma empresa com a Agenda desligada.** Não marca pendente e nunca vai para o Google. Teste na Task 1 (revisão do SQL) e na Task 4.

---

### Task 1: Migration

**Files:**
- Create: `supabase/migrations/20261111000001_calendar_sync.sql`

**Interfaces:**
- Produces:
  - **Em `activities`:**
    - `source text not null default 'crm' check (source in ('crm','pipedrive','google_calendar'))`;
    - `calendar_account_id uuid references email_accounts on delete set null`;
    - `calendar_event_id text`, `calendar_etag text`;
    - `calendar_state text not null default 'none' check (calendar_state in ('none','pending','synced','error'))`;
    - `calendar_error text`, `calendar_attempts int not null default 0`, `meet_url text`.
  - **Em `email_accounts`:** `calendar_sync_token text`, `calendar_lock_until timestamptz` e `calendar_since timestamptz`.
  - **Funções:** `public.calendar_sync_enabled(p_company uuid) returns boolean`, e o gatilho `activities_calendar_pending`.

- [ ] **Step 1: Escrever a migration**

- **Colunas novas.** As de `activities` têm o índice `activities_calendar_pending_idx` em `(calendar_state)` com `where calendar_state in ('pending','error')`, e o índice `activities_calendar_event_idx` em `(calendar_account_id, calendar_event_id)`.
- **Origem das atividades:**
  - `update activities set source = 'pipedrive' where legacy`, para as importadas;
  - um gatilho `before insert` (`activities_source_import`) que põe `new.source := 'pipedrive'` quando `public.importing()`.
- **Vínculo obrigatório:** `alter table activities drop constraint activities_check` (nome conferido no banco: é a regra de vínculo obrigatório) e `add constraint activities_link_check check (lead_id is not null or deal_id is not null or person_id is not null or organization_id is not null or source = 'google_calendar')`.
- **`calendar_sync_enabled(p_company)`:** `language sql stable security definer`. Devolve `coalesce((settings->'calendar_sync'->>'enabled')::boolean, false)` da empresa.
- **Gatilho `activities_calendar_pending`** (`before insert or update`):
  - não faz nada quando `public.importing()` ou quando `current_setting('oxyn.calendar_inbound', true) = 'on'`;
  - não faz nada quando `calendar_sync_enabled(new.company_id)` é falso;
  - no insert, põe `calendar_state = 'pending'`, `calendar_attempts = 0` e `calendar_error = null`;
  - no update, faz o mesmo quando muda alguma destas colunas: `subject`, `description`, `due_at`, `duration_minutes`, `done`, `meeting_outcome`, `deleted_at`, `owner_id`, `person_id`, `type_id`;
  - mudanças só nas colunas `calendar_*` e `meet_url` não marcam.
- Funções `security definer` só para o service role (`revoke ... from public, anon, authenticated; grant execute ... to service_role`), todas com `perform set_config('oxyn.calendar_inbound','on', true)` antes de gravar:
  - `calendar_mark_synced(p_activity uuid, p_fields jsonb) returns void` — grava só as chaves presentes entre `calendar_account_id, calendar_event_id, calendar_etag, calendar_state, calendar_error, calendar_attempts, meet_url`;
  - `calendar_apply_inbound(p_activity uuid, p_patch jsonb) returns void` — grava só as chaves presentes entre `subject, due_at, duration_minutes, deleted_at, done, completed_at, meeting_outcome, calendar_account_id, calendar_event_id, calendar_etag, calendar_state, meet_url`;
  - `calendar_insert_inbound(p_row jsonb) returns uuid` — insere a atividade com `source = 'google_calendar'` e `created_by = owner_id`, com as colunas presentes em `p_row` (company_id, owner_id, type_id, channel_id, subject, description, due_at, duration_minutes, lead_id, deal_id, person_id, organization_id, `calendar_*`, meet_url), e devolve o id.
- **Comentário no topo:** o que é cada coluna e que a entrada grava com `set_config('oxyn.calendar_inbound','on', true)`.

- [ ] **Step 2: Conferir sem aplicar**

Reler contra a spec ("Modelo de dados"). Run: `grep -c "add column" supabase/migrations/20261111000001_calendar_sync.sql`. Expected: ≥ 11. NÃO aplicar.

- [ ] **Step 3: Commit**

`git commit -m "feat(agenda): colunas e gatilho da sincronização com a Agenda do Google"`

---

### Task 2: Cliente HTTP da Agenda

**Files:**
- Create: `src/lib/google/http.ts`, `src/lib/calendar/google.ts`
- Modify: `src/lib/meet/google.ts`, para usar os helpers extraídos sem mudar o comportamento
- Test: `src/lib/calendar/google.test.ts`, e os testes de `src/lib/meet/google.test.ts` continuam passando

**Interfaces:**
- Produces:
```ts
// src/lib/google/http.ts — extraído de meet/google.ts: http, readJson, buildUrl, isRateLimit e a renovação no 401.
export type GoogleQuery = Record<string, string | number | boolean | undefined>;
export function googleRequest<T>(
  getAccessToken: (opts?: TokenRequest) => Promise<string>,
  url: string,
  init?: { method?: "GET" | "POST" | "PATCH" | "DELETE"; body?: unknown },
): Promise<T | null>; // 204 e DELETE devolvem null
export function buildUrl(base: string, path: string, query?: GoogleQuery): string;

// src/lib/calendar/google.ts
export type CalendarEvent = {
  id: string; etag?: string; status?: "confirmed" | "tentative" | "cancelled"; summary?: string; description?: string;
  location?: string; visibility?: "default" | "public" | "private" | "confidential"; eventType?: string;
  start?: { dateTime?: string; date?: string; timeZone?: string }; end?: { dateTime?: string; date?: string; timeZone?: string };
  attendees?: { email: string; displayName?: string; self?: boolean; responseStatus?: string; organizer?: boolean; resource?: boolean }[];
  hangoutLink?: string; conferenceData?: { conferenceId?: string; entryPoints?: { entryPointType?: string; uri?: string }[] };
  recurringEventId?: string; updated?: string; extendedProperties?: { private?: Record<string, string> };
};
export class SyncTokenExpiredError extends Error {}
export class CalendarClient {
  constructor(getAccessToken: (opts?: TokenRequest) => Promise<string>);
  listChanges(syncToken: string): Promise<{ events: CalendarEvent[]; nextSyncToken: string }>;      // pagina; 410 → SyncTokenExpiredError
  listFrom(timeMin: Date): Promise<{ events: CalendarEvent[]; nextSyncToken: string }>;              // primeira carga (showDeleted, singleEvents)
  listWindow(timeMin: Date, timeMax: Date): Promise<CalendarEvent[]>;                                // singleEvents=true, orderBy=startTime
  insertEvent(ev: Partial<CalendarEvent>, opts: { sendUpdates: "all" | "none"; withMeet: boolean }): Promise<CalendarEvent>;
  patchEvent(id: string, ev: Partial<CalendarEvent>, opts: { sendUpdates: "all" | "none" }): Promise<CalendarEvent>;
  deleteEvent(id: string, opts: { sendUpdates: "all" | "none" }): Promise<void>;                    // 404/410 = já apagado, sem erro
}
export function calendarClientForAccount(accountId: string): CalendarClient;
```

- [ ] **Step 1: Testes que falham**

`src/lib/calendar/google.test.ts`, com `fetch` falso, no estilo de `src/lib/meet/google.test.ts`:
- `listChanges` pagina por `nextPageToken`, devolve o `nextSyncToken` da última página e envia `syncToken`, `showDeleted=true` e `singleEvents=true`;
- 410 vira `SyncTokenExpiredError`;
- `listFrom` envia `timeMin` (ISO), `showDeleted=true` e `singleEvents=true`;
- `insertEvent` com `withMeet` envia `conferenceDataVersion=1` e `sendUpdates=all` na query, e o corpo vai como JSON;
- `patchEvent` usa `PATCH` em `/calendars/primary/events/{id}`;
- `deleteEvent` com 404 ou 410 não lança;
- 401 renova o token uma vez; 429 vira `GmailRateLimitError`.

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm vitest run src/lib/calendar/google.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implementar**

Extrair os helpers para `src/lib/google/http.ts` e aceitar método e corpo. `meet/google.ts` passa a usar os helpers extraídos. O `CalendarClient` usa a base `https://www.googleapis.com/calendar/v3` e o calendário `primary`, e `calendarClientForAccount` reaproveita `loadAccountToken`.

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm vitest run src/lib/calendar src/lib/meet/google.test.ts && pnpm typecheck`. Expected: PASS.

- [ ] **Step 5: Commit**

`git commit -m "feat(agenda): cliente da Agenda do Google"`

---

### Task 3: Conversões puras

**Files:**
- Create: `src/lib/calendar/mapping.ts`
- Test: `src/lib/calendar/mapping.test.ts`

**Interfaces:**
- Produces:
```ts
export const DEFAULT_MINUTES = 15;
export const RECURRING_WINDOW_DAYS = 7;
export const BUSY_SUBJECT = "Ocupado";
export const SKIPPED_EVENT_TYPES: readonly string[]; // ["outOfOffice","focusTime","workingLocation","birthday"]
export type ActivityForCalendar = {
  id: string; companyId: string; ownerId: string; subject: string; description: string | null; dueAt: string; durationMinutes: number;
  done: boolean; meetingOutcome: string | null; deletedAt: string | null; isMeeting: boolean; personEmail: string | null;
  recordUrl: string | null; calendarEventId: string | null; calendarAccountId: string | null; updatedAt: string;
};
export function activityToEvent(a: ActivityForCalendar, opts: { invite: boolean }): Partial<CalendarEvent>;
export function wantsInvite(a: ActivityForCalendar): boolean; // reunião aberta com e-mail da pessoa
export type Outbound =
  | { op: "create" } | { op: "update" } | { op: "delete"; notify: boolean } | { op: "none" };
export function outboundOp(a: ActivityForCalendar): Outbound;
export type Inbound =
  | { kind: "skip"; reason: "declined" | "all_day" | "event_type" | "before_since" | "recurring_far" | "cancelled_unknown" }
  | { kind: "linked"; activityId: string } | { kind: "cancelled"; activityId: string } | { kind: "new" };
export function classifyInbound(ev: CalendarEvent, ctx: { knownActivityId: string | null; since: Date; now: Date }): Inbound;
export function eventTimes(ev: CalendarEvent): { dueAt: string; durationMinutes: number } | null;
export function newActivityFields(ev: CalendarEvent, ctx: { selfEmail: string }): {
  subject: string; description: string | null; dueAt: string; durationMinutes: number;
  kind: "meeting" | "task"; channel: "video" | "in_person" | "unknown"; attendeeEmails: string[]; meetUrl: string | null;
};
export function newerSide(activityUpdatedAt: string, eventUpdated: string | undefined): "crm" | "google";
```

- [ ] **Step 1: Testes que falham**

- **`activityToEvent`:**
  - `summary` é o assunto;
  - a descrição é `description` mais `\n\nNo CRM: {recordUrl}`, sem o trecho quando não há URL;
  - `start.dateTime` é `dueAt` com `timeZone "America/Sao_Paulo"`, e o fim é o início mais a duração;
  - duração 0 vira 15 min;
  - grava `extendedProperties.private.oxynActivityId`;
  - com `invite`, inclui `attendees [{email: personEmail}]`; sem `invite`, não leva `attendees`.
- **`wantsInvite`:** verdadeiro só com `isMeeting`, `personEmail` presente, atividade não concluída e não apagada.
- **`outboundOp`:**
  - na lixeira e com evento → `delete` (`notify` se é reunião com e-mail);
  - concluída como `canceled` e com evento → `delete` (`notify` igual);
  - na lixeira e sem evento → `none`;
  - concluída com outro resultado → `none`;
  - aberta sem evento → `create`; aberta com evento → `update`.
- **`classifyInbound`:**
  - `cancelled` com atividade conhecida → `cancelled`; `cancelled` desconhecido → `skip cancelled_unknown`;
  - `start.date` (dia inteiro) → `skip all_day`;
  - `eventType` na lista → `skip event_type`;
  - `attendees[].self` com `responseStatus "declined"` → `skip declined`;
  - início antes de `since` → `skip before_since`;
  - `recurringEventId` com início depois de `now + 7 dias` → `skip recurring_far`;
  - atividade conhecida → `linked`; senão `new`.
- **`newActivityFields`:**
  - `visibility "private"` ou `"confidential"` → assunto `"Ocupado"`, sem descrição e com `attendeeEmails []`;
  - `kind "meeting"` quando há convidado que não é `self` nem `resource`, ou quando há `hangoutLink`/`conferenceData`; senão `"task"`;
  - `channel`: `"video"` com link de reunião, `"in_person"` com `location` e sem link, senão `"unknown"`;
  - assunto vazio → `"(sem título)"`, cortado em 200;
  - descrição cortada em 5000;
  - duração limitada a 0..1440.
- **`newerSide`:** compara os instantes; sem `updated` no evento → `"crm"`.

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm vitest run src/lib/calendar/mapping.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implementar**

Funções puras.

- [ ] **Step 4: Rodar e ver passar**

Mesmo comando. Expected: PASS.

- [ ] **Step 5: Commit**

`git commit -m "feat(agenda): conversões entre atividade e evento"`

---

### Task 4: Saída (CRM → Agenda)

**Files:**
- Create: `src/lib/calendar/push.ts`
- Test: `src/lib/calendar/push.test.ts`. Use o banco falso de `src/lib/meet/fake-db.test-support.ts`, estendido se faltar algo.

**Interfaces:**
- Consumes: `CalendarClient` (Task 2) e as funções da Task 3.
- Produces:
```ts
export type CalendarDeps = { db: SupabaseClient; clientFor(accountId: string): CalendarClient; now(): Date; appUrl: string };
export const MAX_CALENDAR_ATTEMPTS = 3;
/** Caixa que recebe a atividade: do dono na empresa da atividade; senão a mais antiga do dono; ativa e com o escopo da Agenda. */
export async function calendarAccountFor(db: SupabaseClient, ownerId: string, companyId: string): Promise<{ id: string; email: string } | null>;
/** Envia uma atividade pendente. Devolve o estado final. Nunca lança por erro do Google (grava `error`). */
export async function pushActivity(deps: CalendarDeps, activityId: string, opts?: { invite?: boolean }): Promise<"synced" | "error" | "skipped">;
```

- [ ] **Step 1: Testes que falham**

- **Empresa com a Agenda desligada:** devolve `skipped` sem chamar o Google.
- **Sem caixa:** `skipped`; a atividade continua `pending`.
- **Criação:**
  - chama `insertEvent` com `withMeet` e `sendUpdates "all"` quando `wantsInvite` e `opts.invite !== false`;
  - grava `calendar_event_id`, `calendar_etag`, `calendar_account_id`, `meet_url` (do `hangoutLink`), `calendar_state "synced"` e `calendar_attempts 0`;
  - grava com `oxyn.calendar_inbound`, para o gatilho não marcar de novo. Pelo banco falso, isso é conferido pela coluna gravada; a marca de sessão é usada via RPC ou update direto, como a implementação escolher, desde que documentado.
- **Dono trocado:** com o evento em outra caixa (`calendar_account_id` diferente da caixa resolvida), apaga lá (`deleteEvent`) e cria na nova.
- **Atualização:** `patchEvent` com os campos de `activityToEvent`. `sendUpdates "all"` só quando a reunião tem convidado.
- **Apagar:** `deleteEvent`, depois limpa `calendar_event_id` e põe `synced`.
- **Erro do Google:**
  - `calendar_state "error"`, `calendar_error` com a mensagem e `calendar_attempts + 1`;
  - limite de uso (`GmailRateLimitError`) não conta tentativa e fica `pending`;
  - token inválido (`GmailAuthError` depois de renovar) fica `pending`, sem contar tentativa, e a caixa vai para "reconectar" pelo fluxo existente de `loadAccountToken`.
- **Sem eco:** o `etag` devolvido pelo Google é gravado.

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm vitest run src/lib/calendar/push.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implementar**

- **Leitura:** a atividade vem com o tipo (`is_meeting`), o e-mail principal da pessoa (o primeiro de `persons.emails`, no formato que o banco usa; conferir na tabela) e a URL do registro, que é `{appUrl}/{slug da empresa}/{negocios|leads|contatos/pessoas|contatos/organizacoes}/{id}`, pelo vínculo de maior precedência.
- **Gravação de volta:** para não disparar o gatilho, usar a RPC `calendar_mark_synced` (Task 1).

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm vitest run src/lib/calendar && pnpm typecheck`. Expected: PASS.

- [ ] **Step 5: Commit**

`git commit -m "feat(agenda): envio das atividades para a Agenda"`

---

### Task 5: Entrada, primeira rodada e cron

**Files:**
- Create: `src/lib/calendar/sync.ts`, `src/app/api/cron/agenda/route.ts`
- Modify: `vercel.json`, `src/lib/supabase/middleware.ts` (`SELF_AUTH`)
- Test: `src/lib/calendar/sync.test.ts`

**Interfaces:**
- Consumes: Tasks 2–4; `loadCandidates` e `pickRecord` (`src/lib/meet/match-loader.ts`, `src/lib/meet/match.ts`).
- Produces:
```ts
export async function runCalendarSync(deps: CalendarDeps, opts: { budgetMs: number }): Promise<{ accountId: string; pushed: number; pulled: number; created: number; error?: string }[]>;
```

- [ ] **Step 1: Testes que falham**

Com o Google e o banco falsos.

- **Caixas que entram:** só as ativas, com o escopo `calendar.events` e cuja empresa tem a Agenda ligada. O lease é por caixa (`calendar_lock_until`), como no `runMeetSync`.

- **Primeira rodada (`calendar_since` nulo):**
  - **Adota:** para cada atividade aberta do dono com `due_at >= now`, procura em `listFrom(now)` um evento com o mesmo início, até o minuto, e o mesmo título, sem diferenciar maiúsculas e espaços. Achou: grava `calendar_event_id` e `etag`, sem convidar, e marca `synced`.
  - **Cria o que falta sem convite:** `pushActivity(..., { invite: false })`.
  - Grava `calendar_since = now` e o `calendar_sync_token` devolvido.
  - Os eventos dessa primeira lista que não foram adotados seguem as regras de entrada (`classifyInbound`).

- **Rodadas seguintes:**
  1. Envia as pendentes do dono, e as `error` com `calendar_attempts < 3`.
  2. `listChanges(token)` e aplica:
     - **`linked`:** se o `etag` do evento é igual ao da atividade, ignora (eco). Senão, aplica o horário e o título com a marca `oxyn.calendar_inbound`, se `newerSide` der `google`; se der `crm`, marca a atividade como pendente para reenviar.
     - **`cancelled`:** atividade aberta → reunião é concluída com `meeting_outcome 'canceled'`, `done`, `completed_at = now`; os outros tipos vão para a lixeira (`deleted_at = now`), tudo com a marca. Atividade já concluída ou na lixeira → ignora.
     - **`new`:** cria a atividade (`source 'google_calendar'`):
       - empresa e dono vêm da caixa;
       - tipo: o primeiro `is_meeting` ativo para `"meeting"`, senão `"Tarefa"` pelo nome, senão o primeiro tipo ativo sem `is_meeting`;
       - canal: `"Videochamada"` para `"video"`, `"Presencial"` para `"in_person"`; para `"unknown"` ou um nome que falte, o canal `is_legacy` da empresa;
       - vínculo: `loadCandidates(empresa, attendeeEmails)` e depois `pickRecord`, que dá negócio, lead ou pessoa e grava o campo certo. Sem candidato, fica sem vínculo;
       - `calendar_event_id`, `calendar_etag`, `calendar_account_id`, `meet_url` e `calendar_state 'synced'`;
       - tudo com a marca.
     - **`skip`:** ignora.
  3. Passada de janela: `listWindow(now, now + 7 dias)` e as recorrentes desconhecidas que agora estão dentro dos 7 dias viram `new`.
  4. Grava o novo `calendar_sync_token`. Com `SyncTokenExpiredError`, refaz pela primeira lista a partir de agora (sem adoção) e grava o token novo.

- **Isolamento:** erro numa caixa vai para o resultado dela e não para as outras. A caixa em "reconectar" é pulada.

- **Testes de Review Focus:**
  - evento que o CRM acabou de gravar (mesmo `etag`) não muda a atividade;
  - primeira rodada sem nenhum convite (`sendUpdates` nunca é `"all"`);
  - evento apagado pelo CRM e devolvido como `cancelled` não conclui de novo.

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm vitest run src/lib/calendar/sync.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implementar `sync.ts` e o cron**

- **Gravações com a marca de entrada:** aplicar horário e título, concluir como cancelada, mandar para a lixeira e adotar usam a RPC `calendar_apply_inbound`; criar usa `calendar_insert_inbound` (as duas da Task 1).
- **Rota:** igual à de `src/app/api/cron/meet/route.ts`, com `BUDGET_MS = 240_000` e `maxDuration = 300`. `appUrl` vem de `process.env.NEXT_PUBLIC_APP_URL` (conferir o nome usado no projeto) e `clientFor` de `calendarClientForAccount`.
- **Agendamento:** `vercel.json` ganha `{ "path": "/api/cron/agenda", "schedule": "*/5 * * * *" }`, e `SELF_AUTH` ganha `"/api/cron/agenda"`.

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm vitest run src/lib/calendar && pnpm typecheck && pnpm lint`. Expected: PASS.

- [ ] **Step 5: Commit**

`git commit -m "feat(agenda): entrada da Agenda, primeira rodada e cron"`

---

### Task 6: Escopo, configuração e envio na hora

**Files:**
- Modify: `src/lib/gmail/connect.ts`, que troca `calendar.events.readonly` por `calendar.events` em `MEET_SCOPES` e exporta `CALENDAR_SCOPE` e `hasCalendarScope`, e os testes de `connect`/`oauth`
- Create: `src/lib/calendar/settings.ts`, `src/lib/calendar/settings-actions.ts`, `src/lib/calendar/activity-hooks.ts`
- Modify: `src/lib/activities/actions.ts`
- Test: `src/lib/calendar/settings.test.ts`, `src/lib/calendar/activity-hooks.test.ts`

**Interfaces:**
- Produces:
  - `readCalendarSettings(settings: unknown): { enabled: boolean; enabledAt: string | null }` e `withCalendarSettings(settings: unknown, enabled: boolean, now: Date)`, no padrão de `src/lib/meet/settings.ts`;
  - `saveCalendarSync(companyId: string, enabled: boolean): Promise<ActionResult>`, só para o admin geral, no padrão de `src/lib/meet/settings-actions.ts`. Ao ligar, grava `enabled_at`.
  - `afterActivityWrite(activityId: string): Promise<void>`, que chama `pushActivity` com o cliente admin, um teto de 8 s e erros só no log;
  - `retryCalendarSync(activityId: string): Promise<ActionResult>`, que zera tentativas, marca pendente pelo cliente do usuário (a RLS confere a edição) e chama `afterActivityWrite`.

- [ ] **Step 1: Testes que falham**

- **Configuração:** padrão desligado; ligar grava `enabled_at`; desligar mantém o histórico de `enabled_at`.
- **`afterActivityWrite`:** com o Google lançando, não lança, e com o teto estourado devolve sem esperar.
- **Escopo:** `connect.test.ts` e `oauth.test.ts` passam a usar o escopo `calendar.events`.

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm vitest run src/lib/calendar src/lib/gmail`. Expected: FAIL.

- [ ] **Step 3: Implementar**

Em `src/lib/activities/actions.ts`, depois de cada gravação com sucesso, chamar `await afterActivityWrite(id)`: em `createActivity`, `updateActivity`, `completeActivity` (na atividade e no `nextId`/`meetingId` criados), `trashActivity` e `restoreActivity`.

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm vitest run && pnpm typecheck && pnpm lint`. Expected: PASS.

- [ ] **Step 5: Commit**

`git commit -m "feat(agenda): escopo, configuração por empresa e envio na hora"`

---

### Task 7: Interface

**Files:**
- Create: a página `src/app/(app)/configuracoes/agenda/page.tsx` e o componente `src/components/settings/calendar-sync-form.tsx`, no padrão de `configuracoes/assistente-reunioes`, com o item no menu de Configurações onde ficam os outros
- Modify:
  - `src/components/activities/activity-form.tsx`, com o aviso de convite;
  - `src/components/activities/activity-popover.tsx` e `src/components/activities/activity-list.tsx`, com "Entrar no Meet" e o erro da Agenda;
  - `src/components/email/mailbox-states.tsx`, que passa a citar a Agenda;
  - as consultas que alimentam esses componentes, que passam a trazer `meet_url`, `calendar_state` e `calendar_error`.

- [ ] **Step 1: Implementar**

**Página de configuração:**
- Título "Agenda do Google".
- Interruptor "Sincronizar com a Agenda do Google" por empresa, só para o admin geral.
- Texto: "Ligue só no dia da virada, depois que cada vendedor desligar a sincronização de agenda no Pipedrive. Na primeira rodada o CRM adota os eventos que já existem e não reenvia convites."

**Formulário:** com tipo de reunião e pessoa com e-mail, o aviso "O cliente recebe o convite com link do Meet." Aparece só se a empresa tem a Agenda ligada, informação que vem por prop da página.

**Atividade:**
- Com `meet_url`, um link "Entrar no Meet" (`target="_blank" rel="noopener noreferrer"`).
- Com `calendar_state = 'error'`, o texto "Agenda: não foi possível atualizar" e o botão "Tentar de novo" (`retryCalendarSync`).

**Aviso de reconexão:** "Esta caixa foi conectada sem algum dos acessos do CRM (reuniões do Meet, Agenda e anotações do Gemini). Reconecte-a e autorize os novos acessos."

- [ ] **Step 2: Tipos, lint, testes**

Run: `pnpm typecheck && pnpm lint && pnpm vitest run`. Expected: PASS.

- [ ] **Step 3: Commit**

`git commit -m "feat(agenda): configuração, convite, link do Meet e erro da Agenda na tela"`

---

### Task 8: Âncora do assistente de reuniões e privacidade

**Files:**
- Modify: `src/lib/meet/match-loader.ts`, `src/lib/meet/match.ts` e `src/lib/meet/run.ts`, além dos testes
- Modify: `src/app/(legal)/privacidade/page.tsx` e `src/components/legal/legal-doc.tsx` (`LEGAL_UPDATED`)

- [ ] **Step 1: Teste que falha**

Em `src/lib/meet/run.test.ts`: quando o evento da agenda achado pelo código da reunião tem `id` igual ao `calendar_event_id` de uma atividade aberta da empresa, a reunião é vinculada ao registro dessa atividade, com `anchor_activity_id` = essa atividade, antes de usar o casador por horário.

- [ ] **Step 2: Implementar**

`readMeetingInfo` guarda o `id` do evento, que já existe como `calendar_event_id` em `meetings`; conferir. No `advance`, antes de `loadCandidates`, procura a atividade por `calendar_event_id`.

- [ ] **Step 3: Privacidade**

Na seção 4:
- o acesso à Agenda passa a ser de leitura e escrita;
- o CRM cria, altera e apaga eventos das atividades e convida o contato das reuniões;
- os eventos criados direto na Agenda viram atividades, e os particulares entram como "Ocupado".

Atualizar `LEGAL_UPDATED` para a data do dia.

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm vitest run && pnpm typecheck && pnpm lint`. Expected: PASS.

- [ ] **Step 5: Commit**

`git commit -m "feat(agenda): reunião do Meet ancorada pelo evento e política de privacidade"`
