# Importar e-mails e arquivos do Pipedrive Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trazer para o CRM os e-mails guardados no Pipedrive e os arquivos (anexos reais e arquivos dos cards), mostrando-os no histórico e numa seção "Arquivos" do card.

**Architecture:**
- **Banco:** tabelas próprias (`pipedrive_emails`, `pipedrive_email_links`, `record_files`) e um bucket privado `record-files`.
- **Importação:** um executor com dependências injetáveis (`runMailImport`). Ele lê o Pipedrive pelo cliente da importação, estendido com `get` e `download`, e grava por uma interface de store; um script o roda.
- **Interface:** os e-mails importados entram no histórico pelo mesmo `ThreadCard` do Gmail (`RecordThread.source = "pipedrive"`). Os arquivos aparecem num componente `RecordFiles` nas telas de detalhe.

**Tech Stack:** Next.js 16 (App Router, server actions), Supabase (Postgres, RLS, Storage), TypeScript, Vitest, tsx scripts.

**Spec:** `docs/superpowers/specs/2026-11-09-importar-emails-arquivos-pipedrive-design.md`

## Global Constraints

- Textos de interface, mensagens de erro e comentários em português do Brasil, no estilo do código vizinho.
- Comandos com `export PATH=$HOME/.local/node/bin:$PATH`. Testes com `pnpm vitest run <arquivo>`. Antes de cada commit: `pnpm typecheck` e `pnpm lint` sem erros.
- **Só existe banco de produção.** Nunca rodar `pnpm db:migrate`, nem o script de importação sem `--simular`, nem nada que escreva no banco ou no Storage. Quem aplica a migration e roda a importação de verdade é o controlador, com ok do usuário.
- Nunca imprimir nem commitar `PIPEDRIVE_API_TOKEN`, chaves ou o `.env.local`.
- **Next.js 16:** antes de escrever server action ou componente servidor novo, ler o guia correspondente em `node_modules/next/dist/docs/`.
- Não rodar formatador em arquivos inteiros: editar só as linhas da tarefa.
- Commits em português, terminando com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Valores da spec:**
  - corpo cortado em 1.048.576 caracteres;
  - limite do bucket 25 MB (26.214.400 bytes);
  - URL assinada de 60 segundos;
  - caminho no bucket `{company_id}/{record_files.id}/{filename}`;
  - selo "Importado do Pipedrive";
  - comando `pnpm import:pipedrive-arquivos`.

## Review Focus

1. **Pessoa do Pipedrive importada em duas empresas do CRM:** o e-mail vira uma linha por empresa, cada uma com o seu vínculo, e não um e-mail só ligado às duas. Testado na Task 5.
2. **Rodar o script de novo depois de parar no meio** (erro de rede ou Ctrl+C): nada duplica e o que faltou entra. Testado na Task 5.
3. **Mensagem do Pipedrive com campos faltando** (sem assunto, `from` vazio, `message_time` nulo, `to` nulo): entra com padrões e não derruba o lote. Testado na Task 3.
4. **Anexo de uma mensagem que não foi importada** (mensagem sem registro no CRM): é pulado e contado, nunca vira arquivo solto. Testado na Task 5.
5. **Caixa privada no CRM do vendedor dono do e-mail:** só ele e o admin geral leem. Coberto pela função SQL da Task 1 e pela filtragem das Tasks 6 e 7. Sem banco de testes, a conferência é na revisão da função.

---

### Task 1: Migration — tabelas, RLS e bucket

**Files:**
- Create: `supabase/migrations/20261110000001_pipedrive_mail_files.sql`

**Interfaces:**
- Produces (as tasks seguintes usam estes nomes):
  - tabelas `public.pipedrive_emails`, `public.pipedrive_email_links` e `public.record_files`, com as colunas da spec ("Modelo de dados");
  - funções `public.can_read_pipedrive_email(p_email uuid) returns boolean` e `public.can_read_record_file(p_file uuid) returns boolean`;
  - bucket `record-files`.

- [ ] **Step 1: Escrever a migration**

**`pipedrive_emails`:**
- Colunas: `id uuid pk default gen_random_uuid()`, `company_id uuid not null → companies on delete cascade`, `pipedrive_id bigint not null`, `pipedrive_thread_id bigint`, `owner_id uuid → profiles on delete set null`, `subject text not null default ''`, `from_email text not null default ''`, `from_name text`, `to jsonb not null default '[]'`, `cc jsonb not null default '[]'`, `sent_at timestamptz not null`, `snippet text not null default ''`, `body_html text check (body_html is null or char_length(body_html) <= 1048576)`, `rfc_message_id text`, `direction text not null check (direction in ('in','out'))`, `attachments jsonb not null default '[]'`, `imported_at timestamptz not null default now()`.
- `unique (company_id, pipedrive_id)`.
- Índices em `(company_id, pipedrive_thread_id)` e em `rfc_message_id`.

**`pipedrive_email_links`:**
- Colunas: `email_id uuid not null → pipedrive_emails on delete cascade`, `entity text not null check (entity in ('leads','deals','persons','organizations'))`, `record_id uuid not null`.
- Primary key `(email_id, entity, record_id)`; índice em `(entity, record_id)`.

**`record_files`:**
- Colunas: `id uuid pk`, `company_id uuid not null → companies cascade`, `entity text check (entity in ('leads','deals','persons','organizations'))`, `record_id uuid`, `email_id uuid → pipedrive_emails on delete cascade`, `pipedrive_id bigint`, `filename text not null`, `mime text`, `size bigint`, `storage_path text`, `remote_url text`, `created_by uuid → profiles on delete set null`, `created_at timestamptz not null default now()`, `deleted_at timestamptz`.
- `check ((email_id is not null) or (entity is not null and record_id is not null))`.
- `unique (company_id, pipedrive_id)`; índice em `(entity, record_id)`.

**`can_read_pipedrive_email`:**
- `language sql stable security definer set search_path = public, pg_temp`, no mesmo formato de `can_read_email_thread` (em `20261104000001_email_schema.sql`).
- Verdadeiro quando `current_user_active()` e uma das condições:
  - `e.owner_id = auth.uid()`;
  - `is_super_admin()`;
  - não existe `email_accounts` com `user_id = e.owner_id`, `company_id = e.company_id` e `visibility = 'private'`, e existe vínculo com `can_read_record(l.entity, l.record_id)`.

**`can_read_record_file`:**
- Mesmo formato. Verdadeiro quando `deleted_at is null` e uma das condições:
  - com `email_id`: `can_read_pipedrive_email(email_id)`;
  - sem `email_id`: `can_read_record(entity, record_id)`.

**Segurança:**
- RLS ligada nas três tabelas.
- `revoke all ... from anon, authenticated`; `grant select ... to authenticated`; `grant select, insert, update, delete ... to service_role`.
- Policies de select:
  - `pipedrive_emails`: `can_read_pipedrive_email(id)`;
  - `pipedrive_email_links`: `can_read_pipedrive_email(email_id)`;
  - `record_files`: `can_read_record_file(id)`.
- `revoke execute ... from public, anon` e `grant execute ... to authenticated` nas duas funções.

**Bucket:**
- `insert into storage.buckets (id, name, public, file_size_limit) values ('record-files', 'record-files', false, 26214400) on conflict (id) do nothing;`
- Sem policy em `storage.objects` para `authenticated`: só o service role lê e grava, e o download é por URL assinada.

Comentário no topo da migration: o que cada tabela guarda e que a limpeza do modo espelho não mexe nelas.

- [ ] **Step 2: Conferir a sintaxe sem aplicar**

Run: `grep -c "create table" supabase/migrations/20261110000001_pipedrive_mail_files.sql`
Expected: `3`. Reler a migration contra a spec. NÃO aplicar.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20261110000001_pipedrive_mail_files.sql
git commit -m "feat(pipedrive): tabelas e bucket para e-mails e arquivos importados"
```

---

### Task 2: Cliente do Pipedrive — `get` e `download`

**Files:**
- Modify: `src/lib/import/pipedrive/client.ts`
- Test: `src/lib/import/pipedrive/client.test.ts`

**Interfaces:**
- Produces, dentro do objeto que `createPipedriveClient` devolve:
  - `get(path: string): Promise<{ data: unknown; nextStart: number | null }>`. Caminho com a query, ex.: `/v1/persons/5/mailMessages?start=0&limit=100`. `nextStart` vem de `additional_data.pagination` (mais itens e `next_start`), senão `null`.
  - `download(path: string): Promise<{ bytes: Uint8Array; contentType: string | null }>`.

- [ ] **Step 1: Testes que falham**

Em `client.test.ts`, no estilo dos testes existentes (com `fetchImpl` e `sleepImpl` falsos):
- `it("get devolve data e nextStart da paginação")`: resposta `{success:true, data:[{id:1}], additional_data:{pagination:{more_items_in_collection:true, next_start:100}}}` → `{data:[{id:1}], nextStart:100}`. Sem mais itens → `nextStart` `null`. O header `x-api-token` vai como nos outros métodos.
- `it("get tenta de novo no 429")`: primeiro 429 com `Retry-After: 1`, depois 200. Devolve o dado e `sleepImpl` é chamado.
- `it("download devolve os bytes e o content-type")`: resposta `new Response(new Uint8Array([1,2,3]), {headers:{"content-type":"application/pdf"}})` → `bytes` igual a `[1,2,3]`, `contentType` `"application/pdf"`.
- `it("download lança PipedriveAuthError no 401")`.

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm vitest run src/lib/import/pipedrive/client.test.ts`
Expected: FAIL (`get`/`download` não existem).

- [ ] **Step 3: Implementar**

- `get` reaproveita o `request(path)` interno.
- `download` precisa das mesmas tentativas, esperas e limites do `request`, mas lendo `arrayBuffer`. Extraia o laço de tentativas para uma função interna usada pelos dois, sem duplicar o laço.

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm vitest run src/lib/import/pipedrive/client.test.ts`
Expected: PASS (todos, inclusive os antigos)

- [ ] **Step 5: Commit**

```bash
git add src/lib/import/pipedrive/client.ts src/lib/import/pipedrive/client.test.ts
git commit -m "feat(pipedrive): get genérico e download no cliente da importação"
```

---

### Task 3: Mapeamento puro de mensagens e arquivos

**Files:**
- Create: `src/lib/import/pipedrive-mail/mapping.ts`
- Test: `src/lib/import/pipedrive-mail/mapping.test.ts`

**Interfaces:**
- Produces:
```ts
export const MAX_BODY_CHARS = 1_048_576;
export const MAX_FILE_BYTES = 26_214_400;
export type PdAddress = { email_address?: string | null; name?: string | null };
export type PdMailMessage = {
  id: number; mail_thread_id?: number | null; subject?: string | null; snippet?: string | null;
  from?: PdAddress[] | null; to?: PdAddress[] | null; cc?: PdAddress[] | null;
  message_time?: string | null; add_time?: string | null; user_id?: number | null;
  mua_message_id?: string | null; sent_flag?: number | boolean | null;
};
export type PdFile = {
  id: number; name?: string | null; file_name?: string | null; file_type?: string | null; file_size?: number | null;
  inline_flag?: boolean | number | null; remote_location?: string | null; url?: string | null;
  mail_message_id?: number | null; deal_id?: number | null; lead_id?: string | null; person_id?: number | null;
  org_id?: number | null; activity_id?: number | null; add_time?: string | null; user_id?: number | null;
};
export type EmailRow = {
  pipedrive_id: number; pipedrive_thread_id: number | null; owner_id: string | null; subject: string;
  from_email: string; from_name: string | null; to: { email: string; name: string | null }[];
  cc: { email: string; name: string | null }[]; sent_at: string; snippet: string; body_html: string | null;
  rfc_message_id: string | null; direction: "in" | "out";
};
export function mapMailMessage(m: PdMailMessage, ctx: { ownerId: string | null; body: string | null }): EmailRow;
export type FileTarget =
  | { kind: "email"; pdMessageId: number }
  | { kind: "record"; entity: "deals" | "leads" | "persons" | "organizations"; pdId: string }
  | { kind: "activity"; pdActivityId: number }
  | { kind: "skip"; reason: "inline" | "ics" | "no_target" };
export function classifyFile(f: PdFile): FileTarget;
export function isRemoteFile(f: PdFile): boolean;
export function fileName(f: PdFile): string;
```

- [ ] **Step 1: Testes que falham**

`mapMailMessage`:
- `sent_flag` 1 ou `true` → `direction "out"`; senão `"in"`.
- `sent_at`: `message_time` (formato do Pipedrive `"2026-03-02 14:05:00"`, que é UTC) vira ISO `"2026-03-02T14:05:00.000Z"`. Sem `message_time`, usa `add_time`. Sem os dois, `"1970-01-01T00:00:00.000Z"`.
- `body` maior que `MAX_BODY_CHARS` é cortado para esse tamanho exato; `body` `null` → `body_html: null`.
- `from` vazio ou nulo → `from_email ""`, `from_name null`.
- `to`/`cc`: viram `{email, name}` e descartam os itens sem `email_address`.
- `subject` nulo → `""`; `snippet` nulo → `""`.
- `mua_message_id` vai para `rfc_message_id`, e string vazia vira `null`.

`classifyFile` (a ordem dos testes fixa a precedência):
- `inline_flag` true → `skip inline`.
- `file_type "ics"` ou nome terminando em `.ics` (sem diferenciar maiúsculas) → `skip ics`. Vale também quando é de e-mail.
- `mail_message_id` → `email`.
- `deal_id` → `record deals`, depois `lead_id` → `leads`, depois `person_id` → `persons`, depois `org_id` → `organizations`, depois `activity_id` → `activity`, senão `skip no_target`. O `pdId` é sempre string.

`isRemoteFile`: `remote_location` presente e diferente de `"s3"` → `true`.

`fileName`: `file_name ?? name ?? "arquivo-{id}"`, com `/` e `\` trocados por `_`.

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm vitest run src/lib/import/pipedrive-mail/mapping.test.ts`
Expected: FAIL (módulo não existe)

- [ ] **Step 3: Implementar `mapping.ts`**

Funções puras, sem I/O.

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm vitest run src/lib/import/pipedrive-mail/mapping.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/import/pipedrive-mail/mapping.ts src/lib/import/pipedrive-mail/mapping.test.ts
git commit -m "feat(pipedrive): mapeamento de e-mails e arquivos do Pipedrive"
```

---

### Task 4: Store da importação (Supabase)

**Files:**
- Create: `src/lib/import/pipedrive-mail/store.ts`
- Test: `src/lib/import/pipedrive-mail/store.test.ts`

**Interfaces:**
- Consumes: `EmailRow` (Task 3); as tabelas e o bucket (Task 1).
- Produces:
```ts
export type RecordRef = { companyId: string; recordId: string };
export type PdEntity = "deals" | "leads" | "persons" | "organizations" | "activities";
export interface MailImportStore {
  /** Mapa de usuários do Pipedrive (id em string) → profile, do último job de importação concluído. */
  userMap(): Promise<Record<string, string>>;
  /** Registros do CRM (um por empresa) ligados a esse id do Pipedrive, pelo external_ids. */
  recordsFor(entity: PdEntity, pdId: string): Promise<RecordRef[]>;
  /** Registro vinculado de uma atividade do CRM (deal → lead → person → organization). */
  activityRecord(activityId: string): Promise<{ entity: "deals" | "leads" | "persons" | "organizations"; recordId: string } | null>;
  emailId(companyId: string, pdMessageId: number): Promise<string | null>;
  insertEmail(companyId: string, row: EmailRow): Promise<string>;
  linkEmail(emailId: string, entity: "deals" | "leads" | "persons" | "organizations", recordId: string): Promise<boolean>; // true se criou
  setEmailAttachments(emailId: string, attachments: { file_id: string; filename: string; size: number | null; mime: string | null }[]): Promise<void>;
  hasFile(companyId: string, pdFileId: number): Promise<boolean>;
  insertFile(row: { id: string; company_id: string; entity: string | null; record_id: string | null; email_id: string | null; pipedrive_id: number; filename: string; mime: string | null; size: number | null; storage_path: string | null; remote_url: string | null; created_by: string | null }): Promise<void>;
  upload(path: string, bytes: Uint8Array, mime: string | null): Promise<void>;
}
export function supabaseMailStore(db: SupabaseClient): MailImportStore;
```

- [ ] **Step 1: Testes que falham**

Com um cliente Supabase falso mínimo, no arquivo de teste, que registra as chamadas:
- `recordsFor("persons","5")` consulta `external_ids` com `source = 'pipedrive'`, `entity = 'persons'`, `external_id = '5'` e devolve `[{companyId, recordId}]`.
- `insertEmail` grava com `company_id` e devolve o id. Em conflito (`23505`), relê pelo `(company_id, pipedrive_id)` e devolve o id existente.
- `linkEmail` usa upsert com `ignoreDuplicates` e devolve `false` quando já existia.
- `upload` chama `storage.from("record-files").upload(path, bytes, { contentType: mime ?? undefined, upsert: true })` e lança em erro.
- `userMap` lê `mappings.users` do último `import_jobs` com `source = 'pipedrive'` e `status = 'done'`, ordenado por `finished_at desc`.

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm vitest run src/lib/import/pipedrive-mail/store.test.ts`
Expected: FAIL

- [ ] **Step 3: Implementar `supabaseMailStore`**

- Erros do Supabase viram `Error` com o nome da operação, como em `src/lib/meet/run.ts` (`check`).
- `activityRecord` lê `activities` (`deal_id, lead_id, person_id, organization_id`) e aplica essa precedência.

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm vitest run src/lib/import/pipedrive-mail/store.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/import/pipedrive-mail/store.ts src/lib/import/pipedrive-mail/store.test.ts
git commit -m "feat(pipedrive): store da importação de e-mails e arquivos"
```

---

### Task 5: Executor da importação

**Files:**
- Create: `src/lib/import/pipedrive-mail/run.ts`
- Test: `src/lib/import/pipedrive-mail/run.test.ts`

**Interfaces:**
- Consumes: `get`/`download`/`page` do cliente (Task 2); `mapMailMessage`, `classifyFile`, `isRemoteFile`, `fileName`, `MAX_FILE_BYTES` (Task 3); `MailImportStore` (Task 4).
- Produces:
```ts
export type MailImportClient = Pick<PipedriveClient, "page" | "get" | "download">;
export type MailImportReport = {
  emails: { created: number; existing: number; links: number; noRecord: number };
  files: { uploaded: number; remote: number; tooLarge: number; existing: number; skippedInline: number; skippedIcs: number; noTarget: number; noEmail: number };
  errors: { item: string; reason: string }[];
};
export async function runMailImport(
  deps: { client: MailImportClient; store: MailImportStore; newId?: () => string; log?: (msg: string) => void },
  opts?: { dryRun?: boolean; concurrency?: number },
): Promise<MailImportReport>;
```

- [ ] **Step 1: Testes que falham**

Com cliente e store falsos em memória. Os testes cobrem:
- **Mensagens:** percorre `deals`, `persons` e `organizations` por `client.page(...)` e só chama `client.get("/v1/{deals|persons|organizations}/{id}/mailMessages?start=…&limit=100")` para quem tem `email_messages_count > 0`. A paginação segue `nextStart`.
- **Duas empresas:** mensagem vista pela pessoa 5, que tem `recordsFor` com duas empresas → duas linhas de e-mail, cada uma com o seu vínculo (`emails.created = 2`, `links = 2`).
- **Mesma mensagem por outro registro:** vista também pela organização 9 (mesma empresa) → nenhum e-mail novo, mais um vínculo (`existing` sobe, `links` sobe).
- **Corpo uma vez só:** buscado por `client.get("/v1/mailbox/mailMessages/{id}?include_body=1")` (campo `data.body`), uma vez por mensagem, mesmo com várias empresas.
- **Sem registro no CRM:** `recordsFor` vazio → não grava, `noRecord` sobe.
- **Arquivos:** percorre `client.get("/v1/files?start=…&limit=500&include_deleted_files=0")`.
  - De e-mail importado: `download("/v1/files/{id}/download")`, `upload` em `{company_id}/{newId()}/{fileName}`, `insertFile` com `email_id`, e o e-mail ganha o anexo em `setEmailAttachments`.
  - De e-mail não importado: `noEmail` sobe.
  - De card: vínculo pelo `recordsFor` da entidade. De atividade: `recordsFor("activities", …)` e depois `activityRecord`.
  - Remoto: `insertFile` com `remote_url = url`, sem download (`remote` sobe).
  - `file_size` acima de `MAX_FILE_BYTES`: `insertFile` sem `storage_path` e sem download (`tooLarge` sobe).
  - Inline e `.ics`: contam em `skippedInline` e `skippedIcs`.
- **Idempotência:** rodar duas vezes com o mesmo store não cria nada na segunda (`emails.created = 0`, `files.uploaded = 0`, `existing` contado).
- **Falha de item:** `download` lançando em um arquivo registra em `errors` (`item: "arquivo {id}"`) e continua com os outros.
- **`dryRun`:** nenhum `insertEmail`, `linkEmail`, `upload` nem `insertFile` é chamado, mas os contadores refletem o que seria feito.
- **Token inválido:** `PipedriveAuthError` não é erro de item; propaga e encerra a importação.

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm vitest run src/lib/import/pipedrive-mail/run.test.ts`
Expected: FAIL

- [ ] **Step 3: Implementar `runMailImport`**

- Primeiro os e-mails, depois os arquivos (o arquivo de e-mail precisa do e-mail gravado).
- `concurrency` (padrão 4) limita as buscas de corpo e os downloads simultâneos, com um limitador simples no próprio arquivo.
- `owner_id` vem de `userMap()[String(m.user_id)] ?? null`.
- Os anexos do e-mail são acumulados por e-mail e gravados com `setEmailAttachments` no fim de cada e-mail.
- `log` recebe uma linha a cada 200 mensagens e a cada 200 arquivos.

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm vitest run src/lib/import/pipedrive-mail/run.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/import/pipedrive-mail/run.ts src/lib/import/pipedrive-mail/run.test.ts
git commit -m "feat(pipedrive): executor da importação de e-mails e arquivos"
```

---

### Task 6: Script `pnpm import:pipedrive-arquivos`

**Files:**
- Create: `scripts/import-pipedrive-files.ts`
- Modify: `package.json` (scripts)

**Interfaces:**
- Consumes: `runMailImport`, `supabaseMailStore`, `createPipedriveClient`, `createAdminClient`, `loadEnv`.

- [ ] **Step 1: Escrever o script**

- **Cabeçalho:** comentário no estilo de `scripts/sync-pipedrive.ts`, dizendo o que faz, que é reexecutável, que `--simular` só conta e que o token nunca é impresso.
- **Execução:**
  - lê `PIPEDRIVE_API_TOKEN` (erro se faltar);
  - roda `runMailImport({ client, store: supabaseMailStore(createAdminClient()), log: console.log }, { dryRun: args.has("--simular") })`;
  - imprime o relatório como tabela legível em português;
  - imprime os 20 primeiros erros e sai com código 1 se houver erro.
- **`package.json`:** `"import:pipedrive-arquivos": "tsx scripts/import-pipedrive-files.ts"`, ao lado de `import:pipedrive-etapas`.

- [ ] **Step 2: Conferir tipos**

Run: `pnpm typecheck`
Expected: sem erros. NÃO rodar o script (nem com `--simular`): o controlador roda.

- [ ] **Step 3: Commit**

```bash
git add scripts/import-pipedrive-files.ts package.json
git commit -m "feat(pipedrive): script pnpm import:pipedrive-arquivos"
```

---

### Task 7: Leitura no CRM — conversas importadas, corpo, arquivos e download

**Files:**
- Create: `src/lib/pipedrive-mail/queries.ts`, `src/lib/pipedrive-mail/actions.ts`, `src/lib/pipedrive-mail/view.ts`
- Modify: `src/lib/gmail/thread-view.ts` (tipos), `src/lib/gmail/queries.ts` (`MESSAGE_COLUMNS` ganha `rfc_message_id`)
- Test: `src/lib/pipedrive-mail/view.test.ts`, `src/lib/gmail/thread-view.test.ts` (ajustes)

**Interfaces:**
- Consumes: as tabelas da Task 1.
- Produces:
  - Em `thread-view.ts`:
    - `RecordThread` ganha `source: "gmail" | "pipedrive"`; `buildRecordThreads` marca `"gmail"`.
    - `ThreadMessageView` ganha `rfcMessageId: string | null`, e `attachments` passa a `{ filename: string; fileId?: string }[]`.
    - `MessageRow` ganha `rfc_message_id`.
  - Em `src/lib/pipedrive-mail/view.ts`:
    - `buildPipedriveThreads(rows: PipedriveEmailRow[], linkIdFor: (emailId: string) => string): RecordThread[]`, que agrupa por `pipedrive_thread_id` (sem thread, uma conversa por e-mail), com `source "pipedrive"`, `accountId ""`, `gmailThreadId ""`, `accountEmail null`, `isMine false` e `canUnlink false`;
    - `dropImportedDuplicates(gmail: RecordThread[], imported: RecordThread[]): RecordThread[]`, que tira das importadas as mensagens cujo `rfcMessageId` aparece nas do Gmail e as conversas que ficarem vazias.
  - Em `queries.ts`:
    - `getRecordPipedriveThreads(entity: RecordEntity, recordId: string): Promise<RecordThread[]>`, pelo cliente do usuário, com junção `pipedrive_email_links!inner` filtrada por `entity`/`record_id`, sem o corpo, até 500 e-mails;
    - `getRecordFiles(entity: RecordEntity, recordId: string): Promise<RecordFileView[]>`, só arquivos de card (`email_id is null`, `deleted_at is null`), mais recentes primeiro.
  - Em `actions.ts` (server actions):
    - `getPipedriveEmailBody(emailId: string): Promise<ActionResult<{ html: string | null; text: null }>>`;
    - `getRecordFileUrl(fileId: string): Promise<ActionResult<{ url: string }>>`. Lê a linha pelo cliente do usuário (a RLS decide). Com `storage_path`, gera a URL assinada de 60 s pelo cliente admin; com `remote_url`, devolve a URL; sem nenhum, `{ok:false, error:"Este arquivo não foi trazido do Pipedrive (maior que 25 MB)."}`.
  - `export type RecordFileView = { id: string; filename: string; size: number | null; createdAt: string; remote: boolean; available: boolean }`.

- [ ] **Step 1: Testes que falham**

`view.test.ts`:
- agrupamento por thread;
- mensagens em ordem de `sent_at` crescente;
- `attachments` com `fileId`;
- `dropImportedDuplicates` remove a mensagem duplicada e a conversa vazia, e mantém a conversa com uma mensagem só dela.

Ajustar `thread-view.test.ts`: `source: "gmail"` e `rfcMessageId`.

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm vitest run src/lib/pipedrive-mail/view.test.ts src/lib/gmail/thread-view.test.ts`
Expected: FAIL

- [ ] **Step 3: Implementar**

`queries.ts` e `actions.ts` seguem `src/lib/gmail/queries.ts` e `src/lib/gmail/message-body-actions.ts`: validação de uuid com zod, `getCurrentProfile`, `translateDbError` e falha em silêncio com log na listagem.

- [ ] **Step 4: Rodar e ver passar; tipos**

Run: `pnpm vitest run src/lib/pipedrive-mail src/lib/gmail && pnpm typecheck`
Expected: PASS e sem erros de tipo

- [ ] **Step 5: Commit**

```bash
git add src/lib/pipedrive-mail src/lib/gmail/thread-view.ts src/lib/gmail/thread-view.test.ts src/lib/gmail/queries.ts
git commit -m "feat(pipedrive): leitura dos e-mails e arquivos importados no CRM"
```

---

### Task 8: Interface — histórico, anexos, seção Arquivos e privacidade

**Files:**
- Modify: `src/components/records/record-history.tsx`, `src/components/email/thread-card.tsx`, `src/components/email/message-view.tsx`
- Create: `src/components/records/record-files.tsx`
- Modify: as telas de detalhe (prop `details`): `src/app/(app)/[empresa]/negocios/[id]/page.tsx`, `leads/[id]/page.tsx`, `contatos/pessoas/[id]/page.tsx` e `contatos/organizacoes/[id]/page.tsx`
- Modify: `src/app/(legal)/privacidade/page.tsx`

**Interfaces:**
- Consumes: `getRecordPipedriveThreads`, `dropImportedDuplicates`, `getRecordFiles`, `getPipedriveEmailBody`, `getRecordFileUrl` (Task 7).

- [ ] **Step 1: Histórico**

`RecordHistoryContent` busca `getRecordPipedriveThreads` em paralelo, com `.catch` que loga e devolve `[]`. Passa para `Timeline` `threads = [...gmail, ...dropImportedDuplicates(gmail, imported)]`. O `Composer` de responder continua só para as conversas `source === "gmail"` e `isMine`.

- [ ] **Step 2: Cartão e mensagem**

**`ThreadCard`:**
- com `source === "pipedrive"`, mostra o selo `Importado do Pipedrive`, no mesmo estilo dos outros selos pequenos do componente;
- não mostra "Caixa:" nem "Desvincular".

**`MessageView`:**
- recebe `source` (via `ThreadCard`) e busca o corpo por `getPipedriveEmailBody` quando `"pipedrive"`, senão como hoje;
- anexos com `fileId` viram botão que chama `getRecordFileUrl` e abre a URL numa nova aba (`window.open(url, "_blank", "noopener")`), com `toast.error` na falha;
- sem `fileId`, o chip continua como hoje.

- [ ] **Step 3: Seção Arquivos**

`RecordFiles({ entity, recordId })` é um componente servidor dentro de `Suspense`, num `Card` com o mesmo cabeçalho de "Cronograma" na tela do negócio. O título é `Arquivos ({n})`, e sem arquivos nada aparece.

Lista nome, tamanho legível (KB/MB) e data (`formatDate`). Um botão cliente (`RecordFileButton`) chama `getRecordFileUrl` e abre a URL. Arquivo não disponível aparece com o texto `Não trazido do Pipedrive (maior que 25 MB)`.

Incluir `<RecordFiles … />` no fim do `details` das quatro telas.

- [ ] **Step 4: Privacidade**

Em "Dados comerciais", acrescentar que os e-mails e os arquivos guardados no Pipedrive (corpo, anexos e arquivos dos cards) também são importados, e que os arquivos ficam em armazenamento privado. Atualizar `LEGAL_UPDATED` em `src/components/legal/legal-doc.tsx` para a data do commit (`10 de novembro de 2026` se for no dia 10; senão a data do dia).

- [ ] **Step 5: Tipos, lint e testes**

Run: `pnpm typecheck && pnpm lint && pnpm vitest run`
Expected: tudo passando

- [ ] **Step 6: Commit**

```bash
git add src/components src/app
git commit -m "feat(pipedrive): e-mails importados no histórico e seção Arquivos no card"
```
