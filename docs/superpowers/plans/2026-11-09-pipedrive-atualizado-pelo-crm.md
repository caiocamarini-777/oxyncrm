# Pipedrive atualizado pelo CRM — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Durante o piloto, uma rotina de hora em hora copia para o Pipedrive o que foi criado, mudado ou apagado no CRM: organizações, pessoas, leads, negócios, atividades e anotações.

**Architecture:**
- **Conversões puras:** `src/lib/pipedrive-push/mapping.ts` faz a conversão CRM → Pipedrive, ao contrário de `src/lib/import/mapping.ts`.
- **Banco:** um store em `src/lib/pipedrive-push/store.ts` cuida da leitura das mudanças, dos vínculos, da fila de retry e dos relatórios.
- **Executor:** `src/lib/pipedrive-push/run.ts` faz a rodada.
- **Script e agendamento:** o script `scripts/sync-crm-to-pipedrive.ts` é chamado por um workflow do GitHub Actions de hora em hora.
- **Liga/desliga:** a configuração fica no banco, numa linha de `pipedrive_push_settings`.

**Tech Stack:** TypeScript, tsx, Supabase (service role), Pipedrive API v1, GitHub Actions, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-09-pipedrive-atualizado-pelo-crm-design.md`

## Global Constraints

- Textos, erros e comentários em português do Brasil, no estilo do código vizinho. Comandos com `export PATH=$HOME/.local/node/bin:$PATH`. Antes de cada commit, `pnpm typecheck`, `pnpm lint` e o vitest da área.
- **Só existe banco de produção**, e o Pipedrive é o de verdade.
  - Nunca rodar migration, o script novo ou qualquer chamada de escrita ao Pipedrive.
  - Quem aplica e liga é o controlador, com ok do usuário.
  - O banco de testes (`.env.ci`) pode ser usado para testes de banco.
- Nunca imprimir tokens. Commits em português com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Valores da spec:**
  - a cada hora (`0 * * * *`);
  - exclusões também são apagadas no Pipedrive;
  - até 5 tentativas por registro na fila de retry;
  - até 500 erros por rodada no relatório;
  - trava do espelho: último job concluído espelho e terminado há menos de 48 h;
  - ordem de envio: organizações → pessoas → leads → negócios → atividades → anotações; exclusões na ordem inversa.

## Review Focus

1. **Registro criado no CRM e mudado de novo antes da rodada seguinte.** Cria uma vez só no Pipedrive e, nas rodadas seguintes, atualiza o mesmo id. Testado na Task 5.
2. **Pessoa que falha e negócio dela na mesma rodada.** O negócio vai para o retry, não é criado sem pessoa e entra na rodada seguinte, depois da pessoa. Testado na Task 5.
3. **Registro na lixeira e restaurado antes da rodada.** Não apaga no Pipedrive; só atualiza. Restaurado depois de apagado lá: é criado de novo e religado. Testado na Task 5.
4. **Dono sem usuário no Pipedrive, ou etapa sem correspondente.** O dono vira o usuário do token. A etapa sem correspondente vira erro do registro, sem parar a rodada. Testado nas Tasks 3 e 5.
5. **Rotina ligada com o espelho ainda ativo.** Nada roda e nada é enviado. Testado na Task 5.

---

### Task 1: Migration

**Files:** Create `supabase/migrations/20261113000001_pipedrive_push.sql`

**Interfaces:**
- **Tabelas:**
  - `pipedrive_push_settings`: `id int primary key check (id = 1)`, `enabled boolean not null default false`, `enabled_at timestamptz`, `cursor timestamptz`. Já nasce com a linha 1.
  - `pipedrive_push_runs`: `id uuid`, `started_at`, `finished_at`, `cursor_from`, `cursor_to`, `status` (`running`/`done`/`failed`), `counters jsonb`, `errors jsonb`.
  - `pipedrive_push_retry`: `entity text`, `record_id uuid`, `company_id uuid`, `attempts int`, `last_error text`, `updated_at timestamptz`, com pk `(entity, record_id)`.
- **Funções** `security definer`, só para o service role:
  - `pipedrive_push_link(p_entity text, p_external_id text, p_company uuid, p_record uuid) returns void`: upsert em `external_ids` com `source 'pipedrive'`, `job_id null`, `imported_at now()` e `record_updated_at` do registro;
  - `pipedrive_push_unlink(p_entity text, p_record uuid) returns void`: apaga as linhas de `external_ids` desse registro.
- **RLS e grants:** as três tabelas com RLS ligada e sem policy para `authenticated`. `grant all` para o `service_role`.

- [ ] **Step 1:** Escrever a migration, no estilo de `supabase/migrations/20261105000001_import_mirror.sql` (funções definer e grants). Conferir as colunas de `external_ids` em `supabase/migrations/20261026000001_import_schema.sql`.
- [ ] **Step 2:** Validar no banco de testes, nunca no `.env.local`:
  ```bash
  URL=$(grep '^SUPABASE_DB_URL=' .env.ci | cut -d= -f2-) && SUPABASE_TEST_PROJECT_REF=cvqaaipjdirbbwfdgjox SUPABASE_DB_URL="$URL" pnpm ci:db-reset
  ```
  Expected: reset sem erro. O `.env.ci` fica no checkout principal; se faltar no seu, copie de `/Users/csiocamarini/Claude/Projects/oxyncrm/.env.ci`.
- [ ] **Step 3:** Commit `feat(pipedrive): tabelas e funções da atualização do Pipedrive pelo CRM`.

---

### Task 2: Escritas no cliente do Pipedrive

**Files:** Modify `src/lib/import/pipedrive/client.ts`, `src/lib/import/pipedrive/client.test.ts`

**Interfaces:**
- No objeto de `createPipedriveClient`:
  - `post(path, body): Promise<unknown>`;
  - `put(path, body): Promise<unknown>`;
  - `patch(path, body): Promise<unknown>`;
  - `del(path): Promise<void>`.
- Comportamento:
  - JSON com `content-type: application/json`;
  - mesmas tentativas, esperas e limites do `request`, inclusive o 429 e o `PipedriveAuthError` no 401;
  - devolvem `data` do envelope;
  - 404 no `del` não é erro (já apagado).

- [ ] **Step 1:** Testes (no estilo do arquivo): método e corpo certos, 429 seguido de 200, 401 vira `PipedriveAuthError`, 404 no `del` não lança.
- [ ] **Step 2:** Implementar sobre o laço `fetchWithRetry` existente (aceitar `method` e `body` no modo JSON). Nada de laço duplicado.
- [ ] **Step 3:** `pnpm vitest run src/lib/import/pipedrive/client.test.ts` PASS. Commit `feat(pipedrive): escritas no cliente do Pipedrive`.

---

### Task 3: Conversões CRM → Pipedrive

**Files:** Create `src/lib/pipedrive-push/mapping.ts` e `mapping.test.ts`

**Interfaces:**
```ts
export type PushEntity = "organizations" | "persons" | "leads" | "deals" | "activities" | "notes";
export type PushCtx = {
  pdUserOf(profileId: string | null): number | null;   // mapa de usuários ao contrário; null → usuário do token
  pdIdOf(entity: PushEntity, crmId: string | null): string | null; // external_ids
  pdStageOf(stageId: string): number | null;            // etapa CRM → etapa Pipedrive
  pdLeadLabelOf(companyId: string): string | null;      // empresa → etiqueta de lead
  customFields: { crmKey: string; pdKey: string; type: string; options?: Record<string, string> }[]; // ao contrário do mapa da importação
  pdActivityTypeOf(typeName: string, isMeeting: boolean): string; // tipo do CRM → key do tipo no Pipedrive (fallback "meeting"/"task")
  pdOutcomeOf(meetingOutcome: string | null): number | null;      // resultado da reunião → opção do campo outcome
};
export type PushPayload = { path: string; body: Record<string, unknown> } | { error: string };
export function toPdOrganization(row: Record<string, unknown>, ctx: PushCtx): PushPayload;
export function toPdPerson(row: Record<string, unknown>, ctx: PushCtx): PushPayload;
export function toPdLead(row: Record<string, unknown>, ctx: PushCtx): PushPayload;
export function toPdDeal(row: Record<string, unknown>, ctx: PushCtx): PushPayload;
export function toPdActivity(row: Record<string, unknown>, ctx: PushCtx): PushPayload;
export function toPdNote(row: Record<string, unknown>, ctx: PushCtx): PushPayload;
```

- [ ] **Step 1:** Testes por tipo, com o inverso de `src/lib/import/mapping.ts` (leia `mapOrganization`, `mapPerson`, `mapLead`, `mapDeal`, `mapActivity`, `mapNote` e os helpers `dueAt`, `contacts`, `applyCustom`):
  - campos básicos;
  - e-mails e telefones no formato `[{value, label, primary}]` do Pipedrive;
  - `owner_id`/`user_id` pelo mapa, ou ausente quando `null`;
  - vínculos pelos ids do Pipedrive (sem o id do relacionado: `{error: "pessoa ainda sem id no Pipedrive"}`);
  - etapa por `pdStageOf` (sem correspondente: `{error}`);
  - negócio `won`/`lost` com `lost_reason`;
  - campo personalizado de seleção pelo id da opção;
  - atividade com `due_date`/`due_time` em UTC (o inverso de `dueAt`), `duration` `HH:MM`, `done` e `outcome`;
  - anotação com `content` e o vínculo de maior precedência;
  - lead com `label_ids` da empresa e `value: {amount, currency}`.

  Os nomes exatos das colunas vêm das migrations de contatos, negócios, atividades e anotações.
- [ ] **Step 2:** Implementar funções puras.
- [ ] **Step 3:** `pnpm vitest run src/lib/pipedrive-push` PASS. Commit `feat(pipedrive): conversões do CRM para o Pipedrive`.

---

### Task 4: Store

**Files:** Create `src/lib/pipedrive-push/store.ts` e `store.test.ts` (banco falso de `src/lib/meet/fake-db.test-support.ts`)

**Interfaces:**
```ts
export interface PushStore {
  settings(): Promise<{ enabled: boolean; cursor: string | null }>;
  mirrorActive(now: Date): Promise<boolean>;
  buildContext(): Promise<PushCtx>;                       // mapas do último job de importação + external_ids sob demanda
  changed(entity: PushEntity, since: string, limit: number, after?: string): Promise<Record<string, unknown>[]>; // updated_at > since, deleted_at is null, por updated_at, id
  deleted(entity: PushEntity, since: string): Promise<{ id: string; company_id: string }[]>;                     // deleted_at > since
  retryQueue(): Promise<{ entity: PushEntity; record_id: string; company_id: string; attempts: number }[]>;
  loadOne(entity: PushEntity, id: string): Promise<Record<string, unknown> | null>;
  pdIdOf(entity: PushEntity, crmId: string): Promise<string | null>;
  link(entity: PushEntity, pdId: string, companyId: string, recordId: string): Promise<void>; // rpc pipedrive_push_link
  unlink(entity: PushEntity, recordId: string): Promise<void>;
  queueRetry(entity: PushEntity, recordId: string, companyId: string, error: string): Promise<void>; // attempts+1
  clearRetry(entity: PushEntity, recordId: string): Promise<void>;
  startRun(cursorFrom: string): Promise<string>;
  finishRun(id: string, r: { status: "done" | "failed"; cursorTo: string; counters: unknown; errors: unknown }): Promise<void>;
  saveCursor(cursor: string): Promise<void>;
  setEnabled(enabled: boolean, now: Date): Promise<void>;  // ligar grava enabled_at e cursor = now
}
export function supabasePushStore(db: SupabaseClient): PushStore;
```

- [ ] **Step 1:** Testes das consultas principais: filtros de `changed` e `deleted`, a regra do espelho, o `queueRetry` somando tentativas e o `setEnabled` gravando o cursor.
- [ ] **Step 2:** Implementar.
- [ ] **Step 3:** PASS. Commit `feat(pipedrive): store da atualização do Pipedrive`.

---

### Task 5: Executor da rodada

**Files:** Create `src/lib/pipedrive-push/run.ts` e `run.test.ts`

**Interfaces:**
```ts
export type PushReport = { status: "done" | "failed" | "skipped"; reason?: string; counters: Record<PushEntity, { created: number; updated: number; deleted: number; errors: number }>; errors: { entity: string; id: string; reason: string }[] };
export async function runPipedrivePush(deps: { client: Pick<PipedriveClient, "post" | "put" | "patch" | "del">; store: PushStore; now(): Date; log?: (m: string) => void }, opts: { budgetMs: number }): Promise<PushReport>;
```

- [ ] **Step 1:** Testes com o cliente e o store falsos.
  - **Quando não roda:**
    - desligado → `skipped`;
    - espelho ativo → `skipped` com o motivo.
  - **A rodada:**
    - processa primeiro a fila de retry (até 5 tentativas; na quinta falha sai da fila e fica só no relatório), depois as mudanças desde o cursor, na ordem da spec;
    - sem id no Pipedrive → `post` e `link`; com id → `put` (lead: `patch`);
    - exclusões → `del` e `unlink`, na ordem inversa;
    - a falha de um registro vai para `queueRetry` e não para a rodada.
  - **Cursor e relatório:**
    - o cursor vira o início da rodada quando ela termina dentro do tempo;
    - se o tempo acabar, o cursor vira o `updated_at` do último registro concluído;
    - `PipedriveAuthError` → `failed`, sem salvar o cursor;
    - `startRun` e `finishRun` são chamados.
  - **Casos do Review Focus:**
    - criado e mudado de novo antes da rodada → um `post` só;
    - pessoa falha → o negócio dela vai para o retry, sem `post`;
    - apagado e restaurado antes da rodada → só `put`;
    - restaurado depois de apagado no Pipedrive (sem vínculo) → `post` e `link` de novo;
    - o mesmo id do Pipedrive em duas empresas → só a versão com o `updated_at` mais recente é enviada.
- [ ] **Step 2:** Implementar.
- [ ] **Step 3:** PASS. Commit `feat(pipedrive): rodada da atualização do Pipedrive pelo CRM`.

---

### Task 6: Script, workflow e roteiro

**Files:**
- Create: `scripts/sync-crm-to-pipedrive.ts`, `.github/workflows/pipedrive-backup.yml`
- Modify: `package.json`, `docs/virada-pipedrive.md` (crie o arquivo se não existir)

- [ ] **Step 1:** Escrever o script (estilo de `scripts/sync-pipedrive.ts`, rodando com `tsx --conditions=react-server`):
  - **Sem argumentos:** roda a rodada com `budgetMs` de 50 min e imprime o relatório.
  - **`--ligar` e `--desligar`:** chamam `setEnabled` e saem.
  - **`--status`:** mostra a configuração, a última rodada e a fila de retry.
  - **Saída:** código 1 em `failed`.
  - **`package.json`:** `"sync:crm-para-pipedrive": "tsx --conditions=react-server scripts/sync-crm-to-pipedrive.ts"`.
- [ ] **Step 2:** Workflow `pipedrive-backup.yml`: `on: schedule: [{cron: "0 * * * *"}]` e `workflow_dispatch`. Tem `environment: producao`, as mesmas envs da `sync-pipedrive.yml`, `concurrency: pipedrive-backup` e `timeout-minutes: 55`, e roda `pnpm sync:crm-para-pipedrive`. Com a rotina desligada no banco, a rodada sai na hora (`skipped`).
- [ ] **Step 3:** Em `docs/virada-pipedrive.md`, acrescentar a seção "Piloto de 15 dias com o Pipedrive atualizado pelo CRM":
  - ligar com `pnpm sync:crm-para-pipedrive --ligar` logo depois de desligar a rotina diária;
  - deixar os usuários do Pipedrive só com leitura;
  - funil e etapa novos no CRM também precisam ser criados no Pipedrive;
  - conferir com `--status`;
  - no fim, `--desligar`, exportação completa e cancelamento.
- [ ] **Step 4:** `pnpm typecheck && pnpm lint && pnpm vitest run`. Commit `feat(pipedrive): rotina de hora em hora e roteiro do piloto`.
