# Assistente de reuniões (Google Meet) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** As reuniões do Google Meet com convidados de fora viram uma anotação estruturada no Pipedrive e sugestões de funil para o vendedor confirmar no CRM.

**Architecture:** Um cron na Vercel (`/api/cron/meet`, a cada 10 minutos) usa a mesma conexão Google do Gmail para ler as reuniões encerradas, a transcrição e os convidados. Um casador puro escolhe o registro do CRM. O Claude (SDK oficial, saída estruturada) gera as notas. Um `MeetingSink` grava no Pipedrive. Reuniões, transcrições, notas e sugestões ficam em tabelas próprias, que o modo espelho não toca.

**Tech Stack:** Next.js 16 (ler `node_modules/next/dist/docs/` antes de rotas e server actions), Supabase (Postgres + RLS), TypeScript, zod 4, `@anthropic-ai/sdk` (novo), vitest.

**Spec:** `docs/superpowers/specs/2026-11-05-assistente-reunioes-design.md`

## Global Constraints

- Todo texto de interface, mensagem de erro e comentário em português do Brasil.
- Comandos: `export PATH=$HOME/.local/node/bin:$PATH` e depois `pnpm vitest run <arquivo>`, `pnpm tsc --noEmit`, `pnpm lint`.
- Sem dependência `googleapis`. Os clientes Google são REST com `fetch`, no estilo de `src/lib/gmail/client.ts`.
- Claude só pelo `@anthropic-ai/sdk`: `client.beta.messages.parse` com `zodOutputFormat` (`@anthropic-ai/sdk/helpers/zod`), modelo `claude-opus-5-5`, `output_config.effort: "medium"`, `betas: ["server-side-fallback-2026-07-01"]` e `fallbacks: "default"`. Sem `thinking`, `temperature`, `top_p` ou `budget_tokens`. Se o SDK instalado não tipar `fallbacks` no `beta.messages.parse`, usar `client.messages.parse` sem fallback e registrar no relatório.
- Escopos Google novos, exatos: `https://www.googleapis.com/auth/meetings.space.readonly` e `https://www.googleapis.com/auth/calendar.events.readonly`.
- Env: `ANTHROPIC_API_KEY` (nova), `PIPEDRIVE_API_TOKEN` (existe), `CRON_SECRET` (existe), `GMAIL_TOKEN_KEY` (existe).
- Toda rota de cron entra em `SELF_AUTH` (`src/lib/supabase/middleware.ts`).
- Valores fixos da spec:
  - transcrição guardada até 1 MB de texto;
  - prazo de 2 h depois do fim para a transcrição aparecer;
  - 3 tentativas para o Claude e para o Pipedrive;
  - Sem vínculo descartada sozinha em 7 dias;
  - âncora de reunião agendada em ±1 dia;
  - destaque de pendente com mais de 24 h;
  - roteiro padrão: `["Dor principal", "Orçamento", "Decisor", "Prazo", "Concorrentes", "Próximo passo"]`.
- O assistente **nunca cria** pessoa, organização, lead ou negócio.
- Migrations não são aplicadas no banco pelos implementadores. A Task 13 aplica, com permissão.
- Nunca imprimir tokens ou chaves. Nunca commitar `.env.local`.

## Review Focus

1. **E-mail de convidado com maiúsculas ou espaços:** precisa casar com `persons.emails` mesmo assim. O teste fica na Task 4.
2. **Vendedor sem usuário mapeado no Pipedrive:** a nota ainda é gravada, sem `user_id`, e o rodapé leva o nome do vendedor. O teste fica na Task 7.
3. **Data da próxima atividade:** a sugestão vem em horário de São Paulo, e o Pipedrive recebe `due_date` e `due_time` em UTC. O teste fica na Task 7.
4. **Mesma reunião vista por duas contas na mesma rodada:** processada uma vez só (`conference_record` único). O teste fica na Task 8.
5. **Registro vinculado que foi para a lixeira antes da gravação:** a reunião aparece como Sem vínculo, sem chamar o Pipedrive. O teste fica na Task 8.

---

### Task 1: Banco: tabelas, RLS e colunas novas

**Files:**
- Create: `supabase/migrations/20261106000001_meetings.sql`

**Interfaces:**
- Produces:
  - **Tabelas** (colunas exatas da spec, seção "Modelo de dados"):
    - `meetings`: com `status` check em (`waiting_transcript`, `processing`, `unlinked`, `done`, `failed`, `ignored`), `conference_record` único, e `entity` check em (`deals`, `leads`, `persons`, `organizations`) ou nulo;
    - `meeting_transcripts`;
    - `meeting_notes`: com `pipedrive_note_id bigint`;
    - `meeting_suggestions`: com `kind` check em (`meeting_outcome`, `next_activity`, `stage`) e `status` check em (`pending`, `confirmed`, `dismissed`, `failed`).
  - **Colunas novas:**
    - `email_accounts.scopes text[] not null default '{}'`;
    - `email_accounts.meeting_cursor timestamptz`;
    - `email_accounts.meeting_lock_until timestamptz` (lease própria do assistente).
  - **Notificações:**
    - `notifications.meeting_id uuid references meetings on delete cascade`;
    - o check de `notifications.kind` passa a aceitar `('activity_reminder', 'meeting_unlinked')`.
  - **`public.can_read_meeting(p_meeting uuid) returns boolean`** (security definer, stable): verdadeiro quando o registro vinculado está vivo (`deleted_at is null`) e `can_read_record(entity, record_id)`; senão, quando `owner_id = auth.uid()` ou `is_super_admin()`.
  - **`public.can_edit_meeting(p_meeting uuid) returns boolean`**: o mesmo critério, com `can_edit_record`.
  - **RLS:**
    - select em `meetings`, `meeting_notes`, `meeting_suggestions` e `meeting_transcripts` via `can_read_meeting`;
    - nenhuma policy de escrita (a escrita é pelo service role);
    - `revoke` de execute de anon nas funções.

- [ ] **Step 1:** Escrever a migration acima. Para o check de `notifications.kind`, use `alter table ... drop constraint <nome atual>`, lendo o nome em `20261024000001_activities_schema.sql` ou com `select conname from pg_constraint`, e adicione o novo check.
- [ ] **Step 2:** Validar a sintaxe sem aplicar. Rode `pnpm exec supabase db push --dry-run --db-url "$SUPABASE_DB_URL"` (lido de `.env.local`). Esperado: a lista mostra só `20261106000001_meetings.sql`.
- [ ] **Step 3: Commit.** `git add supabase/migrations/20261106000001_meetings.sql && git commit -m "feat(reunioes): tabelas, RLS e colunas do assistente"`

### Task 2: Escopos Google novos e escopos gravados na conta

**Files:**
- Modify: `src/lib/gmail/oauth.ts` (`GMAIL_SCOPES`)
- Modify: `src/lib/gmail/connect.ts` (novo `MEET_SCOPES`, `hasMeetScopes`)
- Modify: `src/lib/gmail/connect-server.ts` (`saveMailbox` grava `scopes`)
- Modify: `src/app/api/google/callback/route.ts` (passa `tokens.scopes` a `saveMailbox`)
- Modify: `src/components/email/mailbox-states.tsx` (aviso de reconexão)
- Test: `src/lib/gmail/connect.test.ts`, `src/lib/gmail/oauth.test.ts`

**Interfaces:**
- Produces:
  - `export const MEET_SCOPES: readonly string[]`, com os dois escopos dos Global Constraints;
  - `export function hasMeetScopes(granted: string[]): boolean`;
  - `GMAIL_SCOPES` passa a incluir `MEET_SCOPES`. `hasRequiredScopes` não muda: sem Meet, a caixa conecta, mas o assistente fica desligado para ela.

- [ ] **Step 1:** Testes:
  - `hasMeetScopes([...REQUIRED_GMAIL_SCOPES, ...MEET_SCOPES]) === true`;
  - `hasMeetScopes(REQUIRED_GMAIL_SCOPES) === false`;
  - `buildAuthUrl(...)` contém `meetings.space.readonly` e `calendar.events.readonly` no `scope`;
  - o teste existente de oauth é atualizado para a nova string de escopos.
- [ ] **Step 2:** Rodar os testes e conferir que falham.
- [ ] **Step 3:** Implementar. `saveMailbox(..., scopes: string[])` grava `email_accounts.scopes`. Em `mailbox-states.tsx`, quando a caixa ativa não tem `hasMeetScopes(scopes)`, mostrar "Reconecte o Google para ativar o assistente de reuniões." com o botão de reconectar que já existe.
- [ ] **Step 4:** `pnpm vitest run src/lib/gmail` e `pnpm tsc --noEmit` passam.
- [ ] **Step 5: Commit.**

### Task 3: Cliente REST do Meet e da Agenda

**Files:**
- Create: `src/lib/meet/google.ts`
- Test: `src/lib/meet/google.test.ts`

**Interfaces:**
- Consumes: `TokenRequest`, `GmailAuthError`, `GmailRateLimitError`, `GmailNetworkError`, `GmailApiError` de `src/lib/gmail/client.ts`, e `clientForAccount`/`loadAccountToken` de `src/lib/gmail/accounts.ts`. Reaproveite o padrão de `request` com a renovação após 401. Se precisar, extraia `http`, `readJson` e `buildUrl` para um módulo compartilhado `src/lib/google/http.ts` e ajuste o import no Gmail.
- Produces:
  - **Tipos:**
    - `ConferenceRecord = { name: string; space: string; startTime: string; endTime: string | null }`;
    - `Transcript = { name: string; state: "STARTED" | "ENDED" | "FILE_GENERATED" | string }`;
    - `TranscriptEntry = { participant: string; text: string; startTime: string }`;
    - `Participant = { name: string; signedinUser?: { user: string; displayName: string }; anonymousUser?: { displayName: string } }`;
    - `CalendarEvent = { id: string; summary?: string; organizer?: { email: string }; attendees?: { email: string; displayName?: string; self?: boolean; resource?: boolean }[]; conferenceData?: { conferenceId?: string } }`.
  - **`class MeetClient`**, construída com `getAccessToken: (o?: TokenRequest) => Promise<string>`:
    - `listConferenceRecords(endAfter: Date): Promise<ConferenceRecord[]>`: GET `https://meet.googleapis.com/v2/conferenceRecords`, `filter=end_time>="<iso>"`, paginando;
    - `getMeetingCode(space: string): Promise<string | null>`: GET `/v2/{space}`, campo `meetingCode`;
    - `listTranscripts(record: string): Promise<Transcript[]>`;
    - `listTranscriptEntries(transcript: string): Promise<TranscriptEntry[]>`, paginando com `pageSize=100`;
    - `listParticipants(record: string): Promise<Participant[]>`;
    - `findEventByMeetingCode(code: string, around: Date): Promise<CalendarEvent | null>`: GET `https://www.googleapis.com/calendar/v3/calendars/primary/events` com `timeMin = around - 12h`, `timeMax = around + 12h` e `singleEvents=true`; devolve o primeiro com `conferenceData.conferenceId === code`.
  - `export function meetClientForAccount(accountId: string): MeetClient`.

- [ ] **Step 1:** Testes com `fetch` simulado (`vi.stubGlobal`):
  - paginação de `listConferenceRecords` (duas páginas, com `nextPageToken`) e o filtro na URL;
  - 401 seguido de sucesso renova o token uma vez;
  - `findEventByMeetingCode` ignora eventos com outro `conferenceId` e devolve `null` sem match;
  - 429 lança `GmailRateLimitError`.
- [ ] **Step 2:** Os testes falham.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** Os testes passam e `pnpm tsc --noEmit` também.
- [ ] **Step 5: Commit.**

### Task 4: Casador de vínculo (puro) e carregador de candidatos

**Files:**
- Create: `src/lib/meet/match.ts` (puro), `src/lib/meet/match-loader.ts` (banco)
- Test: `src/lib/meet/match.test.ts`

**Interfaces:**
- Produces, em `match.ts`:
  - `normalizeEmail(e: string): string` (trim e minúsculas);
  - `splitAttendees(emails: string[], internalDomains: Set<string>): { external: string[]; internal: string[] }`;
  - `type Candidate = { person: { id: string; organizationId: string | null }; deals: { id: string; personId: string | null; organizationId: string | null; lastActivityAt: string | null }[]; leads: { id: string; personId: string | null; organizationId: string | null }[]; meetingActivities: { id: string; dealId: string | null; leadId: string | null; personId: string | null; dueAt: string; pipedriveId: string | null }[] }`;
  - `pickRecord(c: Candidate[], meetingAt: Date): { entity: "deals" | "leads" | "persons"; recordId: string; anchorActivityId: string | null } | null`, com as regras da spec, seção "Vincular", nesta ordem:
    1. negócio aberto;
    2. desempate pela reunião agendada mais perto, até ±1 dia;
    3. depois por `lastActivityAt`;
    4. lead aberto;
    5. pessoa.

    Mais de uma pessoa com registros diferentes e sem desempate dá `null`.
- Produces, em `match-loader.ts`:
  - `loadInternalDomains(db): Promise<Set<string>>`, com os domínios de `profiles.email`;
  - `loadCandidates(db, companyId: string, emails: string[]): Promise<Candidate[]>`. Pessoas da empresa com `deleted_at is null` e `emails` contendo algum e-mail, comparando minúsculas; negócios `status='open'` e leads abertos da pessoa ou da organização; atividades de reunião não concluídas desses registros, com o id do Pipedrive via `external_ids`.

- [ ] **Step 1:** Testes de `match.ts`:
  - `splitAttendees(["Ana@Cliente.com ", "caio@oxyngroup.com.br"], new Set(["oxyngroup.com.br"]))` dá `{external: ["ana@cliente.com"], internal: ["caio@oxyngroup.com.br"]}`;
  - um negócio aberto dá `deals`;
  - dois negócios, um com reunião a 2 h do horário, dá esse negócio, com `anchorActivityId` preenchido;
  - dois negócios sem reunião desempatam pela atividade mais recente;
  - sem negócio e com lead dá `leads`;
  - só a pessoa dá `persons`;
  - duas pessoas de organizações diferentes, cada uma com seu negócio e sem desempate, dá `null`;
  - lista vazia dá `null`.
- [ ] **Step 2:** Os testes falham.
- [ ] **Step 3:** Implementar os dois arquivos.
- [ ] **Step 4:** Os testes passam e `tsc` também.
- [ ] **Step 5: Commit.**

### Task 5: Notas com o Claude

**Files:**
- Modify: `package.json` (adicionar `@anthropic-ai/sdk` com `pnpm add @anthropic-ai/sdk`)
- Create: `src/lib/meet/notes.ts`
- Test: `src/lib/meet/notes.test.ts`

**Interfaces:**
- Produces:
  - **`MeetingNotesSchema`** (zod) com:
    - `summary: string`;
    - `pains: string[]`;
    - `objections: string[]`;
    - `qualification: {question: string; answer: string}[]`;
    - `next_steps: {what: string; owner: string; due: string | null}[]` (com `due` em `YYYY-MM-DD`);
    - `suggestions: { meeting_outcome: string | null; next_activity: {type: string; subject: string; due_date: string; due_time: string | null} | null; stage: string | null }`.
  - `type MeetingNotes = z.infer<typeof MeetingNotesSchema>`.
  - **`type NotesInput`**:
    - `transcript: string`;
    - `questions: string[]`;
    - `title: string`;
    - `startedAt: string`;
    - `participants: string[]`;
    - `record: { kind: string; name: string; stage?: string; value?: number; setup?: number; mrr?: number; recentNotes: string[] }`;
    - `outcomes: string[]` (nomes de resultados de reunião da empresa);
    - `activityTypes: string[]`;
    - `stages: string[]`.
  - `buildNotesRequest(input: NotesInput): { system: string; user: string }`.
  - `generateNotes(input: NotesInput, client?: Anthropic): Promise<MeetingNotes>`. Com os parâmetros dos Global Constraints, `max_tokens: 16000` e sem streaming. Lança `NotesError` quando `parsed_output` é nulo, `stop_reason` é `refusal` ou a resposta é inválida.

  O system prompt pede, em português:
  - responder **uma** entrada de `qualification` por pergunta, na mesma ordem, com "Não mencionado" quando não houver;
  - escolher `meeting_outcome` só entre `outcomes`, `next_activity.type` só entre `activityTypes` e `stage` só entre `stages`, ou nulo;
  - sugerir `stage` só quando a conversa deixa claro o avanço;
  - datas em horário de São Paulo.

- [ ] **Step 1:** Testes, com o cliente injetado (um objeto falso com `beta.messages.parse` que grava os argumentos):
  - `buildNotesRequest` inclui cada pergunta do roteiro e cada resultado permitido;
  - `generateNotes` chama `model: "claude-opus-5-5"`;
  - um `parsed_output` válido volta tal qual;
  - uma `qualification` com tamanho diferente do roteiro lança `NotesError`;
  - um `meeting_outcome` fora de `outcomes` vira `null`, por pós-validação;
  - `stop_reason: "refusal"` lança `NotesError`.
- [ ] **Step 2:** Os testes falham.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** Os testes passam e `tsc` também.
- [ ] **Step 5: Commit** (com `package.json` e `pnpm-lock.yaml`).

### Task 6: HTML da anotação

**Files:**
- Create: `src/lib/meet/note-html.ts`
- Test: `src/lib/meet/note-html.test.ts`

**Interfaces:**
- Produces: `renderNoteHtml(n: MeetingNotes, meta: { startedAt: string; ownerName: string; mappedUser: boolean }): string`.
  - **Seções:** `<b>Resumo</b>`, Dores, Objeções, Qualificação e Próximos passos. Listas viram `<ul><li>`, e listas vazias somem.
  - **Escape:** todo texto passa por escape HTML.
  - **Rodapé:** `<i>Gerada pelo assistente a partir da reunião de dd/mm hh:mm</i>`, no horário de São Paulo. Quando `mappedUser` é falso, acrescenta ` (vendedor: <ownerName>)`.

- [ ] **Step 1:** Testes:
  - escape de `<script>` no resumo;
  - seção vazia omitida;
  - rodapé com `05/11 14:30` para `2026-11-05T17:30:00Z`;
  - nome do vendedor no rodapé quando `mappedUser=false`.
- [ ] **Step 2:** Os testes falham.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** Os testes passam.
- [ ] **Step 5: Commit.**

### Task 7: Gravação no Pipedrive (`MeetingSink`)

**Files:**
- Create: `src/lib/meet/sink.ts`
- Test: `src/lib/meet/sink.test.ts`

**Interfaces:**
- Produces:
  - `type SinkTarget = { entity: "deals" | "leads" | "persons"; pipedriveId: string; personPipedriveId: string | null; orgPipedriveId: string | null }` (para lead, `pipedriveId` é o uuid do lead no Pipedrive).
  - **`interface MeetingSink`**:
    - `writeNote(t: SinkTarget, html: string, userId: number | null): Promise<{ noteId: number }>`;
    - `completeMeeting(t: SinkTarget, args: { anchorPipedriveId: string | null; outcomeId: number | null; subject: string; startedAt: string; userId: number | null }): Promise<void>`. Com âncora: `PUT /v1/activities/{id}` com `done: 1` e `outcome`. Sem âncora: `POST /v1/activities` com o tipo de reunião e `done: 1`.
    - `createActivity(t: SinkTarget, args: { typeKey: string; subject: string; dueDate: string; dueTime: string | null; userId: number | null }): Promise<void>`. `dueDate`/`dueTime` chegam em São Paulo e são convertidos para UTC.
    - `moveStage(dealPipedriveId: string, stagePipedriveId: number): Promise<void>`.
  - `pipedriveSink(opts: { token: string; fetchImpl?: typeof fetch }): MeetingSink`. Base `https://api.pipedrive.com`, header `x-api-token`. Erro não-2xx lança `SinkError(status, message)`.
  - `crmSink` (gravar direto no CRM) fica para o desligamento do Pipedrive: só a interface é criada agora, e `MEET_SINK` ainda não é lida.
  - `pipedriveUserFor(db, profileId: string): Promise<number | null>`: inverte `mappings.users` da última `import_jobs` concluída.

- [ ] **Step 1:** Testes com `fetch` simulado:
  - `writeNote` para deal manda `deal_id` e `user_id`; para lead, `lead_id`; com `userId` nulo, não manda `user_id`;
  - `completeMeeting` com âncora faz PUT com `done: 1` e `outcome`; sem âncora, faz POST com `done: 1`;
  - `createActivity("2026-11-12", "09:00")` manda `due_date: "2026-11-12"` e `due_time: "12:00"` (UTC); com `dueTime` nulo, manda só a data;
  - um 500 lança `SinkError`.
- [ ] **Step 2:** Os testes falham.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** Os testes passam.
- [ ] **Step 5: Commit.**

### Task 8: Rodada do assistente e cron

**Files:**
- Create: `src/lib/meet/run.ts`, `src/app/api/cron/meet/route.ts`
- Modify: `vercel.json` (cron `/api/cron/meet`, `*/10 * * * *`), `src/lib/supabase/middleware.ts` (`SELF_AUTH` ganha `/api/cron/meet`)
- Test: `src/lib/meet/run.test.ts`

**Interfaces:**
- Consumes:
  - `MeetClient` (Task 3);
  - `splitAttendees`, `pickRecord` e o carregador (Task 4);
  - `generateNotes` (Task 5);
  - `renderNoteHtml` (Task 6);
  - `MeetingSink` e `pipedriveUserFor` (Task 7).
- Produces:
  - `type MeetDeps = { db: SupabaseClient; meetFor(accountId: string): MeetClient; notes: typeof generateNotes; sink: MeetingSink; now(): Date }`;
  - `runMeetSync(deps: MeetDeps, opts: { budgetMs: number }): Promise<{ accountId: string; created: number; processed: number; failed: number }[]>`;
  - `processMeeting(deps: MeetDeps, meetingId: string): Promise<void>`, que é exportada (as ações da Task 9 também a chamam).

**Regras** (as da spec, seção "Capturar"):
1. **Contas:** ativas, com `hasMeetScopes(scopes)`, na empresa com `settings.meeting_assistant.enabled = true`, e com o lease `meeting_lock_until`.
2. **Reuniões novas:** `listConferenceRecords(meeting_cursor ?? now - 1 dia)`. Insere com `on conflict (conference_record) do nothing`. Dono: o organizador do evento quando ele é usuário do CRM; senão, o dono da conta. Sem externos, vira `ignored`. O cursor avança para o maior `endTime` lido.
3. **Em `waiting_transcript`:**
   - se `FILE_GENERATED`, grava as entradas (texto até 1 MB) e chama `processMeeting`;
   - se passaram mais de 2 h do fim sem transcrição, vira `failed` com "reunião sem transcrição".
4. **`processMeeting`:**
   - vínculo com `pickRecord`; se der `null`, vira `unlinked` e cria a notificação `meeting_unlinked` para o dono;
   - notas com `generateNotes`, guardando `meeting_notes`, sem `pipedrive_note_id` ainda;
   - registro vinculado vivo: `writeNote`, grava `pipedrive_note_id`, cria as `meeting_suggestions` em `pending` (só as não nulas) e o status vira `done`;
   - registro vinculado na lixeira: vira `unlinked`, sem chamar o sink;
   - erro: `attempts++` e `last_error`; com `attempts >= 3`, vira `failed`.
5. **Retentativa:** reuniões em `processing` com `meeting_notes` sem `pipedrive_note_id` são tentadas de novo pela própria rodada.
6. **Descarte:** reuniões `unlinked` com mais de 7 dias viram `ignored`, e a transcrição e as notas são apagadas.
7. **Rota:** `route.ts` segue `src/app/api/cron/gmail/route.ts` (`isCronAuthorized`, `maxDuration = 300`, orçamento de 240 s). Sem `ANTHROPIC_API_KEY` ou `PIPEDRIVE_API_TOKEN`, responde `{ skipped: "not_configured" }`.

- [ ] **Step 1:** Testes com dependências falsas, num banco em memória simulado com o mesmo padrão de `src/lib/gmail/run.test.ts`:
  - a mesma `conference_record` em duas contas cria uma reunião só;
  - reunião só com internos vira `ignored`, e o Claude não é chamado;
  - transcrição `STARTED` continua em `waiting_transcript`; a 2 h e 1 min do fim, vira `failed`;
  - com match: `writeNote` é chamado uma vez, as sugestões ficam `pending`, e o status vira `done`;
  - sem match: vira `unlinked`, uma notificação é criada, e `writeNote` não é chamado;
  - registro vinculado com `deleted_at`: vira `unlinked` sem chamar o sink;
  - o sink falha 3 vezes e a reunião vira `failed`;
  - `unlinked` de 8 dias vira `ignored`, e a transcrição é apagada.
- [ ] **Step 2:** Os testes falham.
- [ ] **Step 3:** Implementar `run.ts`, a rota, `vercel.json` e `SELF_AUTH`.
- [ ] **Step 4:** Os testes passam, e `tsc` e `lint` também.
- [ ] **Step 5: Commit.**

### Task 9: Ações do vendedor

**Files:**
- Create: `src/lib/meet/actions.ts` (`"use server"`)
- Test: `src/lib/meet/actions.test.ts` (regras puras extraídas para `src/lib/meet/decisions.ts`)

**Interfaces:**
- Produces, todas devolvendo `ActionResult` (o tipo usado em `src/lib/users/actions.ts`) e conferindo `can_edit_meeting` via RPC antes de agir:
  - `confirmSuggestion(id: string, edited?: unknown)`. Valida `edited` pelo `kind`. `meeting_outcome` mapeia o nome para o id do resultado no Pipedrive (`activityOutcomeNames` invertido, da última importação) e chama `completeMeeting`. `next_activity` chama `createActivity`. `stage` mapeia o nome da etapa para o id no Pipedrive (`external_ids` de etapas, ou os `mappings`) e chama `moveStage`. Sucesso: `confirmed`, com `decided_by` e `decided_at`. Erro: `failed`, com `last_error`.
  - `dismissSuggestion(id: string)`.
  - `linkMeeting(meetingId: string, entity: "deals" | "leads" | "persons", recordId: string)`. Só para reuniões `unlinked` do usuário (ou admin geral). Grava o vínculo e chama `processMeeting`, que reaproveita as notas já geradas.
  - `discardMeeting(meetingId: string)`: vira `ignored` e apaga a transcrição e as notas.
  - `retryMeeting(meetingId: string)`: zera `attempts` e chama `processMeeting`.
  - Todas chamam `revalidatePath` da página do registro e de `/[empresa]/reunioes`.

- [ ] **Step 1:** Testes das regras puras em `decisions.ts`:
  - `validateEdited("next_activity", {...})` aceita data `YYYY-MM-DD` e recusa `12/11/2026`;
  - `outcomeIdFor("Concluída qualificada", map)` devolve o id, e um nome desconhecido devolve `null`;
  - `canLink(meeting, userId, isSuperAdmin)` só é verdadeiro para `unlinked` do dono ou do admin.
- [ ] **Step 2:** Os testes falham.
- [ ] **Step 3:** Implementar `decisions.ts` e `actions.ts`.
- [ ] **Step 4:** Os testes passam e `tsc` também.
- [ ] **Step 5: Commit.**

### Task 10: Reunião no histórico do card

**Files:**
- Create: `src/lib/meet/queries.ts`, `src/components/meetings/meeting-block.tsx`
- Modify: `src/components/records/record-history.tsx`, `src/components/records/timeline.tsx` (novo item e filtro), `src/lib/timeline/queries.ts` (esconder nota duplicada)
- Test: `src/lib/meet/queries.test.ts` (função pura de deduplicação)

**Interfaces:**
- Produces:
  - `getRecordMeetings(entity, recordId): Promise<RecordMeeting[]>`, com `RecordMeeting = { id; title; startedAt; status; notes: MeetingNotes | null; suggestions: { id; kind; payload; status }[]; hasTranscript: boolean }`;
  - `getMeetingTranscript(meetingId): Promise<string | null>` (server action, lida sob demanda);
  - `hideMeetingNotes(items: TimelineItem[], meetingNotePipedriveIds: Set<string>): TimelineItem[]`: remove as anotações importadas cujo id do Pipedrive está no conjunto. `TimelineItem` de anotação precisa expor `externalId?: string`; isso é preenchido em `queries.ts` via `external_ids` (`entity='notes'`).
- **UI:**
  - `MeetingBlock`, com ícone `Video`;
  - mostra título, data, resumo, qualificação em lista de pergunta e resposta, e próximos passos;
  - sugestões com os botões Confirmar, Editar (inline, com campos por `kind`) e Descartar;
  - "Ver transcrição" (expande e busca sob demanda);
  - entra no filtro "Atividades" da timeline, ordenado por `startedAt`.

- [ ] **Step 1:** Teste de `hideMeetingNotes`: remove só as notas com id no conjunto e mantém as outras e os eventos.
- [ ] **Step 2:** O teste falha.
- [ ] **Step 3:** Implementar as consultas, o bloco e a integração com `RecordHistory`, que busca as reuniões em paralelo às threads.
- [ ] **Step 4:** O teste passa, e `tsc` e `lint` também. Conferir no navegador (`preview_start "oxyncrm-dev"`, :3001) com uma reunião inserida à mão por SQL de teste e apagada depois.
- [ ] **Step 5: Commit.**

### Task 11: Página Reuniões, menu e sino

**Files:**
- Create: `src/app/(app)/[empresa]/reunioes/page.tsx`, `src/components/meetings/meetings-tabs.tsx`, `src/components/meetings/link-meeting-dialog.tsx`
- Modify:
  - `src/lib/nav.ts` (item `reunioes`, ícone `Video`, `availableFromPhase: 5`, `scoped: true`, logo depois de "Atividades");
  - `src/components/shell/sidebar.tsx` (contador);
  - `src/components/shell/notifications-bell.tsx` (`meeting_unlinked` com link para `/<slug>/reunioes?aba=sem-vinculo`);
  - `src/lib/meet/queries.ts` (`listMeetings`, `countMyPending`).
- Test: `src/lib/meet/queries.test.ts` (função pura `meetingTab`)

**Interfaces:**
- Produces:
  - `meetingTab(m: { status; suggestionsPending: number; recordTrashed: boolean }): "pendentes" | "sem-vinculo" | "com-erro" | null`. `unlinked`, ou `done` com o registro na lixeira, vai para `sem-vinculo`. `done` com sugestões pendentes vai para `pendentes`. `failed` vai para `com-erro`.
  - `listMeetings(scope, tab, page)`;
  - `countMyPending(userId): Promise<number>`, que soma as sem vínculo e as pendentes do usuário.
- **UI:**
  - abas Pendentes, Sem vínculo, Com erro e Todas;
  - linhas com título, data, dono, registro e um destaque "há mais de 24 h" nas pendentes;
  - em Sem vínculo, os botões Vincular (diálogo com busca de negócio, lead ou pessoa da empresa, reaproveitando a busca da paleta de comandos) e Descartar;
  - em Com erro, "Tentar de novo".

- [ ] **Step 1:** Testes de `meetingTab`, com os quatro casos acima e `ignored`, que devolve `null`.
- [ ] **Step 2:** Os testes falham.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** Os testes passam, e `tsc` e `lint` também. Conferir no navegador.
- [ ] **Step 5: Commit.**

### Task 12: Configurações do assistente e Privacidade

**Files:**
- Create: `src/app/(app)/configuracoes/assistente-reunioes/page.tsx`, `src/components/settings/meeting-assistant-form.tsx`, `src/lib/meet/settings.ts`
- Modify: `src/components/settings/settings-nav.tsx` (item "Assistente de reuniões"), `src/app/(legal)/privacidade/page.tsx`
- Test: `src/lib/meet/settings.test.ts`

**Interfaces:**
- Produces:
  - `DEFAULT_QUESTIONS` (os 6 dos Global Constraints);
  - `readMeetingSettings(settings: unknown): { enabled: boolean; questions: string[] }`, com padrão `{enabled: false, questions: DEFAULT_QUESTIONS}`;
  - `saveMeetingSettings(companyId, input)` (server action, só admin geral). Valida de 1 a 15 perguntas com até 200 caracteres cada, sem perguntas vazias, e grava `companies.settings.meeting_assistant` preservando o resto do JSON. Siga o padrão de `email_sent_as_activity` em `src/lib/gmail/template-actions.ts`.
- **Privacidade:** seções novas com os dois escopos, a Anthropic como fornecedora (sem treinamento com os dados, conforme os termos comerciais da API), a guarda da transcrição no CRM e o descarte em 7 dias das reuniões sem vínculo. `LEGAL_UPDATED` passa para "6 de novembro de 2026".

- [ ] **Step 1:** Testes:
  - `readMeetingSettings(null)` devolve o padrão;
  - `readMeetingSettings({meeting_assistant: {enabled: true, questions: ["X"]}})` devolve o mesmo;
  - a validação recusa 0 perguntas, 16 perguntas e uma pergunta vazia.
- [ ] **Step 2:** Os testes falham.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** Os testes passam, e `tsc` e `lint` também. Conferir as telas no navegador.
- [ ] **Step 5: Commit.**

### Task 13: Aplicar no banco, variáveis e teste real (controlador, com o usuário)

- [ ] **Step 1:** Com a permissão do usuário, rodar `pnpm db:migrate`. Esperado: aplica `20261106000001_meetings.sql`.
- [ ] **Step 2:** Rodar todos os testes, `tsc` e `lint`.
- [ ] **Step 3:** Abrir o PR, com o checklist da spec (seção "Configuração"), e pedir ao usuário:
  - transcrição automática no Admin Console;
  - Meet API e Calendar API ativadas, com os escopos na tela de consentimento;
  - `ANTHROPIC_API_KEY` e `PIPEDRIVE_API_TOKEN` na Vercel;
  - reconectar o Google;
  - ligar o assistente na Oxyn.
- [ ] **Step 4:** Depois do deploy, `curl -s -o /dev/null -w "%{http_code}" https://crm.oxyngroup.com.br/api/cron/meet` dá `401`.
- [ ] **Step 5:** Teste real com uma reunião do usuário, para confirmar os riscos da spec (acesso à transcrição pelo organizador e `outcome` aceito no PUT). Registrar o resultado na memória do projeto.
