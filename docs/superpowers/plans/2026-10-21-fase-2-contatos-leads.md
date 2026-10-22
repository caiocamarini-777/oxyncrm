# Fase 2: Leads, pessoas e organizações, plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar a base de contatos por cliente: organizações, pessoas e caixa de leads, com listas filtráveis, telas de detalhe no padrão Pipedrive, campos personalizados, etiquetas, anotações, linha do tempo, aviso de duplicidade, reatribuição de responsável, lixeira e busca global.

**Architecture:** Novas tabelas multiempresa com `company_id` e `owner_id`, protegidas por RLS que chama `can_access` (fase 1) com as entidades `leads`, `persons` e `organizations`. Registros filhos (anotações, etiquetas, linha do tempo) herdam a permissão do registro pai por uma função `can_read_record`. A linha do tempo é escrita só por triggers. A interface reaproveita o shell, o padrão de server actions com `ActionResult` e um kit de lista/detalhe compartilhado pelas três entidades.

**Tech Stack:** o mesmo da fase 1, mais `@tanstack/react-table`, extensões `pg_trgm` e `pg_cron` no Supabase.

**Spec:** `docs/superpowers/specs/2026-10-21-oxyn-crm-design.md` (seções 4.2, 5.3 e 6, fase 2)

## Global Constraints

- Tudo da seção Global Constraints do plano da fase 1 continua valendo (regras no banco, cores, fontes, PT-BR sem emoji e sem travessão, service role só em `server-only`, identificadores em inglês e rotas em português).
- Ambiente sem Docker: migrations com `pnpm db:migrate` no projeto de dev; testes de banco com `pnpm test:db` (arquivos em `begin`/`rollback`, terminando em `select * from finish();`); fixtures com UUIDs fixos e prefixo `tst-`; E2E cria dados com sufixo único e apaga no `afterAll`.
- Migrations da fase 1 (0001 a 0005) estão congeladas. Esta fase só cria arquivos novos a partir de `20261022000001`.
- Entidades usadas em `can_access`: exatamente `leads`, `persons`, `organizations`.
- Listas paginadas no servidor, 50 por página. Estado de filtros, ordenação e página na URL (search params).
- Datas em `dd/mm/aaaa`, valores em BRL (`Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" })`).
- Cores de etiqueta, só estas: `teal`, `blue`, `green`, `red`, `gray`, `purple`.
- Nenhuma ação de escrita da interface usa o cliente service role.

## Ajustes em relação à spec

- **"Converter em negócio" fica para a fase 3.** A conversão cria um negócio, e a tabela `deals` só existe na fase 3. Nesta fase o botão aparece desabilitado com o tooltip "Disponível com o funil de negócios". A coluna `leads.converted_deal_id` já é criada, sem FK; a fase 3 adiciona a FK.
- **Anotações em texto simples** (com quebras de linha e links clicáveis), não rich text. Evita sanitização de HTML agora; rich text pode entrar depois sem mudar o schema.
- **Configuração de campos, etiquetas, origens e motivos** fica na área Configurações (admin geral). O banco já permite que usuários com `manage_custom_fields` na empresa editem; a tela para eles virá quando houver configurações por empresa para não admins.
- **Exportação CSV** é checada no servidor (permissão `export` do papel) numa route handler, não no banco. Quem tem leitura já consegue ler os dados pela API; a permissão de exportar controla a facilidade de extrair em massa.

## Review Focus

1. Na visão "Todas as empresas", criar um registro exige escolher a empresa primeiro; o seletor só lista empresas onde o usuário pode criar aquela entidade. Teste na Task 6.
2. Responsável desativado: o registro continua visível para quem tem visibilidade de equipe ou empresa; o seletor de responsável não oferece usuários inativos, mas mostra o responsável atual com "(inativo)". Teste na Task 5.
3. Campo personalizado arquivado com valores já gravados: os valores somem da tela, mas continuam no banco e voltam ao desarquivar. Teste na Task 4.
4. Pessoa ligada a uma organização que o usuário não pode ver, ou que está na lixeira: a tela mostra o nome da organização sem link e com "(sem acesso)" ou "(na lixeira)", sem quebrar. Teste na Task 7.
5. O aviso de duplicidade nunca revela dados do registro encontrado a quem não pode lê-lo: só o tipo de coincidência e o nome do responsável. Teste na Task 3.

---

## Estrutura de arquivos

```
supabase/migrations/
  20261022000001_contacts_schema.sql      # tabelas, índices, triggers utilitários
  20261022000002_contacts_security.sql    # RLS, guardas de responsável/lixeira, validação de campos
  20261022000003_contacts_functions.sql   # duplicidade, linha do tempo, busca, lixeira, pg_cron
  20261022000004_organization_label.sql   # nome de organização para quem lê a pessoa (Task 7)
supabase/tests/
  06_contacts_schema.test.sql
  07_contacts_security.test.sql
  08_contacts_functions.test.sql
  09_organization_label.test.sql
src/lib/
  records/types.ts            # RecordEntity, ListQuery, Paged<T>
  records/query.ts            # parseListQuery / serializeListQuery (search params)
  records/csv.ts              # toCsv
  records/format.ts           # formatDate, formatMoney, normalizePhone, normalizeEmail
  records/owners.ts           # listAssignableOwners
  records/actions.ts          # reassignOwner, moveToTrash, restoreFromTrash, purgeRecord
  custom-fields/schema.ts     # customFieldDefSchema, validateCustomFieldValues
  custom-fields/actions.ts
  labels/actions.ts
  lists/actions.ts            # lead sources, disqualification reasons
  organizations/{schema,actions,queries}.ts
  persons/{schema,actions,queries}.ts
  leads/{schema,actions,queries}.ts
  notes/actions.ts
  timeline/queries.ts
  search/actions.ts
src/components/records/
  data-table.tsx  column-picker.tsx  list-filters.tsx  pagination.tsx
  record-layout.tsx  record-header.tsx  details-panel.tsx
  custom-field-input.tsx  custom-field-value.tsx
  owner-picker.tsx  label-picker.tsx  label-chip.tsx
  duplicate-warning.tsx  company-picker.tsx
  timeline.tsx  note-composer.tsx
src/app/(app)/[empresa]/
  leads/page.tsx  leads/[id]/page.tsx
  contatos/page.tsx (pessoas)  contatos/pessoas/[id]/page.tsx
  contatos/organizacoes/page.tsx  contatos/organizacoes/[id]/page.tsx
  lixeira/page.tsx
  exportar/[entidade]/route.ts
src/app/(app)/configuracoes/
  campos/page.tsx  etiquetas/page.tsx  origens/page.tsx  motivos/page.tsx
e2e/
  contacts-settings.spec.ts  organizations.spec.ts  persons.spec.ts
  leads.spec.ts  notes-timeline.spec.ts  search-trash.spec.ts
```

---

### Task 1: Schema de contatos e leads

**Files:**
- Create: `supabase/migrations/20261022000001_contacts_schema.sql`
- Test: `supabase/tests/06_contacts_schema.test.sql`

**Interfaces:**
- Consumes: `companies`, `profiles`, `set_updated_at()` (fase 1).
- Produces (todas em `public`, RLS ligado e sem políticas nesta task, como na fase 1):
  - Colunas comuns às três entidades de negócio: `id uuid pk default gen_random_uuid()`, `company_id uuid not null → companies on delete cascade`, `owner_id uuid not null → profiles`, `created_by uuid → profiles default auth.uid()`, `created_at`, `updated_at`, `deleted_at timestamptz`, `custom_fields jsonb not null default '{}'` com check `jsonb_typeof(custom_fields) = 'object'`.
  - `organizations`: `name text not null` (1 a 200 caracteres), `legal_name text`, `cnpj text` (check `^[0-9]{14}$`), `domain text` (check minúsculas `^[a-z0-9.-]+\.[a-z]{2,}$`), `segment text`, `address jsonb not null default '{}'`.
  - `persons`: `full_name text not null` (1 a 200), `job_title text`, `organization_id uuid → organizations on delete set null`, `emails jsonb not null default '[]'`, `phones jsonb not null default '[]'`, `linkedin_url text`. `emails` e `phones` são arrays de `{ "label": text, "value": text }` (check `jsonb_typeof = 'array'`).
  - `lead_sources` e `disqualification_reasons`: `id`, `company_id → companies cascade`, `name text not null` (1 a 80), `position int not null default 0`, `active bool not null default true`, `unique(company_id, name)`.
  - `leads`: `title text not null` (1 a 200), `source_id → lead_sources on delete set null`, `person_id → persons on delete set null`, `organization_id → organizations on delete set null`, `estimated_value numeric(14,2)` (check `>= 0`), `status text not null default 'open'` (check em `open`, `converted`, `disqualified`, `archived`), `disqualification_reason_id → disqualification_reasons on delete restrict`, `disqualification_note text`, `converted_deal_id uuid`, `converted_at timestamptz`. Check: `status <> 'disqualified' or disqualification_reason_id is not null`.
  - `labels`: `id`, `company_id → companies cascade`, `name text not null` (1 a 40), `color text not null` (check nas seis cores da Global Constraints), `unique(company_id, name)`.
  - `record_labels`: `label_id → labels on delete cascade`, `entity text not null` (check em `leads`, `persons`, `organizations`), `record_id uuid not null`, `created_by uuid default auth.uid()`, `created_at`, `primary key(label_id, entity, record_id)`.
  - `custom_field_defs`: `id`, `company_id → companies cascade`, `entity text not null` (check em `leads`, `persons`, `organizations`, `deals`, `activities`), `key text not null` (check `^[a-z][a-z0-9_]{0,39}$`), `label text not null` (1 a 60), `type text not null` (check em `text`, `number`, `money`, `date`, `select`, `multiselect`, `user`), `options jsonb not null default '[]'` (array de strings), `position int not null default 0`, `archived_at timestamptz`, `unique(company_id, entity, key)`. Check: `type not in ('select','multiselect') or jsonb_array_length(options) > 0`.
  - `notes`: `id`, `company_id`, `entity` (mesmo check de `record_labels`), `record_id uuid not null`, `body text not null` (1 a 10.000), `created_by uuid not null default auth.uid() → profiles`, `created_at`, `updated_at`, `deleted_at`.
  - `timeline_events`: `id bigint generated always as identity pk`, `company_id`, `entity`, `record_id`, `kind text not null` (check em `created`, `updated`, `owner_changed`, `status_changed`, `note_added`, `label_added`, `label_removed`, `trashed`, `restored`), `actor_id uuid`, `data jsonb not null default '{}'`, `created_at timestamptz not null default now()`.
  - Extensões: `create extension if not exists pg_trgm with schema extensions;`
  - Índices: `(company_id, owner_id)` e `(company_id, deleted_at)` nas três entidades; GIN trigram em `lower(name)` (organizations), `lower(full_name)` (persons), `lower(title)` (leads); GIN `jsonb_path_ops` em `persons.emails` e `persons.phones`; únicos parciais `organizations(company_id, cnpj) where cnpj is not null and deleted_at is null` e `organizations(company_id, domain) where domain is not null and deleted_at is null`; `notes(entity, record_id)`; `timeline_events(entity, record_id, created_at desc)`; `record_labels(entity, record_id)`.
  - Triggers: `set_updated_at` em organizations, persons, leads, notes. Trigger `normalize_person_contacts()` (before insert/update em persons): e-mails em minúsculas e sem espaços; telefones só com dígitos.
  - Trigger `guard_same_company()` (before insert/update em persons, leads, notes, record_labels via função genérica ou uma por tabela): referências (`organization_id`, `person_id`, `source_id`, `disqualification_reason_id`, label da `record_labels`) precisam ser da mesma `company_id`. Erro: `OXYN_CROSS_COMPANY`.
  - Seed por migration: para cada empresa existente e para novas empresas (trigger `after insert on companies`), criar origens padrão `Indicação`, `Prospecção ativa`, `Site`, `Evento`, `LinkedIn`, `Outro` e motivos padrão `Sem fit`, `Sem orçamento`, `Sem interesse`, `Contato inválido`, `Já é cliente`, `Outro`.

- [ ] **Step 1: Teste pgTAP que falha**

`06_contacts_schema.test.sql`:
- `has_table` para as 10 tabelas.
- `throws_ok` (23514): organização com cnpj mascarado; domínio com maiúscula; lead `disqualified` sem motivo; label com cor `orange`; custom field `select` sem opções; key `Valor`.
- `lives_ok`: pessoa com `emails = '[{"label":"Trabalho","value":" Ana@Volt.COM "}]'` e `phones = '[{"label":"Celular","value":"(11) 98888-7777"}]'`; depois `results_eq` mostra `ana@volt.com` e `11988887777`.
- `throws_ok` (`OXYN_CROSS_COMPANY`): lead em `tst-volt` com `person_id` de pessoa de `tst-naia`.
- `throws_ok` (23505): duas organizações não excluídas com o mesmo cnpj na mesma empresa; `lives_ok` depois de marcar a primeira com `deleted_at`.
- Empresa nova `tst-nova` recebe 6 origens e 6 motivos (`is(count, 6)` filtrando por company_id).

- [ ] **Step 2: Rodar e ver falhar** — `pnpm test:db` → FAIL em `06`.
- [ ] **Step 3: Escrever a migration e aplicar** — `pnpm db:migrate`.
- [ ] **Step 4: Rodar e ver passar** — `pnpm test:db` → PASS em 01 a 06.
- [ ] **Step 5: Commit** — `feat(db): schema de organizações, pessoas e leads`.

---

### Task 2: Segurança das tabelas de contatos

**Files:**
- Create: `supabase/migrations/20261022000002_contacts_security.sql`
- Test: `supabase/tests/07_contacts_security.test.sql`

**Interfaces:**
- Consumes: `can_access`, `is_super_admin`, `has_company_access`, `role_permissions` (fase 1); tabelas da Task 1.
- Produces:
  - `record_ref(p_entity text, p_record_id uuid) returns table(company_id uuid, owner_id uuid, deleted_at timestamptz)` (security definer, stable, execute só para authenticated).
  - `can_read_record(p_entity text, p_record_id uuid) returns boolean`: o registro existe, não está na lixeira e `can_access(company, entity, owner, 'read')`.
  - `can_edit_record(p_entity text, p_record_id uuid) returns boolean`: idem com `'edit'`.
  - `owner_has_membership(p_company uuid, p_owner uuid) returns boolean`: o perfil está ativo e tem membership na empresa, ou é admin geral.
  - `can_manage_company_lists(p_company uuid) returns boolean`: admin geral ou `role_permissions(p_company)->'settings'->>'manage_custom_fields' = 'true'`.
  - Erros novos: `OXYN_OWNER_NOT_MEMBER`, `OXYN_REASSIGN_FORBIDDEN`, `OXYN_TRASH_FORBIDDEN`, `OXYN_COMPANY_IMMUTABLE`, `OXYN_INVALID_CUSTOM_FIELD`.
  - `validate_custom_fields(p_company uuid, p_entity text, p_values jsonb) returns void` (raise `OXYN_INVALID_CUSTOM_FIELD` com a chave no `detail`).

**Políticas para `organizations`, `persons`, `leads`** (entidade `E` = nome da tabela; todas `to authenticated`):

| Operação | Regra |
|---|---|
| select | `deleted_at is null and can_access(company_id, E, owner_id, 'read')` **ou** `deleted_at is not null and can_access(company_id, E, owner_id, 'delete')` |
| insert | with check: `can_access(company_id, E, owner_id, 'create') and owner_has_membership(company_id, owner_id) and (owner_id = auth.uid() or can_access(company_id, E, owner_id, 'reassign_owner'))` |
| update | using: `can_access(company_id, E, owner_id, 'edit')` ou (na lixeira) `can_access(..., 'delete')`; with check: `owner_has_membership(company_id, owner_id)` |
| delete | `is_super_admin()` (exclusão definitiva) |

**Trigger `guard_record_update()`** (before update nas três tabelas):
- `company_id` mudou → `OXYN_COMPANY_IMMUTABLE`.
- `owner_id` mudou e o usuário (com `auth.uid()` não nulo) não tem `reassign_owner` na empresa → `OXYN_REASSIGN_FORBIDDEN`.
- `deleted_at` mudou e o usuário não tem `delete` → `OXYN_TRASH_FORBIDDEN`.
- Trigger `validate_custom_fields_trg` (before insert/update): chama `validate_custom_fields`. Regras: cada chave existe em `custom_field_defs` da empresa e entidade (arquivadas contam como existentes, para não perder valores); `text` string até 2.000; `number` e `money` número; `date` string `YYYY-MM-DD`; `select` string presente em `options`; `multiselect` array de strings presentes em `options`; `user` uuid de perfil com membership na empresa; `null` sempre aceito.

**Políticas das tabelas de apoio:**

| Tabela | select | escrita |
|---|---|---|
| `lead_sources`, `disqualification_reasons`, `labels`, `custom_field_defs` | `has_company_access(company_id)` | `can_manage_company_lists(company_id)` |
| `record_labels` | `can_read_record(entity, record_id)` | insert/delete: `can_edit_record(entity, record_id)` |
| `notes` | `deleted_at is null and can_read_record(entity, record_id)` | insert: `can_read_record(...) and created_by = auth.uid()`; update: `created_by = auth.uid() or is_super_admin()` |
| `timeline_events` | `can_read_record(entity, record_id)` | ninguém (só triggers `security definer`) |

Revogar `truncate, references, trigger` de `authenticated` e `all` de `anon` em todas as tabelas novas.

- [ ] **Step 1: Teste pgTAP que falha**

Fixture: empresas `tst-volt` e `tst-naia`; usuários `admin` (super), `ana` (papel `tst-Equipe`: visibilidade `team`, `create`/`edit` true, `delete` false, `reassign_owner` false), `bruno` (`Usuário padrão`), `caio` (papel `tst-Gestor`: `company` em tudo, todas as ações true, `manage_custom_fields` true), `dani` (sem membership em `tst-volt`); equipe com `ana` e `bruno`. Casos:
- `bruno` vê só as próprias organizações, pessoas e leads; `ana` vê as de `bruno`; `caio` vê todas de `tst-volt` e nenhuma de `tst-naia`.
- `bruno` cria lead com `owner_id = bruno` → ok; com `owner_id = ana` → falha (42501).
- `caio` cria lead com `owner_id = ana` → ok; com `owner_id = dani` → falha (sem membership).
- `bruno` muda `owner_id` do próprio lead → `OXYN_REASSIGN_FORBIDDEN`; `caio` muda → ok, e o lead some para `bruno`.
- `ana` tenta `deleted_at = now()` em registro que vê → `OXYN_TRASH_FORBIDDEN`; `caio` → ok; o registro some do select de `ana` e aparece para `caio`.
- `caio` faz `delete` definitivo → 0 linhas (42501 ou nada afetado); `admin` → ok.
- `caio` muda `company_id` → `OXYN_COMPANY_IMMUTABLE`.
- `custom_fields`: com def `porte` (`select`, opções `Pequeno`, `Médio`, `Grande`) em organizations de `tst-volt`: `{"porte":"Médio"}` ok; `{"porte":"Gigante"}` e `{"inexistente":1}` → `OXYN_INVALID_CUSTOM_FIELD`; def arquivada mantém `{"porte":"Médio"}` válido.
- `bruno` lê `notes` e `timeline_events` só de registros que ele lê; não insere nota com `created_by` de outro.
- `bruno` não cria `labels`; `caio` cria (manage_custom_fields).
- `has_table_privilege('authenticated', <tabela>, 'TRUNCATE')` falso nas 10 tabelas.

- [ ] **Step 2: Rodar e ver falhar** — FAIL em `07`.
- [ ] **Step 3: Implementar e aplicar** — `pnpm db:migrate`.
- [ ] **Step 4: Rodar e ver passar** — PASS em 01 a 07.
- [ ] **Step 5: Commit** — `feat(db): RLS e guardas de contatos e leads`.

---

### Task 3: Duplicidade, linha do tempo, busca e lixeira no banco

**Files:**
- Create: `supabase/migrations/20261022000003_contacts_functions.sql`
- Test: `supabase/tests/08_contacts_functions.test.sql`

**Interfaces:**
- Produces:
  - `check_duplicates(p_company uuid, p_entity text, p_emails text[] default '{}', p_phones text[] default '{}', p_cnpj text default null, p_domain text default null, p_exclude uuid default null) returns table(matched_on text, owner_name text, record_id uuid)` (security definer). `p_entity` em `persons` (compara e-mails e telefones normalizados) ou `organizations` (cnpj e domínio). Ignora registros na lixeira e `p_exclude`. `matched_on` em `email`, `phone`, `cnpj`, `domain`. `record_id` só é preenchido quando `can_access(..., 'read')` é verdadeiro para quem chama; senão `null`. Exige `has_company_access(p_company)`; sem acesso devolve zero linhas.
  - Triggers de linha do tempo (`security definer`), gravando em `timeline_events` com `actor_id = auth.uid()`:
    - insert nas três entidades → `created`;
    - update → `owner_changed` (`data: {from, to}`), `status_changed` em leads (`{from, to, reason_id}`), `trashed`/`restored` quando `deleted_at` muda, e `updated` com `data.fields` (lista dos nomes de colunas alteradas, sem valores) para as demais mudanças;
    - insert em `notes` → `note_added` (`{note_id}`) no registro pai;
    - insert/delete em `record_labels` → `label_added`/`label_removed` (`{label_id, name}`).
  - `global_search(p_query text, p_company uuid default null, p_limit int default 5) returns table(entity text, record_id uuid, company_id uuid, title text, subtitle text)` (security invoker, então o RLS filtra). Busca por `ilike '%' || p_query || '%'` em nome/título, e-mail de pessoas e cnpj/domínio de organizações; ignora lixeira; até `p_limit` por entidade; `p_query` com menos de 2 caracteres devolve vazio.
  - `purge_trash() returns int` (security definer, execute só para `postgres`): apaga definitivamente leads, pessoas, organizações e notas com `deleted_at < now() - interval '30 days'`; devolve a contagem. `create extension if not exists pg_cron;` e `select cron.schedule('oxyn-purge-trash', '0 6 * * *', 'select public.purge_trash()');` (idempotente: desagendar se já existir).

- [ ] **Step 1: Teste pgTAP que falha**

Reaproveitar a fixture da Task 2. Casos:
- Pessoa de `ana` com `ana@volt.com`: `check_duplicates` chamado por `bruno` com `{ANA@volt.com}` devolve 1 linha `('email', 'tst Ana', null)`; chamado por `caio` devolve `record_id` preenchido.
- Pessoa na lixeira não conta; `p_exclude` ignora o próprio registro.
- Chamado por `dani` (sem acesso a `tst-volt`) → 0 linhas.
- Criar lead gera `created`; `caio` reatribui → `owner_changed` com `from`/`to`; desqualificar → `status_changed`; mover para lixeira → `trashed`; nota → `note_added`; etiqueta → `label_added` com o nome.
- `bruno` não lê eventos de lead de `caio`.
- `global_search('volt')` como `bruno` só devolve registros dele; `'v'` devolve vazio.
- `purge_trash()` como postgres remove registro com `deleted_at` de 31 dias e mantém o de 29.

- [ ] **Step 2 a 5:** falhar, implementar e aplicar, passar (01 a 08), commit `feat(db): duplicidade, linha do tempo, busca e lixeira`.

---

### Task 4: Configurações de campos, etiquetas, origens e motivos

**Files:**
- Create: `src/lib/custom-fields/{schema,actions}.ts`, `src/lib/labels/actions.ts`, `src/lib/lists/actions.ts`, `src/app/(app)/configuracoes/{campos,etiquetas,origens,motivos}/page.tsx`, componentes em `src/components/settings/`
- Modify: navegação secundária de `src/app/(app)/configuracoes/layout.tsx` (novos itens: Campos, Etiquetas, Origens de lead, Motivos de desqualificação)
- Test: `src/lib/custom-fields/schema.test.ts`, `e2e/contacts-settings.spec.ts`

**Interfaces:**
- Produces:
  - `CUSTOM_FIELD_TYPES`, `CUSTOM_FIELD_ENTITIES_PHASE2 = ["organizations", "persons", "leads"]`, `LABEL_COLORS`.
  - `customFieldDefSchema` (zod): `label` 1 a 60, `key` gerada por `slugifyKey(label)` (minúsculas, `_` no lugar de espaço/hífen, sem acento, prefixo `campo_` se começar por dígito, corte em 40), `type`, `options` obrigatório (≥ 1, sem repetidos, cada um 1 a 60) para `select`/`multiselect`.
  - `validateCustomFieldValues(defs: CustomFieldDef[], values: Record<string, unknown>): { ok: true } | { ok: false; key: string; message: string }` — espelha a função do banco (mesmas regras de tipo).
  - Actions (requireSuperAdmin + cliente de sessão): `createCustomField(companyId, input)`, `updateCustomField(id, { label, options, position })` (tipo e chave imutáveis depois de criados), `setCustomFieldArchived(id, archived)`, `createLabel(companyId, { name, color })`, `updateLabel`, `deleteLabel`, `createListItem(kind: "source" | "reason", companyId, name)`, `renameListItem`, `setListItemActive`, `moveListItem(id, direction: "up" | "down")`.
- Telas: seletor de empresa no topo de cada página (padrão: empresa atual do cookie). **Campos:** abas por entidade (Organizações, Pessoas, Leads), lista ordenável com tipo e opções, criar/editar em dialog, "Arquivar"/"Restaurar". **Etiquetas:** chips coloridos com edição inline. **Origens** e **Motivos:** listas com renomear, ativar/desativar e reordenar. Itens inativos não aparecem nos formulários, mas continuam nos registros que já os usam.

- [ ] **Step 1: Testes unitários que falham**
  - `slugifyKey("Porte da empresa")` → `"porte_da_empresa"`; `("2º contato")` → `"campo_2_contato"`.
  - `customFieldDefSchema` rejeita `select` sem opções e opções repetidas.
  - `validateCustomFieldValues`: casos iguais aos do pgTAP da Task 2 (`Médio` ok, `Gigante` erro, chave inexistente erro, `null` ok, `date` `2026-13-01` erro).
- [ ] **Step 2: Falhar.** **Step 3: Implementar.** **Step 4: Passar.**
- [ ] **Step 5: E2E**
  - `"cria campo de seleção em organizações"` → aparece na lista com as opções.
  - `"arquivar campo esconde do formulário e mantém o valor"`: com uma organização que tem valor no campo (criada via service role), arquivar → o detalhe da organização não mostra o campo; restaurar → o valor volta. (Review Focus 3.)
  - `"cria etiqueta e não aceita nome repetido"`.
  - `"desativar origem esconde do formulário de lead"`.
- [ ] **Step 6: Commit** — `feat(config): campos personalizados, etiquetas, origens e motivos`.

---

### Task 5: Kit compartilhado de lista e detalhe

**Files:**
- Create: `src/lib/records/{types,query,csv,format,owners}.ts`, `src/components/records/*` (lista do mapa de arquivos)
- Test: `src/lib/records/{query,csv,format}.test.ts` (os E2E do kit ficam em `e2e/organizations.spec.ts`, Task 6)

**Interfaces:**
- Produces:
  - `type RecordEntity = "organizations" | "persons" | "leads"`.
  - `type ListQuery = { q: string; page: number; sort: string; dir: "asc" | "desc"; owner: string[]; label: string[]; status: string[]; source: string[]; createdFrom: string | null; createdTo: string | null }`.
  - `parseListQuery(params: URLSearchParams, allowedSorts: string[]): ListQuery` (valores inválidos caem no padrão: `page` 1, `sort` `created_at`, `dir` `desc`); `serializeListQuery(q: ListQuery): string` (omite padrões).
  - `type Paged<T> = { rows: T[]; total: number; page: number; pageSize: 50 }`.
  - `toCsv(columns: { key: string; header: string }[], rows: Record<string, unknown>[]): string` — separador `;`, BOM UTF-8, aspas duplas escapadas, datas e valores já formatados pelo chamador.
  - `formatDate(iso: string | null): string` (`dd/mm/aaaa`, `""` para null), `formatMoney(value: number | null): string`, `normalizeEmail`, `normalizePhone` (só dígitos), `formatPhone` (`(11) 98888-7777` para 11 dígitos, `(11) 3333-4444` para 10, senão os dígitos).
  - `listAssignableOwners(companyId: string): Promise<{ id: string; fullName: string; avatarUrl: string | null; active: boolean }[]>` — membros da empresa (e admins gerais) visíveis por RLS; ativos primeiro.
  - Componentes:
    - `<DataTable columns rows total query entity companyColumn? />`: cabeçalhos clicáveis para ordenar (atualiza a URL), seleção de colunas visíveis em `localStorage` (`oxyn:columns:<entity>`), linha clicável para o detalhe, estado vazio "Nenhum registro encontrado." com botão de criar.
    - `<ListFilters entity options />`: busca com debounce de 300 ms, multiselect de responsável, etiqueta, status e origem (os dois últimos só em leads), intervalo de criação, "Limpar filtros".
    - `<Pagination total page />` com "1 a 50 de 312".
    - `<RecordLayout header details main />`: coluna esquerda fixa de 360 px com os dados; centro com abas e linha do tempo; empilha em telas estreitas.
    - `<OwnerPicker companyId value canReassign onChange />`: desabilitado sem `reassign_owner`; não oferece inativos; mostra o atual com "(inativo)" quando for o caso.
    - `<LabelPicker companyId entity recordId value canEdit />`, `<LabelChip color name />`.
    - `<CustomFieldInput def value onChange />` e `<CustomFieldValue def value />` para os sete tipos (`user` usa a lista de `listAssignableOwners`; `money` formata BRL).
    - `<CompanyPicker entity onSelect />`: na visão "Todas", lista só empresas onde o papel do usuário tem `create` para a entidade (admin geral: todas).
  - Server actions genéricas em `src/lib/records/actions.ts`: `reassignOwner(entity, id, ownerId)`, `moveToTrash(entity, id)`, `restoreFromTrash(entity, id)`, `purgeRecord(entity, id)` (só admin geral), todas com `ActionResult` e `translateDbError` (adicionar as mensagens: `OXYN_OWNER_NOT_MEMBER` → "Essa pessoa não tem acesso a esta empresa."; `OXYN_REASSIGN_FORBIDDEN` → "Você não pode trocar o responsável."; `OXYN_TRASH_FORBIDDEN` → "Você não pode mover para a lixeira."; `OXYN_COMPANY_IMMUTABLE` → "Não é possível mudar a empresa do registro."; `OXYN_INVALID_CUSTOM_FIELD` → "Valor inválido no campo personalizado."; `OXYN_CROSS_COMPANY` → "Os registros ligados precisam ser da mesma empresa.").
  - Permissões na interface: helper `getEntityPermissions(companyId, entity): Promise<{ create, edit, delete, export, reassign }>` lido de `role_permissions` (admin geral: tudo true) para esconder botões; o banco continua sendo a barreira.

- [ ] **Step 1: Testes unitários que falham**
  - `parseListQuery(new URLSearchParams("page=0&sort=hack&dir=x"), ["name"])` → `page` 1, `sort` `created_at`, `dir` `desc`; `("owner=a&owner=b")` → `owner` `["a","b"]`; `serializeListQuery` de um query padrão → `""`.
  - `toCsv` com `Ana "Tita"` e `;` no valor → célula entre aspas com aspas duplicadas; começa com `﻿`.
  - `formatDate("2026-10-21T10:00:00Z")` → `"21/10/2026"`; `formatMoney(1234.5)` → `"R$ 1.234,50"` (comparar removendo o espaço não separável); `formatPhone("11988887777")` → `"(11) 98888-7777"`.
- [ ] **Step 2 a 4:** falhar, implementar, passar.
- [ ] **Step 5: Commit** — `feat(ui): kit de listas e telas de registro`. (Os E2E do kit rodam na Task 6, primeira tela que o usa.)

---

### Task 6: Organizações

**Files:**
- Create: `src/lib/organizations/{schema,actions,queries}.ts`, `src/app/(app)/[empresa]/contatos/organizacoes/page.tsx`, `src/app/(app)/[empresa]/contatos/organizacoes/[id]/page.tsx`, `src/components/organizations/*`, `src/components/records/duplicate-warning.tsx`, `src/app/(app)/[empresa]/exportar/[entidade]/route.ts` (genérica para as três entidades; responde 403 sem a permissão `export`)
- Modify: `src/lib/nav.ts` (`CURRENT_PHASE = 2`; Contatos aponta para `/contatos`)
- Test: `src/lib/organizations/schema.test.ts`, `e2e/organizations.spec.ts`

**Interfaces:**
- Consumes: kit da Task 5, `check_duplicates`, `isValidCnpj`/`formatCnpj` (fase 1).
- Produces:
  - `organizationSchema`: `name` 1 a 200, `legalName`, `cnpj` (opcional, válido, normalizado), `domain` (opcional, minúsculas, sem `http://`, `https://`, `www.` e barra final), `segment`, `address { street, number, city, state (UF de 2 letras), zip (8 dígitos) }`, `ownerId`, `customFields`.
  - `listOrganizations(scope: CompanyScope, query: ListQuery): Promise<Paged<OrganizationRow>>` (colunas: nome, CNPJ, domínio, segmento, responsável, pessoas vinculadas, etiquetas, criada em, e empresa quando o escopo é "todas").
  - `getOrganization(id): Promise<OrganizationDetail | null>`.
  - Actions: `createOrganization(companyId, input): Promise<ActionResult<{ id }>>`, `updateOrganization(id, input)`, `findOrganizationDuplicates(companyId, { cnpj, domain }, excludeId?)`.
- Telas:
  - Lista em `/[empresa]/contatos/organizacoes`, com abas "Pessoas" e "Organizações" no topo da área Contatos; botão "Nova organização" (dialog), "Exportar CSV" quando permitido.
  - Detalhe em `/[empresa]/contatos/organizacoes/[id]`: cabeçalho com nome, responsável (`OwnerPicker`), etiquetas e menu "Mover para a lixeira"; coluna esquerda com dados editáveis, endereço e campos personalizados; centro com abas "Anotação" (Task 8), "Atividade" e "E-mail" desabilitadas com "Disponível em breve", e a linha do tempo; bloco "Pessoas" com as pessoas vinculadas.
  - Aviso de duplicidade ao digitar CNPJ ou domínio (debounce 400 ms): "Já existe uma organização com este CNPJ nesta empresa. Responsável: Fulano." com link "Abrir" só quando `record_id` vier preenchido. Permite salvar mesmo assim.
  - Na visão "Todas", "Nova organização" abre primeiro o `CompanyPicker`.
- `notFound()` para id inexistente, de outra empresa ou sem acesso (mesmo 404).

- [ ] **Step 1: Unitários que falham** — `organizationSchema` normaliza `https://www.Volt.com.br/` → `volt.com.br`; rejeita UF `XX` e CEP com 7 dígitos; aceita sem CNPJ.
- [ ] **Step 2 a 4:** falhar, implementar, passar.
- [ ] **Step 5: E2E** (usuários e empresas por service role, limpeza no `afterAll`):
  - `"cria organização, aparece na lista e abre o detalhe"`.
  - `"filtra por responsável e ordena por nome"` (URL reflete os filtros; recarregar mantém).
  - `"aviso de duplicidade não revela dados sem acesso"`: organização de `ana` com CNPJ X; `bruno` (padrão) digita X → vê "Responsável: Ana" e nenhum link "Abrir". (Review Focus 5.)
  - `"usuário padrão não vê organização de outro"` e `"404 igual para inexistente e sem acesso"`.
  - `"reatribuir responsável exige permissão"`: `bruno` vê o seletor desabilitado; gestor troca para `ana` e o registro some da lista de `bruno`.
  - `"responsável inativo aparece marcado e não é oferecido"` (Review Focus 2).
  - `"na visão Todas, criar pede a empresa"` (Review Focus 1).
  - `"exportar CSV só com permissão"`: botão ausente para `bruno`; gestor baixa um CSV com o cabeçalho esperado; GET direto na rota por `bruno` → 403.
- [ ] **Step 6: Commit** — `feat(contatos): organizações`.

---

### Task 7: Pessoas

**Files:**
- Create: `src/lib/persons/{schema,actions,queries}.ts`, `src/app/(app)/[empresa]/contatos/page.tsx`, `src/app/(app)/[empresa]/contatos/pessoas/[id]/page.tsx`, `src/components/persons/*`
- Test: `src/lib/persons/schema.test.ts`, `e2e/persons.spec.ts`

**Interfaces:**
- Produces:
  - `personSchema`: `fullName` 1 a 200, `jobTitle`, `organizationId` (opcional), `emails` e `phones` arrays de `{ label: "Trabalho" | "Pessoal" | "Celular" | "Outro"; value }` (e-mail válido; telefone 10 a 13 dígitos depois de normalizar), sem valores repetidos, `linkedinUrl` (opcional, `https://` e domínio `linkedin.com`), `ownerId`, `customFields`.
  - `listPersons(scope, query)`, colunas: nome, cargo, organização, e-mail principal, telefone principal, responsável, etiquetas, criada em (e empresa no escopo "todas").
  - `getPerson(id)`: inclui a organização vinculada com um de três estados: `{ state: "ok", id, name }`, `{ state: "no_access", name }`, `{ state: "trashed", name }`. O nome vem de uma função `security definer` `organization_label(p_id uuid) returns text` criada nesta task numa migration nova `20261022000004_organization_label.sql` (devolve só o nome, e só se a organização for da mesma empresa de um registro que o usuário pode ler).
  - Actions: `createPerson`, `updatePerson`, `findPersonDuplicates(companyId, { emails, phones }, excludeId?)`.
- Telas: lista em `/[empresa]/contatos` (aba "Pessoas" padrão); dialog "Nova pessoa" com organização pesquisável (só da mesma empresa) e opção "Criar organização" inline; detalhe igual ao padrão da Task 6, com e-mails e telefones clicáveis (`mailto:`, `tel:`, WhatsApp `https://wa.me/55<dígitos>` para celulares).

- [ ] **Step 1: Unitários que falham** — rejeita e-mail repetido com caixa diferente; normaliza telefone; rejeita LinkedIn fora de `linkedin.com`.
- [ ] **Step 2 a 4:** falhar, implementar (incluindo a migration 0004 com teste pgTAP `09_organization_label.test.sql`: nome devolvido para quem lê a pessoa; null para empresa diferente), passar.
- [ ] **Step 5: E2E**
  - `"cria pessoa com dois e-mails e organização nova inline"`.
  - `"aviso de duplicidade por e-mail e por telefone"`.
  - `"organização sem acesso ou na lixeira aparece sem link"` (Review Focus 4).
  - `"link de WhatsApp só para celular"`.
- [ ] **Step 6: Commit** — `feat(contatos): pessoas`.

---

### Task 8: Anotações e linha do tempo

**Files:**
- Create: `src/lib/notes/actions.ts`, `src/lib/timeline/queries.ts`, `src/components/records/{timeline,note-composer}.tsx`
- Modify: telas de detalhe das Tasks 6 e 7 (passam a usar os componentes)
- Test: `src/lib/timeline/queries.test.ts`, `e2e/notes-timeline.spec.ts`

**Interfaces:**
- Produces:
  - `addNote(entity, recordId, body): Promise<ActionResult<{ id }>>`, `updateNote(id, body)`, `deleteNote(id)` (exclusão lógica; autor ou admin geral).
  - `getTimeline(entity, recordId): Promise<TimelineItem[]>` onde `TimelineItem = { kind; at; actorName; text; note?: { id; body; canEdit } }`, mais recente primeiro, juntando `timeline_events` e o corpo das notas.
  - `describeEvent(event, names: Record<string, string>): string` (função pura): `created` → "Criou o registro"; `owner_changed` → "Trocou o responsável de Ana para Bruno"; `status_changed` → "Mudou o status para Desqualificado (Sem orçamento)"; `trashed` → "Moveu para a lixeira"; `restored` → "Restaurou da lixeira"; `label_added` → "Adicionou a etiqueta Quente"; `label_removed` → "Removeu a etiqueta Quente"; `updated` → "Editou nome e segmento" (lista em português dos campos; mapa de rótulos por entidade); `note_added` não gera texto próprio (a nota aparece como cartão).
  - `<NoteComposer>`: textarea com "Salvar anotação" (desabilitado vazio), `Ctrl/Cmd+Enter` salva. `<Timeline>`: seção "Planejado" com o texto "As atividades chegam na próxima fase." e seção "Histórico" com os itens; notas mostram autor, data, corpo com quebras e links clicáveis (`rel="noopener noreferrer"`, `target="_blank"`), e "Editar"/"Excluir" quando permitido.
- [ ] **Step 1: Unitários que falham** — `describeEvent` para cada `kind` acima.
- [ ] **Step 2 a 4:** falhar, implementar, passar.
- [ ] **Step 5: E2E** — `"anotação aparece na linha do tempo e só o autor edita"`; `"trocar responsável registra o evento"`; `"texto com <script> é exibido como texto"`.
- [ ] **Step 6: Commit** — `feat(registros): anotações e linha do tempo`.

---

### Task 9: Leads

**Files:**
- Create: `src/lib/leads/{schema,actions,queries}.ts`, `src/app/(app)/[empresa]/leads/page.tsx`, `src/app/(app)/[empresa]/leads/[id]/page.tsx`, `src/components/leads/*`
- Test: `src/lib/leads/schema.test.ts`, `e2e/leads.spec.ts`

**Interfaces:**
- Produces:
  - `leadSchema`: `title` 1 a 200, `sourceId`, `personId`, `organizationId`, `estimatedValue` (≥ 0, até 2 casas), `ownerId`, `customFields`. Criação rápida: se o usuário digitar nome de pessoa/organização que não existe, oferecer criar junto (mesma transação lógica: cria pessoa/organização e depois o lead; se o lead falhar, apaga o que criou).
  - `disqualifySchema`: `reasonId` obrigatório, `note` até 1.000.
  - `listLeads(scope, query)`: padrão `status=open`; abas "Abertos", "Desqualificados", "Arquivados"; colunas: título, pessoa, organização, origem, valor estimado, responsável, etiquetas, idade (dias desde a criação, "hoje" para 0), criada em.
  - Actions: `createLead`, `updateLead`, `disqualifyLead(id, input)`, `reopenLead(id)` (volta para `open`, limpa motivo), `archiveLead(id)`.
- Telas: caixa de leads em `/[empresa]/leads`; detalhe com cabeçalho mostrando status, botões "Converter em negócio" (desabilitado, tooltip "Disponível com o funil de negócios"), "Desqualificar" (dialog com motivo obrigatório e observação), "Arquivar" e "Reabrir" conforme o status; coluna esquerda com pessoa e organização ligadas (links), origem, valor e campos personalizados.

- [ ] **Step 1: Unitários que falham** — `disqualifySchema` sem motivo → "Escolha um motivo."; `estimatedValue` com 3 casas → erro.
- [ ] **Step 2 a 4:** falhar, implementar, passar.
- [ ] **Step 5: E2E** — `"cria lead criando pessoa e organização juntas"`; `"desqualificar exige motivo e move para a aba Desqualificados"`; `"reabrir lead"`; `"origem inativa não aparece no formulário mas continua no lead"`; `"idade do lead"` (lead criado via service role com `created_at` de 10 dias → "10 dias").
- [ ] **Step 6: Commit** — `feat(leads): caixa de leads e desqualificação`.

---

### Task 10: Busca global e lixeira

**Files:**
- Create: `src/lib/search/actions.ts`, `src/app/(app)/[empresa]/lixeira/page.tsx`, componentes da lixeira
- Modify: `src/components/shell/command-palette.tsx` (resultados de registros), `src/lib/nav.ts` (palette: "Lixeira")
- Test: `e2e/search-trash.spec.ts`

**Interfaces:**
- Produces:
  - `searchRecords(query: string, scope: CompanyScope): Promise<{ entity; id; title; subtitle; href }[]>` usando `global_search`; `href` usa o slug da empresa do registro.
  - Palette: digitando 2+ caracteres, grupos "Leads", "Pessoas", "Organizações" (até 5 cada) acima de "Empresas" e "Ir para"; debounce 250 ms; Enter abre o registro.
  - Lixeira em `/[empresa]/lixeira`: abas por entidade, colunas nome, responsável, excluído em, "Excluído definitivamente em" (data + 30 dias); ações "Restaurar" (quem tem `delete`) e "Excluir definitivamente" (admin geral, com confirmação "Excluir <nome> para sempre? Esta ação não pode ser desfeita."). Link "Lixeira" no rodapé das listas de leads e contatos.
- [ ] **Step 1: E2E que falha**
  - `"busca encontra pessoa por e-mail e abre o detalhe"`.
  - `"busca de usuário padrão não mostra registros de outros"`.
  - `"mover para lixeira, restaurar e excluir definitivamente"`.
  - `"usuário sem permissão de excluir não vê o botão nem a lixeira de outros"`.
- [ ] **Step 2 a 4:** falhar, implementar, passar.
- [ ] **Step 5: Commit** — `feat(registros): busca global e lixeira`.

---

### Task 11: Fechamento da fase 2

**Files:**
- Modify: `README.md` (seção "Módulos" com o que existe), `src/lib/nav.test.ts` (fase 2: Leads e Contatos habilitados), `docs/superpowers/followups/` (novo arquivo de pendências da fase 2)
- Test: `e2e/phase2-smoke.spec.ts`

- [ ] **Step 1: E2E de ponta a ponta que falha** — `"jornada da fase 2"`: admin cria campo personalizado e etiqueta → convida um SDR com papel padrão → SDR entra, cria organização, pessoa e lead com etiqueta e campo, escreve anotação, desqualifica o lead → gestor da empresa vê tudo na visão da empresa e o SDR só vê os próprios.
- [ ] **Step 2:** ajustar o que faltar; **Step 3:** suíte completa (`pnpm lint && pnpm typecheck && pnpm test && pnpm test:db && pnpm build && pnpm test:e2e`) verde.
- [ ] **Step 4: Commit** — `docs: fechamento da fase 2`.

---

## Cobertura da spec (fase 2)

| Requisito da spec | Task |
|---|---|
| Tabelas da seção 4.2 | 1 |
| RLS com `can_access`, filhos herdam do pai | 2 |
| Duplicidade sem expor dados (5.3) | 3, 6, 7 |
| Linha do tempo unificada | 3, 8 |
| Listas com filtros, ordenação, colunas configuráveis, exportação | 5, 6, 7, 9 |
| Telas de detalhe no padrão Pipedrive | 5, 6, 7, 9 |
| Campos personalizados, etiquetas, anotações | 4, 5, 8 |
| Lead: desqualificar com motivo | 9 |
| Lead: converter em negócio | adiado para a fase 3 (ver Ajustes) |
| Reatribuir responsável com permissão | 2, 5, 6 |
| Lixeira de 30 dias, exclusão definitiva só pelo admin geral | 2, 3, 10 |
| Busca global | 3, 10 |
| Visão "Todas as empresas" nas listas | 5, 6, 7, 9 |
