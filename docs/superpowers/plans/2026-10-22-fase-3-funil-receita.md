# Fase 3: Funis, kanban, produtos e receita, plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Colocar o pipeline para operar: funis e etapas configuráveis, kanban com arrastar e soltar animado e campos obrigatórios por etapa, negócios com produtos e condições de contrato (Setup e MRR), cronograma de receita mês a mês, visões de lista e forecast, e conversão de lead em negócio.

**Architecture:** Novas tabelas multiempresa (`pipelines`, `stages`, `lost_reasons`, `products`, `deals`, `deal_items`, `deal_stage_history`, `deal_revenue_schedule`) seguindo o padrão da fase 2: RLS com `can_access(..., 'deals', ...)`, filhos herdando do pai, guardas em trigger. O banco calcula totais de itens, o cronograma de receita, o histórico de etapas e valida os campos obrigatórios ao mudar de etapa; a interface só repete as validações para dar boa experiência. O kanban usa dnd-kit para o arrastar e Framer Motion para as animações, com movimento otimista revertido quando o banco recusa.

**Tech Stack:** o mesmo das fases 1 e 2, mais `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities` e `motion` (Framer Motion).

**Spec:** `docs/superpowers/specs/2026-10-21-oxyn-crm-design.md` (seções 4.3 e 6, fase 3; conversão de lead adiada da fase 2)

## Global Constraints

- Tudo das Global Constraints das fases 1 e 2 continua valendo (regras no banco, cores teal sem laranja/âmbar, Montserrat/Inter, PT-BR sem emoji e sem travessão, service role só em `server-only`, listas paginadas no servidor com estado na URL, datas `dd/mm/aaaa`, BRL).
- Ambiente sem Docker: `pnpm db:migrate` e `pnpm test:db` no projeto de dev; fixtures com UUIDs fixos e prefixo `tst-`; E2E com sufixo único e limpeza no `afterAll`.
- Migrations das fases 1 e 2 congeladas: esta fase cria arquivos a partir de `20261023000001`. Mudanças em funções antigas entram por `create or replace` nos arquivos novos.
- Entidade usada em `can_access`: `deals` (já existe na visibilidade dos papéis).
- Valores monetários `numeric(14,2)`; meses de contrato guardados como o primeiro dia do mês (`date` com dia 1).
- Reutilizar o kit e os helpers existentes (`DataTable`, `RecordHeader`, `RecordTabs`, `NoteComposer`, `Timeline`, `fail`, `safeTerm`, `checkCustomFields`, `exportInBatches`, `recordHref`, `ExportLink`, `CompanyPicker`, `getEntityPermissions`). Nada de cópias.
- Animações respeitam `prefers-reduced-motion` (sem inclinação nem tremor; só transição de opacidade).

## Ajustes em relação à spec

- **Valor estimado no negócio.** `deals.estimated_value` (opcional) guarda o valor antes de existir contrato. O card e as somas usam `contract_value` quando é maior que zero e, senão, `estimated_value`. Na conversão, o valor estimado do lead vira o valor estimado do negócio.
- **Indicador de próxima atividade** no card fica para a fase 4 (atividades ainda não existem). A regra de próxima atividade do funil já é configurável e será aplicada na fase 4.
- **Filtro "atividades atrasadas"** também fica para a fase 4. Os demais filtros (funil, responsável, equipe, etiqueta) entram agora, mais o filtro "esfriando".
- **Kanban é por empresa.** Na visão "Todas as empresas", Negócios abre a lista (com coluna Empresa); o botão do kanban pede a empresa primeiro.
- **Trava de status do lead no banco** (pendência da fase 2) entra aqui, junto com a conversão.
- **Filtro por etiqueta escalável** (pendência da fase 2): passa a usar funções no banco em vez de listas de ids na URL, para leads, pessoas, organizações e negócios. Precisa estar pronto antes da importação do Pipedrive.

## Review Focus

1. Dois usuários movem o mesmo card ao mesmo tempo, ou o card é movido por outro enquanto o primeiro arrasta: a posição final é consistente e a tela se atualiza sem duplicar o card. Teste na Task 6.
2. Mudar o tipo de um produto (setup para recorrente) ou desativá-lo depois de usado em negócios: os itens existentes mantêm o tipo e o preço com que foram adicionados; o produto inativo não aparece para novos itens. Teste na Task 4.
3. Editar as condições de contrato de um negócio ganho: o cronograma é recalculado; os relatórios futuros leem sempre o cronograma atual. Excluir (lixeira) um negócio tira o cronograma das somas. Teste na Task 3.
4. Etapa com campo obrigatório que é um campo personalizado arquivado: o campo arquivado não bloqueia a mudança de etapa (só campos ativos contam). Teste na Task 3.
5. Funil com negócios não pode ser excluído (só arquivado); etapa com negócios não pode ser excluída sem mover os negócios antes. Teste na Task 4.

---

## Estrutura de arquivos

```
supabase/migrations/
  20261023000001_deals_schema.sql       # tabelas, checks, índices, seeds de funil/motivos
  20261023000002_deals_security.sql     # RLS, extensão das funções genéricas para 'deals'
  20261023000003_deals_functions.sql    # itens, cronograma, obrigatórios, histórico, linha do tempo, conversão, trava de lead, filtros por etiqueta
supabase/tests/
  11_deals_schema.test.sql  12_deals_security.test.sql  13_deals_functions.test.sql
src/lib/deals/
  schema.ts       # dealSchema, contractSchema, dealItemSchema, lostSchema
  revenue.ts      # buildRevenueSchedule (espelho do banco), contractValue
  kanban.ts       # positionBetween, cardValue, isRotting, groupByStage
  forecast.ts     # forecastBuckets
  required.ts     # REQUIRED_FIELD_OPTIONS, requiredFieldLabel, parseMissingFields
  queries.ts  actions.ts  export.ts
src/lib/pipelines/ actions.ts queries.ts schema.ts
src/lib/products/ actions.ts schema.ts
src/components/deals/
  kanban-board.tsx kanban-column.tsx deal-card.tsx drop-zones.tsx
  required-fields-dialog.tsx lost-dialog.tsx
  deal-form.tsx deal-items.tsx contract-form.tsx revenue-table.tsx stage-bar.tsx
  deals-toolbar.tsx forecast-view.tsx deal-columns.tsx create-deal-dialog.tsx
src/components/leads/convert-lead-dialog.tsx
src/app/(app)/[empresa]/negocios/page.tsx            # kanban (padrão), ?visao=lista|forecast
src/app/(app)/[empresa]/negocios/[id]/page.tsx
src/app/(app)/configuracoes/{funis,produtos,motivos-perda}/page.tsx
e2e/
  pipelines-settings.spec.ts kanban.spec.ts deals.spec.ts forecast.spec.ts
  lead-conversion.spec.ts phase3-smoke.spec.ts
```

---

### Task 1: Schema de negócios

**Files:**
- Create: `supabase/migrations/20261023000001_deals_schema.sql`
- Test: `supabase/tests/11_deals_schema.test.sql`

**Interfaces:**
- Produces (todas em `public`, RLS ligado e sem políticas nesta task; anon revogado; `truncate, references, trigger` revogados de authenticated):
  - `pipelines`: `id`, `company_id → companies cascade`, `name` (1 a 80), `position int not null default 0`, `next_activity_rule text not null default 'off'` (check em `off`, `suggest`, `require`), `card_value_field text not null default 'total'` (check em `total`, `mrr`, `setup`), `archived_at`, `created_at`, `updated_at`, `unique(company_id, name)`.
  - `stages`: `id`, `pipeline_id → pipelines cascade`, `company_id` (igual ao do funil, garantido por trigger), `name` (1 a 60), `position int not null`, `probability int not null default 0` (0 a 100), `rotting_days int` (null ou ≥ 1), `required_fields text[] not null default '{}'`, `archived_at`, `created_at`, `updated_at`, `unique(pipeline_id, name)`. Cada item de `required_fields` é uma chave padrão (`expected_close_date`, `person_id`, `organization_id`, `estimated_value`, `contract`, `products`) ou `cf:<key>` (check com regex `^(expected_close_date|person_id|organization_id|estimated_value|contract|products|cf:[a-z][a-z0-9_]{0,39})$` em cada elemento via função imutável).
  - `lost_reasons`: igual a `disqualification_reasons` (id, company_id, name 1 a 80, position, active, unique).
  - `products`: `id`, `company_id`, `name` (1 a 120), `kind text not null` (check em `setup`, `recurring`), `default_price numeric(14,2) not null default 0` (≥ 0), `active bool not null default true`, `created_at`, `updated_at`, `unique(company_id, name)`.
  - `deals`: colunas comuns da fase 2 (`company_id`, `owner_id`, `created_by default auth.uid()`, `created_at`, `updated_at`, `deleted_at`, `custom_fields jsonb object`), mais `title` (1 a 200), `pipeline_id → pipelines restrict`, `stage_id → stages restrict`, `status` (`open`, `won`, `lost`, padrão `open`), `lost_reason_id → lost_reasons restrict`, `lost_note text` (até 1.000), `person_id → persons set null`, `organization_id → organizations set null`, `lead_id → leads set null`, `estimated_value numeric(14,2)` (≥ 0), `expected_close_date date`, `stage_entered_at timestamptz not null default now()`, `won_at`, `lost_at`, `position numeric not null default 0`, `setup_total numeric(14,2) not null default 0` (≥ 0), `setup_installments int not null default 1` (≥ 1, ≤ 60), `setup_first_due date`, `mrr numeric(14,2) not null default 0` (≥ 0), `mrr_start date`, `contract_months int` (1 a 120), `contract_value numeric(16,2) generated always as (setup_total + mrr * coalesce(contract_months, 0)) stored`.
  - Checks em `deals`: `mrr = 0 or (mrr_start is not null and contract_months is not null)`; `setup_total = 0 or setup_first_due is not null`; `setup_first_due is null or extract(day from setup_first_due) = 1`; mesmo para `mrr_start`; `status <> 'lost' or lost_reason_id is not null`.
  - `deal_items`: `id`, `deal_id → deals cascade`, `company_id`, `product_id → products restrict`, `kind text not null` (copiado do produto no insert e imutável), `quantity numeric(10,2) not null` (> 0), `unit_price numeric(14,2) not null` (≥ 0), `discount numeric(14,2) not null default 0` (≥ 0), `total numeric(16,2) generated always as (quantity * unit_price - discount) stored` com check `quantity * unit_price - discount >= 0`, `position int not null default 0`, `created_at`.
  - `deal_stage_history`: `id bigint identity pk`, `deal_id → deals cascade`, `company_id`, `from_stage_id uuid`, `to_stage_id uuid not null`, `moved_by uuid`, `moved_at timestamptz not null default now()`, `seconds_in_previous int`.
  - `deal_revenue_schedule`: `deal_id → deals cascade`, `company_id`, `month date not null` (dia 1), `setup numeric(14,2) not null default 0`, `mrr numeric(14,2) not null default 0`, `primary key(deal_id, month)`.
  - `leads.converted_deal_id` ganha FK `→ deals on delete set null`.
  - Checks polimórficos ampliados para aceitar `deals`: `record_labels.entity`, `notes.entity`, `timeline_events.entity`. `timeline_events.kind` ganha `stage_changed` e `converted`.
  - `guard_same_company` (create or replace) passa a cobrir `deals` (pipeline, stage, lost_reason, person, organization, lead), `stages` (pipeline), `deal_items` (deal e produto) e as tabelas polimórficas com `entity = 'deals'`.
  - Índices: `deals(company_id, pipeline_id, stage_id, position) where deleted_at is null`, `deals(company_id, owner_id)`, `deals(company_id, expected_close_date)`, GIN trigram em `lower(title)`, `deal_items(deal_id)`, `deal_stage_history(deal_id, moved_at)`, `deal_revenue_schedule(company_id, month)`.
  - Seeds (função `seed_company_pipeline(company uuid)` idempotente, chamada no trigger de nova empresa e em backfill): funil "Funil de vendas" com etapas Qualificação (10%), Reunião (25%), Proposta (50%), Negociação (75%), Fechamento (90%); motivos de perda Preço, Concorrente, Sem orçamento, Sem resposta, Timing, Outro.

- [ ] **Step 1: Teste pgTAP que falha** (`11_deals_schema.test.sql`):
  - `has_table` para as 8 tabelas.
  - `throws_ok` 23514: MRR > 0 sem `mrr_start`; setup > 0 sem `setup_first_due`; `mrr_start = '2026-05-15'`; `lost` sem motivo; `required_fields = '{foo}'`; `probability = 120`; item com desconto maior que o subtotal.
  - `is(contract_value, 90000)` para setup 30.000 + MRR 5.000 × 12.
  - `throws_ok` `OXYN_CROSS_COMPANY`: negócio de `tst-volt` com etapa de funil de `tst-naia`; item com produto de outra empresa.
  - Empresa nova recebe 1 funil, 5 etapas com as probabilidades acima e 6 motivos de perda.
  - `record_labels` aceita `entity = 'deals'`; `timeline_events.kind = 'stage_changed'` aceito.
  - Privilégios: `TRUNCATE` falso para authenticated nas 8 tabelas.
- [ ] **Step 2:** `pnpm test:db` → FAIL em 11. **Step 3:** migration + `pnpm db:migrate`. **Step 4:** PASS 01 a 11. **Step 5:** commit `feat(db): schema de funis, negócios, produtos e receita`.

---

### Task 2: Segurança de negócios

**Files:**
- Create: `supabase/migrations/20261023000002_deals_security.sql`
- Test: `supabase/tests/12_deals_security.test.sql`

**Interfaces:**
- Consumes: helpers da fase 2 (`can_access`, `record_ref`, `can_read_record`, `can_edit_record`, `owner_has_membership`, `has_company_action`, `validate_custom_fields`, `reassign_record`, `purge_records_internal`, `purge_record`, `guard_record_update`).
- Produces:
  - Políticas de `deals` idênticas às de `leads` trocando a entidade para `deals` (select com regra de lixeira, insert com `created_by = auth.uid()`, `deleted_at is null`, responsável membro e reassign; update com edit ou delete na lixeira; delete só admin geral).
  - `create or replace` de `record_ref`, `reassign_record`, `purge_records_internal`, `purge_record` e da whitelist de entidades das demais funções para incluir `deals`. `guard_record_update`, `validate_custom_fields_trg` e as guardas de `created_by/created_at` ligadas em `deals`.
  - `can_manage_pipelines(p_company uuid) returns boolean` (admin geral ou `settings.manage_pipelines`), `can_manage_products(p_company uuid)` (admin geral ou `settings.manage_products`), `security definer`, execute só para authenticated.
  - Políticas: `pipelines`, `stages`, `lost_reasons`: select `has_company_access(company_id)`, escrita `can_manage_pipelines(company_id)`; `products`: select `has_company_access`, escrita `can_manage_products`; `deal_items` e `deal_revenue_schedule` e `deal_stage_history`: select `can_read_record('deals', deal_id)`; `deal_items` insert/update/delete `can_edit_record('deals', deal_id)`; `deal_revenue_schedule` e `deal_stage_history` sem escrita para authenticated (só triggers `security definer`).
  - Funil não pode ser excluído se tiver negócios (FK `restrict` já garante; erro traduzido) e etapa idem.
- [ ] **Step 1: Teste pgTAP que falha** (fixture como na fase 2: `ana` equipe, `bruno` padrão, `caio` gestor com `manage_pipelines` e `manage_products`, `dani` sem acesso): visibilidade de negócios por papel; `bruno` não reatribui; `caio` reatribui via `reassign_record('deals', …)`; lixeira; `bruno` não cria funil nem produto; `caio` cria; itens e cronograma visíveis só para quem lê o negócio; `bruno` não insere em `deal_revenue_schedule`; `delete` de funil com negócio → 23503.
- [ ] **Step 2 a 5:** falhar, implementar, passar (01 a 12), commit `feat(db): RLS e guardas de negócios`.

---

### Task 3: Regras de negócio no banco

**Files:**
- Create: `supabase/migrations/20261023000003_deals_functions.sql`
- Test: `supabase/tests/13_deals_functions.test.sql`

**Interfaces:**
- Produces:
  - **Itens e totais:** trigger em `deal_items` (after insert/update/delete) recalcula `deals.setup_total` e `deals.mrr` como a soma de `total` por `kind` quando o negócio tem ao menos um item. Com itens, editar `setup_total` ou `mrr` diretamente levanta `OXYN_TOTALS_FROM_ITEMS`. O `kind` do item é copiado do produto no insert e não muda depois (`OXYN_FORBIDDEN_FIELD`); produto inativo não pode ser usado em item novo (`OXYN_PRODUCT_INACTIVE`).
  - **Cronograma:** trigger em `deals` (after insert/update das colunas de contrato e de `deleted_at`) regenera `deal_revenue_schedule`: apaga as linhas do negócio e, se ele não estiver na lixeira, insere setup em `setup_installments` parcelas mensais a partir de `setup_first_due` (cada parcela `trunc(setup_total / n, 2)`, resto na última) e MRR de `mrr_start` por `contract_months` meses, somando setup e MRR no mesmo mês. Algoritmo exposto como `build_revenue_schedule(p_setup numeric, p_installments int, p_setup_first date, p_mrr numeric, p_mrr_start date, p_months int) returns table(month date, setup numeric, mrr numeric)` (immutable) para teste e para o espelho em TypeScript.
  - **Campos obrigatórios:** trigger before insert/update de `stage_id` em `deals`: para a etapa de destino, verifica cada item de `required_fields`: `expected_close_date`, `person_id`, `organization_id`, `estimated_value` não nulos; `contract` = (`setup_total > 0` com `setup_first_due`) ou (`mrr > 0` com `mrr_start` e `contract_months`); `products` = existe item; `cf:<key>` = `custom_fields->key` não nulo, **só se o campo personalizado estiver ativo** (arquivado não bloqueia). Faltando algo: `raise exception 'OXYN_REQUIRED_FIELDS' using detail = <chaves separadas por vírgula, na ordem da etapa>`.
  - **Etapa e histórico:** before update de `stage_id`: `stage_entered_at = now()`, etapa precisa ser do mesmo funil (mudança de funil exige `pipeline_id` e `stage_id` juntos e coerentes); after: insere `deal_stage_history` com `seconds_in_previous`. Insert também registra a etapa inicial (`from_stage_id` nulo).
  - **Status:** `won` define `won_at`, limpa `lost_*`; `lost` define `lost_at`; `open` (reabrir) limpa `won_at`, `lost_at`, motivo e nota.
  - **Linha do tempo de negócios** (estende os triggers da fase 2): `created`, `updated` (sem `updated_at`, `deleted_at`, `position`, `stage_entered_at`, totais recalculados), `owner_changed`, `status_changed` (`won`/`lost` com `reason_id`, `open`), `stage_changed` (`{from, to}`), `trashed`, `restored`.
  - **Conversão:** `convert_lead(p_lead uuid, p_pipeline uuid, p_stage uuid, p_title text default null) returns uuid` (`security definer`): exige que o chamador possa editar o lead e criar negócios na empresa; o lead precisa estar `open` e fora da lixeira; cria o negócio (título do lead ou `p_title`, mesmo responsável, pessoa, organização, `estimated_value` do lead, `lead_id`), copia as etiquetas, marca o lead `converted` com `converted_deal_id` e `converted_at`, grava `converted` na linha do tempo do lead e `created` no negócio. Respeita os campos obrigatórios da etapa escolhida (pode levantar `OXYN_REQUIRED_FIELDS`).
  - **Trava de status do lead:** trigger before update de `leads.status`: transições permitidas `open → disqualified | archived`, `disqualified | archived → open`, `open → converted` só dentro de `convert_lead` (flag de sessão `set_config('oxyn.converting', 'on', true)`); qualquer outra → `OXYN_INVALID_TRANSITION`.
  - **Filtros por etiqueta escaláveis:** funções `security invoker` `organizations_with_labels(p_label_ids uuid[])`, `persons_with_labels`, `leads_with_labels`, `deals_with_labels` `returns setof <tabela>` (registros com todas as etiquetas pedidas), para encadear filtros, ordenação e paginação pelo PostgREST (`supabase.rpc(...).select().eq().order().range()`).
  - **Busca e lixeira:** `global_search` inclui negócios (título; subtítulo com a etapa); `purge_trash` inclui negócios.
- [ ] **Step 1: Teste pgTAP que falha:**
  - `build_revenue_schedule(30000, 3, '2026-03-01', 5000, '2026-04-01', 12)` → março 10.000/0; abril e maio 10.000/5.000; junho a março de 2027 0/5.000 (13 linhas). `build_revenue_schedule(100, 3, …)` → 33,33; 33,33; 33,34.
  - Atualizar condições regenera o cronograma; mover para a lixeira zera; restaurar recria. (Review Focus 3.)
  - Item recorrente de 2 × 2.500 → `mrr = 5000`; editar `mrr` à mão com item → `OXYN_TOTALS_FROM_ITEMS`; mudar `kind` do item → `OXYN_FORBIDDEN_FIELD`; mudar o `kind` do produto não muda itens existentes. (Review Focus 2.)
  - Etapa com `{expected_close_date, contract, cf:porte}`: mover sem nada → `OXYN_REQUIRED_FIELDS` com detail `expected_close_date,contract,cf:porte`; arquivar `porte` e preencher o resto → move. (Review Focus 4.)
  - Histórico: duas mudanças geram 3 linhas (inicial + 2) e `stage_entered_at` muda.
  - `convert_lead`: cria negócio com pessoa, organização, valor e etiquetas; lead vira `converted`; segunda conversão falha; usuário sem `create` → erro.
  - Trava: `update leads set status = 'converted'` direto → `OXYN_INVALID_TRANSITION`; `archived → disqualified` → erro.
  - `deals_with_labels(array[l1, l2])` só devolve negócios com as duas etiquetas e respeita o RLS.
  - `global_search` encontra negócio pelo título.
- [ ] **Step 2 a 5:** falhar, implementar, passar (01 a 13), commit `feat(db): itens, cronograma, obrigatórios, histórico e conversão`.

---

### Task 4: Configurações de funis, produtos e motivos de perda

**Files:**
- Create: `src/lib/pipelines/{schema,actions,queries}.ts`, `src/lib/products/{schema,actions}.ts`, `src/app/(app)/configuracoes/{funis,produtos,motivos-perda}/page.tsx`, componentes em `src/components/settings/`
- Modify: navegação de configurações; `CUSTOM_FIELD_ENTITIES_PHASE2` passa a incluir `deals` (aba "Negócios" em Campos); ações de listas aceitam `kind: "lost_reason"`
- Test: `src/lib/pipelines/schema.test.ts`, `src/lib/products/schema.test.ts`, `e2e/pipelines-settings.spec.ts`

**Interfaces:**
- `pipelineSchema` (nome 1 a 80, `nextActivityRule`, `cardValueField`), `stageSchema` (nome 1 a 60, probabilidade 0 a 100 inteira, `rottingDays` vazio ou 1 a 365, `requiredFields` dentre `REQUIRED_FIELD_OPTIONS` + `cf:<key>` de campos ativos de negócios), `productSchema` (nome 1 a 120, `kind`, preço com o mesmo parser BRL dos leads).
- Actions (requireSuperAdmin + cliente de sessão + `ActionResult`): `createPipeline`, `updatePipeline`, `setPipelineArchived`, `createStage`, `updateStage`, `reorderStages(pipelineId, stageIds[])`, `deleteStage(id)` (bloqueado com negócios: "Mova os negócios desta etapa antes de excluí-la."), `createProduct`, `updateProduct` (tipo editável só enquanto não houver itens; senão "O tipo não pode mudar depois de usado em negócios."), `setProductActive`.
- Telas: **Funis**: seletor de empresa (`?empresa=`), lista de funis com "Arquivar"; editor com nome, regra de próxima atividade ("Desligada", "Sugerir", "Obrigar"), campo do card ("Valor total", "MRR", "Setup") e etapas arrastáveis (dnd-kit sortable) com nome, probabilidade, dias para esfriar e campos obrigatórios (multisseleção com rótulos de `requiredFieldLabel`). **Produtos**: tabela com nome, tipo ("Setup" ou "Recorrente"), preço padrão, status. **Motivos de perda**: igual a Motivos de desqualificação.
- [ ] **Step 1: Unitários que falham** — `stageSchema` rejeita probabilidade 101 e `cf:Inexistente`; `productSchema` aceita "1.500,00".
- [ ] **Step 2 a 4:** falhar, implementar, passar.
- [ ] **Step 5: E2E** — criar funil com 3 etapas e reordenar arrastando (ordem persiste); marcar `Data de fechamento esperada` como obrigatória numa etapa; excluir etapa com negócio mostra a mensagem (Review Focus 5); arquivar funil com negócios funciona e ele some do seletor do kanban; produto: criar, desativar (some do seletor de itens), tentar mudar o tipo de produto usado → mensagem (Review Focus 2).
- [ ] **Step 6: Commit** — `feat(config): funis, etapas, produtos e motivos de perda`.

---

### Task 5: Domínio de negócios (lib)

**Files:**
- Create: `src/lib/deals/{schema,revenue,kanban,forecast,required,queries,actions,export}.ts`
- Modify: `src/lib/records/types.ts` (`RecordEntity` inclui `deals`; `ENTITY_PATHS.deals = "negocios"`), `src/lib/records/export.ts` (registrar negócios), `src/lib/db-errors.ts` (novos códigos)
- Test: `src/lib/deals/{schema,revenue,kanban,forecast,required}.test.ts`

**Interfaces:**
- `dealSchema` (título, pessoa, organização, valor estimado BRL, data de fechamento, responsável, campos personalizados), `contractSchema` (setup total, parcelas 1 a 60, mês da 1ª parcela `YYYY-MM`, MRR, mês de início `YYYY-MM`, meses 1 a 120; mesmas regras de obrigatoriedade do banco, com as mensagens "Informe o mês da primeira parcela.", "Informe o mês de início e a duração do contrato."), `dealItemSchema` (produto, quantidade > 0, preço, desconto ≤ subtotal), `lostSchema` (motivo obrigatório "Escolha um motivo.", nota até 1.000).
- `buildRevenueSchedule(input): { month: string; setup: number; mrr: number }[]` — espelho exato de `build_revenue_schedule` (mesmos casos de teste); `contractValue(input): number`.
- `positionBetween(before: number | null, after: number | null): number` (meio; extremos ±1.024); `cardValue(deal, field: "total" | "mrr" | "setup"): number` (total usa `contract_value` se > 0, senão `estimated_value ?? 0`); `isRotting(deal, stage, now): boolean`; `groupByStage(deals, stages)`.
- `forecastBuckets(deals, now, months = 6)`: colunas "Atrasados" (data < mês atual, aberto), um bucket por mês a partir do atual, "Sem data"; cada bucket com quantidade, soma e soma ponderada pela probabilidade da etapa.
- `REQUIRED_FIELD_OPTIONS` e `requiredFieldLabel(key, customDefs)` ("Data de fechamento esperada", "Pessoa", "Organização", "Valor estimado", "Condições de contrato", "Produtos", e o rótulo do campo personalizado); `parseMissingFields(errorDetail: string): string[]`.
- Queries: `listDeals(scope, query)` (lista paginada; filtros funil, etapa, status, responsável, equipe, etiqueta via `deals_with_labels`, esfriando), `getBoard(companyId, pipelineId, filters)` (todas as etapas não arquivadas e negócios abertos do funil, sem paginação, até 500 por etapa com aviso), `getDeal(id)`, `getForecast(companyId, pipelineId, filters)`.
- Actions: `createDeal`, `updateDeal`, `moveDeal(id, stageId, position)` (devolve `{ ok: false, missing: string[] }` em `OXYN_REQUIRED_FIELDS`), `markWon(id)`, `markLost(id, input)`, `reopenDeal(id)`, `updateContract(id, input)`, `addDealItem`, `updateDealItem`, `removeDealItem`, `convertLead(leadId, { pipelineId, stageId, title })` (RPC `convert_lead`).
- Novas mensagens em `translateDbError`: `OXYN_REQUIRED_FIELDS` → "Preencha os campos obrigatórios desta etapa."; `OXYN_TOTALS_FROM_ITEMS` → "Com produtos no negócio, os totais vêm dos itens."; `OXYN_PRODUCT_INACTIVE` → "Este produto está inativo."; `OXYN_INVALID_TRANSITION` → "Essa mudança de status não é permitida.".
- [ ] **Step 1: Unitários que falham** — os casos de cronograma da Task 3 (mesmos números); `positionBetween(1, 2) = 1.5`, `(null, 1) = -1023`, `(5, null) = 1029`; `cardValue` com contrato e só com estimado; `isRotting` com 10 dias e `rotting_days = 7` → true, ganho → false; `forecastBuckets` com datas em meses diferentes, atrasado e sem data; `parseMissingFields("expected_close_date,cf:porte")`.
- [ ] **Step 2 a 4:** falhar, implementar, passar. **Step 5:** commit `feat(negocios): domínio, consultas e ações`.

---

### Task 6: Kanban

**Files:**
- Create: `src/components/deals/{kanban-board,kanban-column,deal-card,drop-zones,required-fields-dialog,lost-dialog,deals-toolbar,create-deal-dialog}.tsx`, `src/app/(app)/[empresa]/negocios/page.tsx`
- Modify: `src/lib/nav.ts` (`CURRENT_PHASE = 3`), `src/lib/nav.test.ts`, `e2e/shell.spec.ts` (item desabilitado de exemplo passa a ser "Atividades")
- Test: `e2e/kanban.spec.ts`

**Comportamento:**
- `pnpm add @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities motion`.
- Barra: seletor de funil (padrão: o primeiro não arquivado; `?funil=`), alternância Kanban / Lista / Forecast (`?visao=`), filtros (responsável, equipe, etiqueta, "Esfriando"), "Novo negócio".
- Coluna: nome da etapa, probabilidade discreta, quantidade e soma (formato BRL compacto, ex.: "R$ 125 mil") do campo do card do funil; lista vertical de cards ordenada por `position`.
- Card: título, organização, valor (`cardValue`), avatar do responsável, selo "Esfriando" (vermelho neutro) quando `isRotting`, etiquetas (até 2 chips + "+N"). Clique abre o detalhe.
- Arrastar (dnd-kit, sensor de ponteiro com distância de 6 px e de teclado para acessibilidade):
  - o card levanta (sombra maior, escala 1,02, rotação 2°) num `DragOverlay`; colunas abrem espaço com `layout` animado do Framer Motion; ao soltar, o card encaixa com transição de mola curta;
  - movimento otimista: a tela muda na hora e chama `moveDeal` com `positionBetween` dos vizinhos;
  - recusa por campos obrigatórios: o card volta à coluna de origem com animação de tremor (x: 0, -6, 6, -4, 4, 0 em 300 ms) e abre o `RequiredFieldsDialog` com só os campos que faltam (inputs reais: data, pessoa, organização, valor estimado, condições de contrato resumidas, link "Adicionar produtos" que abre o detalhe, e campos personalizados). Salvar grava os campos e repete o movimento;
  - outra recusa (permissão, conexão): volta à origem e mostra toast com a mensagem traduzida.
- Rodapé durante o arraste: três zonas "Ganho", "Perdido", "Excluir". Ganho → `markWon`; Perdido → `LostDialog` (motivo obrigatório + nota); Excluir → lixeira com toast "Negócio movido para a lixeira.".
- Atualização: depois de cada ação, `router.refresh()`; um intervalo de 30 s com a aba visível também atualiza o quadro (evita cards desatualizados quando outra pessoa mexe). Conflito de posição: o quadro sempre renderiza a ordem que vier do servidor após o refresh. (Review Focus 1.)
- Visão "Todas as empresas": Negócios abre a lista; o botão Kanban pede a empresa (`CompanyPicker` com empresas acessíveis).
- `prefers-reduced-motion`: sem rotação, escala e tremor.
- [ ] **Step 1: E2E que falha** (`e2e/kanban.spec.ts`, empresa e funil próprios via service role; arrastar com `page.mouse` em passos):
  - `"arrastar para outra etapa persiste a etapa e a ordem"` (recarregar mantém).
  - `"campo obrigatório faltando abre o modal e completa o movimento"`.
  - `"soltar em Perdido exige motivo"` e `"soltar em Ganho marca ganho e tira do quadro"`.
  - `"soltar em Excluir manda para a lixeira"`.
  - `"usuário padrão só vê os próprios cards"`.
  - `"card movido por outra pessoa aparece na nova etapa após atualizar"` (move via service role, espera o refresh periódico ou recarrega, confere que não duplica). (Review Focus 1.)
  - `"soma da coluna usa o campo do card do funil"` (funil com `mrr`).
  - `"selo esfriando"` (negócio com `stage_entered_at` antigo via service role).
- [ ] **Step 2 a 4:** falhar, implementar, passar. **Step 5:** commit `feat(negocios): kanban com arrastar e soltar`.

---

### Task 7: Lista e forecast

**Files:**
- Create: `src/components/deals/{deal-columns,forecast-view}.tsx`
- Modify: `src/app/(app)/[empresa]/negocios/page.tsx` (`?visao=lista|forecast`)
- Test: `e2e/forecast.spec.ts`

**Comportamento:**
- **Lista:** `DataTable` com título, organização, pessoa, etapa, status ("Aberto", "Ganho", "Perdido"), valor (total), MRR, Setup, data de fechamento, responsável, etiquetas, idade, criado em (Empresa na visão "Todas"); abas de status (Abertos padrão, Ganhos, Perdidos); exportação CSV com as mesmas colunas.
- **Forecast:** colunas de `forecastBuckets` (Atrasados, 6 meses a partir do atual, Sem data), cada uma com quantidade, soma e, com o interruptor "Ponderar pela probabilidade", a soma ponderada; cards iguais aos do kanban (sem arrastar entre colunas nesta fase); só negócios abertos do funil selecionado.
- [ ] **Step 1: E2E que falha:** `"lista filtra por etapa e exporta"`, `"forecast agrupa por mês e pondera pela probabilidade"` (três negócios em meses distintos via service role; conferir somas com e sem ponderação), `"negócio sem data aparece em Sem data e atrasado em Atrasados"`.
- [ ] **Step 2 a 4:** falhar, implementar, passar. **Step 5:** commit `feat(negocios): lista e forecast`.

---

### Task 8: Detalhe do negócio

**Files:**
- Create: `src/app/(app)/[empresa]/negocios/[id]/page.tsx`, `src/components/deals/{deal-form,deal-items,contract-form,revenue-table,stage-bar}.tsx`
- Test: `e2e/deals.spec.ts`

**Comportamento:**
- `RecordHeader` (entidade `deals`) com ações: status, "Ganho", "Perdido" (`LostDialog`), "Reabrir" quando ganho ou perdido.
- **Barra de etapas** clicável (estilo Pipedrive, segmentos com a etapa atual em teal e as anteriores em teal claro): clicar numa etapa chama `moveDeal`; faltando campos abre o `RequiredFieldsDialog`. Mostra "Há N dias nesta etapa".
- Coluna esquerda: dados (título, pessoa, organização, valor estimado, data de fechamento, campos personalizados ativos), **Produtos** (tabela de itens com produto ativo, quantidade, preço, desconto e total; adicionar/editar/remover; totais Setup e MRR), **Contrato** (setup total, parcelas, mês da 1ª parcela, MRR, mês de início, duração; com itens, os totais aparecem somente leitura com "Calculado a partir dos produtos"; "Valor total do contrato" calculado), **Cronograma** (tabela mês a mês: Setup, MRR, Total, com linha de totais; vazio: "Defina as condições do contrato para ver o cronograma.").
- Centro: `RecordTabs` com `NoteComposer` e `Timeline` (`getTimeline("deals", id)`), incluindo eventos de etapa ("Moveu de Proposta para Negociação") e de status ("Marcou como ganho", "Marcou como perdido (Preço)", "Reabriu o negócio").
- Prévia do cronograma no formulário de contrato usa `buildRevenueSchedule` antes de salvar.
- 404 idêntico para inexistente, sem acesso e slug errado.
- [ ] **Step 1: E2E que falha:** `"contrato gera o cronograma mês a mês"` (30 mil em 3x a partir de março + 5 mil × 12 a partir de abril; conferir as linhas de março, abril e junho e o total 90.000); `"com produtos os totais vêm dos itens"`; `"barra de etapas move e pede campos obrigatórios"`; `"marcar perdido exige motivo e reabrir volta para aberto"`; `"editar contrato de negócio ganho recalcula o cronograma"` (Review Focus 3); `"404 igual"`.
- [ ] **Step 2 a 4:** falhar, implementar, passar. **Step 5:** commit `feat(negocios): detalhe com produtos, contrato e cronograma`.

---

### Task 9: Conversão de lead, integrações e filtro por etiqueta

**Files:**
- Create: `src/components/leads/convert-lead-dialog.tsx`
- Modify: `src/components/leads/*` (botão "Converter em negócio" ativo), `src/lib/search/actions.ts` e `src/components/shell/command-palette.tsx` (grupo "Negócios"), `src/app/(app)/[empresa]/lixeira/page.tsx` (aba Negócios), `src/lib/{organizations,persons,leads}/queries.ts` (filtro por etiqueta via `*_with_labels`), `src/lib/records/list-helpers.ts` (remover `idsByLabels` se ficar sem uso)
- Test: `e2e/lead-conversion.spec.ts`, ajustes nos specs existentes de filtro por etiqueta

**Comportamento:**
- Converter: dialog com funil (padrão o primeiro), etapa (padrão a primeira) e título (padrão o do lead). Falta de campo obrigatório na etapa escolhida mostra a lista do que falta com a sugestão de escolher outra etapa. Sucesso leva ao negócio criado; o lead mostra "Convertido em <link do negócio>".
- Leads com status `converted` ganham a aba "Convertidos" na caixa de leads.
- Busca no Ctrl+K inclui negócios; lixeira inclui negócios.
- [ ] **Step 1: E2E que falha:** `"converter lead cria negócio com pessoa, organização, valor e etiquetas"`, `"lead convertido aparece na aba Convertidos com link"`, `"busca encontra negócio pelo título"`, `"negócio na lixeira pode ser restaurado"`, `"filtro por etiqueta continua funcionando nas listas"` (com 1.200 registros etiquetados criados via service role numa empresa de teste, a lista filtra sem erro).
- [ ] **Step 2 a 4:** falhar, implementar, passar. **Step 5:** commit `feat(negocios): conversão de lead, busca, lixeira e filtro por etiqueta`.

---

### Task 10: Fechamento da fase 3

**Files:**
- Modify: `README.md` (módulo Negócios), novo `docs/superpowers/followups/<data>-fase-3-pendencias.md`
- Test: `e2e/phase3-smoke.spec.ts`

- [ ] **Step 1: E2E de jornada:** admin configura funil com etapa que exige contrato e um produto recorrente → SDR converte um lead → closer (papel com visibilidade de empresa) arrasta o negócio pelas etapas, preenche o contrato quando o modal pede, adiciona o produto, marca ganho → o cronograma mostra as parcelas certas → a visão forecast não mostra mais o negócio (ganho) e a lista de ganhos mostra.
- [ ] **Step 2:** suíte completa (`pnpm lint && pnpm typecheck && pnpm test && pnpm test:db && pnpm build && pnpm test:e2e`) verde.
- [ ] **Step 3: Commit** — `docs: fechamento da fase 3`.

---

## Cobertura da spec (fase 3)

| Requisito | Task |
|---|---|
| Tabelas da seção 4.3 e regras de contrato | 1 |
| RLS e permissões (manage_pipelines, manage_products) | 2 |
| Totais por itens, cronograma de receita, obrigatórios por etapa, histórico | 3 |
| Configuração de funis e etapas (ordem por arrastar, probabilidade, esfriar, obrigatórios, próxima atividade, campo do card) | 4 |
| Catálogo de produtos, motivos de perda | 4 |
| Kanban (colunas com somas, card, animações, obrigatórios com tremor e modal, rodapé Ganho/Perdido/Excluir, filtros) | 6 |
| Lista e forecast | 7 |
| Detalhe com barra de etapas, ganho/perdido, produtos, contrato e cronograma | 8 |
| Conversão de lead (adiada da fase 2) | 3, 9 |
| Indicador e filtro de atividades | adiado para a fase 4 (ver Ajustes) |
