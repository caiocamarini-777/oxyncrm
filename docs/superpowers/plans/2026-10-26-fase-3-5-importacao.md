# Fase 3.5: Importação do Pipedrive. Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** um assistente, só para o admin geral, que importa do Pipedrive para o Oxyn CRM:
- organizações, pessoas, leads, negócios, atividades, anotações e produtos;
- com mapeamento de funis para empresas, de usuários e de campos personalizados;
- reimportável sem duplicar;
- com relatório final de contagens e erros.

**Architecture:**
- **Escrita no banco.** Toda gravação passa por funções `security definer` executáveis só pelo `service_role`:
  - `import_upsert_<entidade>(job, rows jsonb)`. Cada uma ativa um desvio sancionado e restrito à transação (GUC `oxyn.importing` = id do job). Esse desvio permite gravar campos históricos (`won_at`, `lost_at`, `stage_entered_at`, `created_at`) e leads já convertidos, e suprime eventos de timeline falsos.
  - A idempotência vem de `external_ids`.
  - Erros por linha vão para o log do job e não abortam o lote.
- **Motor em TypeScript, server-only.**
  - Lê a API do Pipedrive com paginação e backoff.
  - Converte com funções puras de mapeamento.
  - Processa o job em etapas com cursor. Cada chamada processa um pedaço de no máximo cerca de 40s e devolve o progresso.
  - O assistente chama a próxima etapa enquanto houver trabalho, e um script de linha de comando roda o job até o fim.

**Tech Stack:** Next.js 16 App Router, Supabase Postgres 17 (pgTAP), zod 4, Vitest, Playwright, com servidor HTTP falso do Pipedrive nos testes.

**Spec:** `docs/superpowers/specs/2026-10-21-oxyn-crm-design.md`, seções 4.7 e 6 (Fase 3.5). Valem também as pendências "Antes da importação do Pipedrive (fase 3.5)" de `docs/superpowers/followups/2026-10-23-fase-3-pendencias.md`.

## Global Constraints

- Interface em PT-BR. Sem emoji e sem travessão. Marca teal (`#1A82A2`, `#6498A8`, `#75ACBA`), nunca laranja ou âmbar. Fontes Montserrat e Inter.
- Regras vivem no banco. Migrações novas a partir de `20261026000001`; migrações aplicadas são imutáveis; `create or replace` sempre sobre o corpo mais recente. Funções `security definer` com `set search_path = public, pg_temp` e `execute` revogado de `public, anon, authenticated`. As de importação são concedidas só a `service_role`.
- O token do Pipedrive vem só de `PIPEDRIVE_API_TOKEN`, lido no servidor. Ele nunca é gravado no banco, nunca vai para o cliente e nunca aparece em log. A URL base vem de `PIPEDRIVE_BASE_URL`, com padrão `https://api.pipedrive.com`, para os testes apontarem para o servidor falso. A autenticação é pelo header `x-api-token`, nunca pela query string.
- Next.js 16:
  - `await connection()` antes de ler sessão ou relógio.
  - `export const instant = false` nas páginas.
  - Sem `Date.now` em render.
  - Cliente admin só em módulos `server-only`.
- Atividades importadas recebem `legacy = true`. O canal é deduzido pelo tipo e, sem correspondência, vai para o canal legado "Não informado".
- Mapeamento de canal pelo `key_string` do tipo do Pipedrive. A primeira correspondência vence:

  | key_string | Canal |
  |---|---|
  | `call` | Ligação |
  | `email` | E-mail |
  | `linkedin` | LinkedIn |
  | `whatsapp`, `task` cujo nome é "Whatsapp" | WhatsApp |
  | demais | Não informado (legado) |

- Mapeamento de tipo:
  - `meeting`, `reuniao`, `reuniao_realizada` e `lunch` viram o tipo de reunião da empresa (`is_meeting`).
  - `reuniao_realizada` concluída recebe `meeting_outcome = 'held'`.
  - O resto vira o tipo "Tarefa", ou o primeiro tipo ativo que não é reunião.
- Commits em PT-BR, estilo convencional, com o trailer do agente.

## Review Focus

- **Reimportação.** Rodar o mesmo job duas vezes não cria duplicatas. O registro alterado no Pipedrive é atualizado, e o registro editado no CRM depois da importação não é sobrescrito em campos que o usuário mudou. Regra: atualiza só se `updated_at` do CRM for igual ao gravado pela importação anterior, que fica guardado em `external_ids.imported_at`. Teste em pgTAP na Task 2.
- **Registro órfão ou inconsistente.** Exemplos: negócio de funil não mapeado, pessoa sem nome, atividade apontando para negócio inexistente, data inválida. O comportamento esperado é registrar no log do job com o motivo e seguir, sem abortar o lote. Teste em pgTAP na Task 2 e em Vitest na Task 3.
- **Contato ligado a negócios de empresas diferentes.** Ele é duplicado, um por empresa, com `external_ids` por empresa, e cada cópia liga aos negócios da sua empresa. Teste na Task 3 (mapeamento) e na Task 2 (chave `(source, entity, external_id, company_id)`).
- **Token ausente, inválido ou limite de requisições (429).** Token ausente ou inválido gera uma mensagem clara no assistente, sem 500. Um 429 é esperado com backoff e retentado até 5 vezes. Teste em Vitest na Task 3 e em E2E na Task 5.
- **Desvio sancionado vazando.** O desvio nunca vale para `authenticated`. Mesmo com o GUC setado, um usuário logado não grava `won_at` histórico. Teste em pgTAP na Task 1.

---

### Task 1: Schema de importação e desvio sancionado

**Files:**
- Create: `supabase/migrations/20261026000001_import_schema.sql`
- Test: `supabase/tests/31_import_schema.test.sql`

**Interfaces:**
- Produces:
  - Tabela `import_jobs`. Colunas: `id`, `source text check (source in ('pipedrive'))`, `status text check (status in ('draft','running','paused','done','failed'))`, `mappings jsonb not null default '{}'`, `cursor jsonb not null default '{}'`, `counters jsonb not null default '{}'`, `errors jsonb not null default '[]'`, `created_by`, `created_at`, `started_at`, `finished_at`. `errors` guarda no máximo 1000 itens `{entity, external_id, reason}`; o resto só incrementa `counters.<entidade>.errors`.
  - Tabela `external_ids`. Colunas: `source`, `entity`, `external_id text`, `company_id`, `record_id uuid`, `job_id`, `imported_at timestamptz`, `record_updated_at timestamptz`. `primary key (source, entity, external_id, company_id)`, com índice em `(entity, record_id)`.
  - RLS:
    - `import_jobs`: leitura e escrita só para o admin geral.
    - `external_ids`: leitura só para o admin geral; escrita só por funções definer.
  - Função `importing() returns boolean`, `stable`. É verdadeira só quando `current_setting('oxyn.importing', true)` não está vazio e `auth.uid() is null`.
  - `create or replace` dos triggers, sempre sobre o corpo mais recente:
    - `deals_status_fields` e `deals_stage_entry`: quando `importing()`, respeitam os valores vindos em `won_at`, `lost_at`, `stage_entered_at` e `created_at`.
    - `guard_lead_status`: quando `importing()`, permite inserir lead `converted` com `converted_deal_id` e `converted_at`.
    - Triggers de timeline (`*_timeline`, `activities_timeline_*`, `notes_timeline`, `record_labels_timeline`): quando `importing()`, não registram nada.
    - `generate_activity_reminders` ignora atividades com `legacy`. Confirme que já ignora.

- [ ] **Step 1: Escrever `31_import_schema.test.sql`.** Asserções:
  - Usuário logado não lê `import_jobs`; o admin geral lê.
  - `importing()` é falso para `authenticated` mesmo com `set_config('oxyn.importing','x',true)`.
  - Como `postgres`, com o GUC, um insert de negócio `won` com `won_at = '2024-03-10'` preserva a data.
  - Sem o GUC, o trigger sobrescreve `won_at` com `now()`.
  - Com o GUC, um lead `converted` é aceito.
  - Com o GUC, inserir lead, negócio, atividade e anotação não cria `timeline_events`.
  - O limite de 1000 erros é respeitado por uma função auxiliar `import_log_error(job, entity, external_id, reason)`, interna e definer.
- [ ] **Step 2: Rodar `pnpm test:db`** e ver o arquivo 31 falhar.
- [ ] **Step 3: Implementar a migração.**
- [ ] **Step 4: Rodar `pnpm db:migrate && pnpm test:db`.** Esperado: tudo verde.
- [ ] **Step 5: Commit** com a mensagem `feat(db): schema de importação e desvio sancionado`.

### Task 2: Funções de importação por entidade

**Files:**
- Create: `supabase/migrations/20261026000002_import_upserts.sql`
- Test: `supabase/tests/32_import_upserts.test.sql`

**Interfaces:**
- Consumes: Task 1.
- Produces:
  - `import_upsert(p_job uuid, p_entity text, p_rows jsonb) returns jsonb`. Devolve `{created, updated, skipped, errors}`, é `security definer` e só o `service_role` executa. Seta `oxyn.importing` = job, local à transação, e despacha para as funções internas por entidade:
    - `organizations`: `{external_id, company_id, owner_id, name, address?, custom_fields?, created_at}`.
    - `persons`: `{external_id, company_id, owner_id, name, emails[], phones[], organization_external_id?, custom_fields?, created_at}`.
    - `leads`: `{external_id, company_id, owner_id, title, value?, person_external_id?, organization_external_id?, source_name?, labels[]?, status ('open'|'archived'), created_at}`.
    - `deals`: `{external_id, company_id, owner_id, pipeline_id, stage_id, title, status, value?, setup_total?, mrr?, contract_months?, expected_close_date?, won_at?, lost_at?, lost_reason?, stage_entered_at?, person_external_id?, organization_external_id?, lead_external_id?, created_at}`.
      - `lost_reason` em texto é casado por nome com `lost_reasons` da empresa ou criado.
      - Negócio `lost` sem motivo recebe o motivo "Importado sem motivo" (criado se faltar).
      - Contrato inválido (MRR > 0 sem prazo) é gravado com `mrr = 0`, e o motivo vai para o log como aviso, sem descartar o negócio.
    - `activities`: `{external_id, company_id, owner_id, type ('meeting'|'task'), channel_name, subject, due_at, done, completed_at?, meeting_outcome?, note?, deal_external_id?, lead_external_id?, person_external_id?, organization_external_id?, created_at}`.
      - Sempre `legacy = true`.
      - Concluída com resultado vazio recebe o resultado "Importado" (criado se faltar, `classification` neutra). Assim a regra de resultado obrigatório não barra.
      - Sem nenhum vínculo resolvido: erro de linha.
    - `notes`: `{external_id, company_id, entity, record_external_id, content, author_id, created_at}`.
    - `products`: `{external_id, company_id, name, kind, price}`.
  - Lead convertido: quando um negócio chega com `lead_external_id`, a função marca o lead como `converted`, com `converted_deal_id` e `converted_at = deal.created_at`.
  - Depois dos negócios, `import_rebuild_deal_derivatives(p_job)`:
    - gera `deal_stage_history` (uma entrada inicial com `stage_entered_at`);
    - gera o cronograma de receita dos negócios importados;
    - não gera eventos de timeline.
  - Regra de atualização na reimportação: atualiza só quando `record.updated_at = external_ids.record_updated_at`, ou seja, o registro não foi editado no CRM. Caso contrário conta em `skipped`. Depois de gravar, atualiza `record_updated_at`.

- [ ] **Step 1: Escrever `32_import_upserts.test.sql`.** Fixture: uma empresa, um funil com 2 etapas, dois usuários e um job. Asserções:
  - Criação de cada entidade com os vínculos resolvidos.
  - Reimportação idêntica: `created = 0`, sem duplicatas.
  - Reimportação com título alterado: `updated = 1`.
  - Registro editado no CRM e depois reimportado: `skipped = 1`, título do CRM preservado.
  - Negócio `won` com `won_at` histórico preservado, e `deal_stage_history` com uma linha.
  - Negócio com `lead_external_id`: lead `converted` e ligado.
  - Atividade sem vínculo: erro de linha, lote segue e `errors = 1`.
  - Atividade concluída sem resultado: recebe "Importado", `legacy = true`.
  - Nenhum `timeline_events` criado.
  - `authenticated` não executa `import_upsert` e recebe erro de permissão.
  - Pessoa importada em duas empresas: dois registros, duas linhas em `external_ids`.
- [ ] **Step 2: Rodar `pnpm test:db`** e ver o arquivo 32 falhar.
- [ ] **Step 3: Implementar.** As linhas entram por `jsonb_to_recordset`. Cada linha é processada em um subbloco `begin ... exception when others then` que registra o erro via `import_log_error` com `sqlerrm` truncado em 300 caracteres.
- [ ] **Step 4: Rodar `pnpm db:migrate && pnpm test:db`.** Esperado: tudo verde.
- [ ] **Step 5: Commit** com a mensagem `feat(db): funções de importação idempotentes`.

### Task 3: Cliente do Pipedrive e mapeamento puro

**Files:**
- Create: `src/lib/import/pipedrive/client.ts` (`server-only`)
- Create: `src/lib/import/pipedrive/types.ts`
- Create: `src/lib/import/mapping.ts` (funções puras)
- Create: `src/lib/import/mapping.test.ts`, `src/lib/import/pipedrive/client.test.ts`

**Interfaces:**
- Produces:
  - `createPipedriveClient({token, baseUrl, fetchImpl?}) → { me(), pipelines(), stages(), users(), activityTypes(), leadLabels(), dealFields(), personFields(), organizationFields(), page(entity, start, limit=500) → {items, nextStart|null} }`.
    - `entity` é um de `organizations`, `persons`, `leads`, `deals` (com `status=all_not_deleted`), `activities` (com `user_id=0`), `notes` ou `products`.
    - Header `x-api-token`.
    - Em 429 ou 5xx: backoff exponencial de 1s, 2s, 4s, 8s e 16s, respeitando `Retry-After`, até 5 tentativas.
    - Em 401: `PipedriveAuthError`.
  - `ImportMappings` (zod), com:
    - `pipelines: Record<pdPipelineId, {companyId, pipelineId|null (null = criar com o mesmo nome), stages: Record<pdStageId, stageId|null>}>`;
    - `users: Record<pdUserId, profileId>`;
    - `fallbackOwnerId`;
    - `leadLabelCompany: Record<pdLabelId, companyId>`;
    - `defaultCompanyId` (para contatos e leads sem empresa definida);
    - `customFields: Record<pdFieldKey, {target: 'native:setup_total'|'native:mrr'|'native:contract_months'|'custom', customFieldKey?}>`;
    - `ignorePipelines: pdPipelineId[]`.
  - Mapeadores puros:
    - `mapOrganization`, `mapPerson`, `mapLead`, `mapDeal`, `mapActivity`, `mapNote`, `mapProduct`, de `(pdItem, ctx) → Row | {error}`.
    - `channelFor(typeKey, typeName)` e `activityKind(typeKey)`, conforme as tabelas das Global Constraints.
    - `companiesForContact(contactId, ctx) → companyId[]`: as empresas dos negócios e leads ligados; vazio vira `[defaultCompanyId]`.
    - `leadCompany(lead, mappings)`: pela primeira etiqueta mapeada; sem etiqueta vira `defaultCompanyId`.
  - Campos monetários do Pipedrive vêm em `field` e `field_currency`; usa o valor numérico.
  - `contract_months` arredonda para inteiro entre 1 e 120.

- [ ] **Step 1: Escrever os testes Vitest.**
  - `channelFor`: `call` dá Ligação; `task` com nome "Whatsapp" dá WhatsApp; `deadline` dá `null` (legado).
  - `activityKind`: `reuniao_realizada` dá `meeting`.
  - `mapDeal`:
    - usa os campos personalizados mapeados para `setup_total`, `mrr` e `contract_months`;
    - funil ignorado dá `{error}`;
    - etapa não mapeada dá `{error}`;
    - status `lost` com `lost_reason` texto o preserva;
    - usuário sem mapeamento cai em `fallbackOwnerId`.
  - `mapActivity`:
    - `reuniao_realizada` concluída recebe `meeting_outcome = 'held'`;
    - sem `deal_id`, `lead_id`, `person_id` e `org_id` dá `{error}`.
  - `companiesForContact`: pessoa ligada a negócios de dois funis de empresas diferentes dá duas empresas.
  - `leadCompany` pela etiqueta.
  - `client.test.ts`, com `fetchImpl` falso:
    - 429 com `Retry-After: 1` e depois 200 dá sucesso, com tempo simulado;
    - 401 dá `PipedriveAuthError`;
    - a paginação segue `next_start`.
- [ ] **Step 2: Rodar `pnpm test src/lib/import`** e ver os testes falharem.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar `pnpm lint && pnpm typecheck && pnpm test`.** Esperado: tudo verde.
- [ ] **Step 5: Commit** com a mensagem `feat(importacao): cliente do Pipedrive e mapeamento`.

### Task 4: Motor de importação por etapas e script de linha de comando

**Files:**
- Create: `src/lib/import/engine.ts` (`server-only`)
- Create: `src/lib/import/engine.test.ts` (cliente falso e gravador falso)
- Create: `scripts/import-pipedrive.ts` (comando `pnpm import:pipedrive <jobId>`)
- Modify: `package.json` (script `import:pipedrive`)

**Interfaces:**
- Consumes: Tasks 2 e 3.
- Produces:
  - Ordem fixa de etapas, gravada em `import_jobs.cursor = {step, start}`: `STEPS = ['users_check','custom_fields','products','organizations','persons','leads','deals','derivatives','activities','notes','done']`.
  - `prepareContext(job, client, admin)`: carrega e guarda em memória, por chamada, os índices necessários. São eles: vínculos negócio→empresa, lead→empresa e contato→empresas, montados a partir de páginas do Pipedrive na primeira chamada e guardados em `cursor.cache` no máximo para ids. Também lê os `external_ids` já gravados.
  - `runImportSlice(jobId, {budgetMs = 40000, deps}) → {status, step, counters, done}`. Processa páginas de 500 até estourar o orçamento. Cada página é mapeada e gravada com `import_upsert` (lotes de 200 linhas). Atualiza `cursor`, `counters` e `status`. Em `PipedriveAuthError` grava `status = 'failed'` com o erro. É idempotente: rodar de novo a partir do mesmo cursor não duplica.
  - Etapa `custom_fields`: para cada mapeamento com alvo `custom`, cria ou reutiliza `custom_field_defs` na empresa de destino (tipos `varchar`, `enum`, `set`, `double` e `monetary` viram text, select, multiselect, number e number). Antes, confira os tipos aceitos no schema da fase 2.
  - Etapa `users_check`: falha cedo se algum usuário mapeado não for membro ativo da empresa de destino. A mensagem lista quem falta.
  - `scripts/import-pipedrive.ts`: lê `.env.local` sem imprimir valores e chama `runImportSlice` em laço até `done` ou `failed`, imprimindo o progresso por etapa.

- [ ] **Step 1: Escrever `engine.test.ts`.** Com cliente falso (2 páginas de pessoas) e gravador falso que registra as chamadas:
  - a primeira fatia com orçamento curto para no meio e grava o cursor;
  - a segunda continua sem repetir a primeira página;
  - `PipedriveAuthError` gera status `failed`;
  - a etapa `users_check` falha com a lista de faltantes;
  - a ordem das etapas é respeitada (pessoas antes de negócios, negócios antes de atividades).
- [ ] **Step 2: Rodar o teste** e ver que falha.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar `pnpm lint && pnpm typecheck && pnpm test`.** Esperado: tudo verde.
- [ ] **Step 5: Commit** com a mensagem `feat(importacao): motor por etapas e script`.

### Task 5: Assistente de importação

**Files:**
- Create: `src/app/(app)/configuracoes/importacao/page.tsx` (lista de jobs e botão "Nova importação")
- Create: `src/app/(app)/configuracoes/importacao/[id]/page.tsx` (passos do assistente e progresso)
- Create: `src/components/import/*`:
  - mapeamento de funis: empresa de destino (existente ou "criar empresa com este nome"), funil (existente ou criar) e etapas (auto por nome, editável);
  - mapeamento de usuários: casado por e-mail quando existir, senão escolha manual;
  - etiquetas de lead para empresa;
  - empresa padrão;
  - campos personalizados: nativo, criar campo ou ignorar. Sugestão automática: "Setup" vai para `native:setup_total`, "MRR contratado" para `native:mrr` e "Prazo (meses)" para `native:contract_months`, por nome sem acento e minúsculo;
  - tela de progresso, que chama a action `continueImport(jobId)` em laço enquanto `!done`, mostra contadores por etapa, tem botão Pausar e mostra o relatório final com erros paginados.
- Create: `src/lib/import/actions.ts`:
  - `createImportJob()`, `saveMappings(jobId, mappings)` e `continueImport(jobId)`, que chama `runImportSlice` com o cliente admin;
  - `pauseImport(jobId)`;
  - todas exigem admin geral.
- Modify: menu de Configurações, que ganha o item "Importação".
- Create: `e2e/helpers/fake-pipedrive.ts` (servidor HTTP local com fixtures pequenas: 2 funis, 4 etapas, 2 usuários, 3 organizações, 4 pessoas, 3 leads com etiquetas, 3 negócios (won, lost, open), 5 atividades e 2 anotações)
- Test: `e2e/import.spec.ts`

**Interfaces:**
- Consumes: Tasks 1 a 4.
- Produces: nada consumido depois.

O E2E precisa de `PIPEDRIVE_BASE_URL` apontando para o servidor falso. Como o servidor de dev já roda em `:3000` com o ambiente dele, o spec sobe um servidor Next temporário em outra porta com `PIPEDRIVE_BASE_URL` e um token falso, ou usa a variável `E2E_BASE_URL` já suportada pelo `playwright.config.ts`. O processo é encerrado por PID no fim.

- [ ] **Step 1: Escrever `e2e/import.spec.ts`.**
  1. O admin abre Configurações e Importação, e cria uma importação.
  2. O assistente lista os 2 funis do servidor falso.
  3. O admin mapeia um funil para uma empresa nova criada no assistente e o outro para uma empresa existente, mapeia os usuários, as etiquetas e os campos (sugestões aceitas), e inicia.
  4. O progresso chega a "Concluída".
  5. O relatório mostra as contagens esperadas da fixture, e 1 erro proposital: uma atividade sem vínculo.
  6. Os registros aparecem nas listas da empresa. O negócio ganho tem a data histórica, e as atividades estão marcadas como legado.
  7. Rodar a mesma importação de novo dá 0 criados e nenhuma duplicata.
  8. Um usuário não admin recebe 404 em `/configuracoes/importacao`.
  9. Token inválido (o servidor falso responde 401) dá uma mensagem clara.
- [ ] **Step 2: Rodar** e ver o teste falhar.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar `pnpm lint && pnpm typecheck && pnpm test`, o spec novo e `e2e/shell.spec.ts`.** Esperado: tudo verde.
- [ ] **Step 5: Commit** com a mensagem `feat(importacao): assistente de importação do Pipedrive`.

### Task 6: Fechamento da fase 3.5

**Files:**
- Modify: `README.md` (módulo Importação: variáveis `PIPEDRIVE_API_TOKEN` e `PIPEDRIVE_BASE_URL`, como rodar pelo assistente e pelo `pnpm import:pipedrive`, regra de reimportação e o que fica como legado)
- Create: `docs/superpowers/followups/2026-10-26-fase-3-5-pendencias.md`
- Modify: `docs/superpowers/followups/2026-10-23-fase-3-pendencias.md` (marcar resolvidas as pendências "Antes da importação")

- [ ] **Step 1: Rodar a suíte completa** com a máquina ociosa: `pnpm lint && pnpm typecheck && pnpm test && pnpm test:db && pnpm build && pnpm test:e2e`. Esperado: tudo verde.
- [ ] **Step 2: Commit** com a mensagem `docs: fechamento da fase 3.5`.

---

## Cobertura da spec (fase 3.5)

| Requisito | Task |
|---|---|
| `import_jobs` e `external_ids` | 1 |
| Assistente (admin geral) usando a API do Pipedrive | 3, 5 |
| Funil para empresa e funil; usuários; campos personalizados | 3, 4, 5 |
| Organizações, pessoas, leads, negócios (etapa, status, valor, datas), atividades, anotações e produtos | 2, 3, 4 |
| Atividades com canal deduzido ou "Não informado", marcadas como legado | 2, 3 |
| Reimportável sem duplicar; relatório final com contagens e erros | 1, 2, 4, 5 |
| Pendências da fase 3 (desvio para datas históricas, leads convertidos, sem timeline falsa) | 1, 2 |
