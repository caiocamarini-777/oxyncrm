# Fase 4: Atividades, plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Colocar a rotina comercial dentro do CRM com medição por canal: atividades (tarefa, ligação, reunião, e-mail, mensagem) com canal obrigatório, conclusão sempre com resultado, a cadeia tarefa → reunião agendada → reunião realizada → oportunidade, regra de próxima atividade por funil e por empresa, lista e agenda, indicador de próxima atividade no kanban e na caixa de leads, e lembretes no app e por e-mail.

**Architecture:** Novas tabelas multiempresa (`activity_types`, `activity_channels`, `activity_outcomes`, `activities`, `notifications`) no padrão das fases anteriores: RLS com `can_access(..., 'activities', ...)`, guardas em trigger. A conclusão passa por uma única função no banco, `complete_activity`, que valida o resultado, cria a reunião quando o resultado agenda reunião e aplica a regra de próxima atividade, tudo numa transação. Lembretes são gerados pelo `pg_cron` numa tabela de notificações; o app mostra ao vivo via Supabase Realtime e uma rota agendada envia os e-mails pelo transporte existente (Resend em produção).

**Tech Stack:** o mesmo das fases anteriores, mais `date-fns` (com locale `ptBR`) para a agenda e Supabase Realtime no cliente.

**Spec:** `docs/superpowers/specs/2026-10-21-oxyn-crm-design.md` (seções 4.4 e 6, fase 4; indicador e filtro de atividades adiados da fase 3)

## Global Constraints

- Tudo das Global Constraints das fases 1 a 3 continua valendo (regras no banco, cores teal sem laranja/âmbar, Montserrat/Inter, PT-BR sem emoji e sem travessão, service role só em `server-only`, listas paginadas com estado na URL, datas `dd/mm/aaaa`, BRL, reutilizar o kit e os helpers).
- Horários guardados em UTC (`timestamptz`) e exibidos em `America/Sao_Paulo`; "hoje", "atrasada" e os dias da agenda são calculados nesse fuso.
- Entidade usada em `can_access`: `activities` (já existe na visibilidade dos papéis). A visibilidade é pelo responsável da atividade, como nos outros registros.
- Migrations das fases 1 a 3 continuam editáveis antes do merge, mas esta fase cria arquivos a partir de `20261024000001`.
- Não há conclusão sem resultado, em nenhum caminho (tela, ação ou API).

## Ajustes em relação à spec

- **Resultado de reunião como coluna**, não tabela: `activities.meeting_outcome` com os valores fixos `held` (Realizada), `no_show` (No-show), `rescheduled` (Remarcada), `canceled` (Cancelada). São fixos na spec e não precisam de cadastro.
- **Toda atividade precisa de ao menos um vínculo** (lead, negócio, pessoa ou organização). Sem vínculo não há como medir canal por funil nem mostrar na linha do tempo.
- **E-mail dos lembretes** sai por uma rota do app chamada pelo agendador da Vercel (`/api/cron/lembretes`, protegida por segredo), porque os e-mails já são enviados pelo app (Resend). O `pg_cron` gera as notificações; a rota só envia as pendentes. Em desenvolvimento, um script chama a mesma rota.
- **E-mail enviado como atividade concluída** fica para a fase 5 (Gmail).

## Review Focus

1. Reunião concluída exige resultado de reunião (e não resultado comum); tarefa exige resultado comum; não dá para trocar o tipo de uma atividade já concluída. Teste na Task 3.
2. Fuso: atividade às 23h30 de São Paulo aparece no dia certo na agenda e em "Hoje"; o lembrete dispara no horário certo. Teste nas Tasks 5 e 9.
3. Regra "obrigar": não exige próxima atividade quando o negócio está ganho ou perdido, ou o lead desqualificado, arquivado ou convertido; atividade ligada a lead e negócio ao mesmo tempo segue a regra do funil do negócio. Teste na Task 3.
4. Remarcar uma atividade (mudar `due_at` ou o lembrete) depois do lembrete enviado gera um novo lembrete no novo horário. Teste na Task 3.
5. Excluir (lixeira) a reunião criada pela cadeia não apaga nem altera a tarefa que a agendou; as métricas continuam contando a reunião agendada pela tarefa. Teste na Task 3.

---

## Estrutura de arquivos

```
supabase/migrations/
  20261024000001_activities_schema.sql     # tabelas, seeds, notifications, kinds da linha do tempo
  20261024000002_activities_security.sql   # RLS, guardas, extensão das funções genéricas
  20261024000003_activities_functions.sql  # complete/reopen, próxima atividade, lembretes (pg_cron), próximas por registro
supabase/tests/
  15_activities_schema.test.sql  16_activities_security.test.sql  17_activities_functions.test.sql
src/lib/activities/
  schema.ts      # activitySchema, completeSchema, meetingSchema
  time.ts        # dueStatus, dayKey, agenda grids (semana, mês), formatDue
  reminders.ts   # REMINDER_OPTIONS
  queries.ts actions.ts
src/lib/notifications/ queries.ts actions.ts
src/components/activities/
  activity-form.tsx complete-dialog.tsx activity-list.tsx agenda-week.tsx agenda-month.tsx
  activity-chip.tsx next-activity-badge.tsx
src/components/shell/notifications-bell.tsx
src/app/(app)/[empresa]/atividades/page.tsx         # ?visao=lista|semana|mes
src/app/(app)/configuracoes/atividades/page.tsx     # tipos, canais, resultados, regra de leads
src/app/api/cron/lembretes/route.ts
scripts/send-reminders.ts
vercel.json
e2e/
  activities-settings.spec.ts activities.spec.ts complete-activity.spec.ts
  agenda.spec.ts reminders.spec.ts phase4-smoke.spec.ts
```

---

### Task 1: Schema de atividades e notificações

**Files:**
- Create: `supabase/migrations/20261024000001_activities_schema.sql`
- Test: `supabase/tests/15_activities_schema.test.sql`

**Interfaces:**
- Produces (RLS ligado sem políticas; anon revogado; `truncate, references, trigger` revogados de authenticated):
  - `activity_types`: `id`, `company_id → companies cascade`, `name` (1 a 40), `is_meeting bool not null default false`, `position int not null default 0`, `active bool not null default true`, `unique(company_id, name)`.
  - `activity_channels`: `id`, `company_id`, `name` (1 a 40), `position`, `active`, `is_legacy bool not null default false` (canal "Não informado", usado só na importação), `unique(company_id, name)`.
  - `activity_outcomes`: `id`, `company_id`, `name` (1 a 60), `classification text not null` (check em `success`, `neutral`, `failure`), `books_meeting bool not null default false`, `position`, `active`, `unique(company_id, name)`.
  - `activities`: colunas comuns (`company_id`, `owner_id`, `created_by default auth.uid()`, `created_at`, `updated_at`, `deleted_at`), mais `type_id → activity_types restrict`, `channel_id → activity_channels restrict not null`, `subject text not null` (1 a 200), `description text` (até 5.000), `due_at timestamptz not null`, `duration_minutes int not null default 30` (0 a 1.440), `done bool not null default false`, `completed_at timestamptz`, `outcome_id → activity_outcomes restrict`, `meeting_outcome text` (check em `held`, `no_show`, `rescheduled`, `canceled`), `completion_note text` (até 2.000), `lead_id → leads set null`, `deal_id → deals set null`, `person_id → persons set null`, `organization_id → organizations set null`, `reminder_minutes int` (null ou 0 a 10.080), `reminder_sent_at timestamptz`, `booked_by_activity_id → activities set null`, `origin_channel_id → activity_channels set null`, `legacy bool not null default false`.
  - Checks em `activities`: `lead_id is not null or deal_id is not null or person_id is not null or organization_id is not null`; `done = (completed_at is not null)`; `not (outcome_id is not null and meeting_outcome is not null)`.
  - `notifications`: `id bigint identity pk`, `user_id uuid not null → profiles cascade`, `company_id uuid → companies cascade`, `kind text not null` (check em `activity_reminder`), `activity_id → activities cascade`, `title text not null`, `body text`, `due_at timestamptz`, `created_at timestamptz not null default now()`, `read_at timestamptz`, `email_sent_at timestamptz`, `unique(activity_id, kind, due_at)` (um lembrete por horário).
  - `guard_same_company` (create or replace) cobre `activities` (tipo, canal, resultado, lead, negócio, pessoa, organização, `booked_by_activity_id`, `origin_channel_id`).
  - `timeline_events.kind` ganha `activity_scheduled` e `activity_completed`.
  - Índices: `activities(company_id, owner_id, due_at) where deleted_at is null and not done`, `activities(lead_id)`, `activities(deal_id)`, `activities(person_id)`, `activities(organization_id)`, `activities(due_at) where not done and reminder_minutes is not null and reminder_sent_at is null`, `notifications(user_id, read_at, created_at desc)`.
  - `notifications` incluída na publicação `supabase_realtime`.
  - Seeds (`seed_company_activities(company uuid)`, idempotente, no gatilho de nova empresa e em backfill): tipos Tarefa, Ligação, Reunião (`is_meeting`), E-mail, Mensagem; canais E-mail, Telefone, LinkedIn, WhatsApp, Videochamada, Presencial e "Não informado" (`is_legacy`, inativo); resultados: Sem resposta (failure), Número ou perfil inválido (failure), Respondeu, sem interesse (failure), Respondeu, pediu retorno (neutral), Conversa realizada (success), Reunião agendada (success, `books_meeting`).
- [ ] **Step 1: pgTAP que falha** (`15_activities_schema.test.sql`): `has_table` nas 5 tabelas; atividade sem vínculo → 23514; `done` sem `completed_at` → 23514; `outcome_id` e `meeting_outcome` juntos → 23514; `meeting_outcome = 'x'` → 23514; canal de outra empresa → `OXYN_CROSS_COMPANY`; empresa nova recebe 5 tipos (1 reunião), 7 canais (1 legado), 6 resultados (1 `books_meeting`); `notifications` está em `supabase_realtime`; TRUNCATE falso para authenticated nas 5 tabelas.
- [ ] **Step 2 a 5:** falhar, migration + `pnpm db:migrate`, passar (01 a 15), commit `feat(db): schema de atividades e notificações`.

---

### Task 2: Segurança de atividades

**Files:**
- Create: `supabase/migrations/20261024000002_activities_security.sql`
- Test: `supabase/tests/16_activities_security.test.sql`

**Interfaces:**
- Políticas de `activities` no padrão de `leads` com a entidade `activities` (select com regra de lixeira; insert com `created_by = auth.uid()`, `deleted_at is null`, responsável membro e reassign; update com edit, ou delete na lixeira; delete só admin geral). Para criar ou editar uma atividade vinculada, o usuário precisa conseguir ler cada registro vinculado (`can_read_record` para lead, negócio, pessoa e organização), checado num trigger `guard_activity_links` (`OXYN_LINK_FORBIDDEN`).
- `guard_record_update` ligado em `activities` (empresa imutável, reassign, lixeira, `created_by/created_at`). `record_ref`, `reassign_record`, `purge_records_internal`, `purge_record` e `purge_trash` passam a aceitar `activities`.
- Tabelas de configuração (`activity_types`, `activity_channels`, `activity_outcomes`): select `has_company_access`, escrita `can_manage_company_lists` (admin geral ou `manage_custom_fields`).
- `notifications`: select e update (só `read_at`) para `user_id = auth.uid()`; insert e delete só por funções `security definer`.
- [ ] **Step 1: pgTAP que falha:** visibilidade por papel (own/team/company); `bruno` não cria atividade ligada a um lead que não lê (`OXYN_LINK_FORBIDDEN`); reassign via `reassign_record('activities', …)`; lixeira; usuário só vê e marca como lidas as próprias notificações e não insere notificação; configuração só com permissão.
- [ ] **Step 2 a 5:** falhar, implementar, passar (01 a 16), commit `feat(db): RLS e guardas de atividades`.

---

### Task 3: Conclusão, cadeia de reunião, próxima atividade e lembretes no banco

**Files:**
- Create: `supabase/migrations/20261024000003_activities_functions.sql`
- Test: `supabase/tests/17_activities_functions.test.sql`

**Interfaces:**
- `complete_activity(p_id uuid, p_outcome_id uuid default null, p_meeting_outcome text default null, p_note text default null, p_meeting jsonb default null, p_next jsonb default null) returns jsonb` (`security invoker`, o RLS vale):
  1. A atividade precisa estar aberta, fora da lixeira, e o usuário precisa poder editá-la.
  2. Tipo reunião exige `p_meeting_outcome`; outros tipos exigem `p_outcome_id` ativo da mesma empresa. Faltando → `OXYN_OUTCOME_REQUIRED`.
  3. Resultado com `books_meeting` exige `p_meeting` (`{ "due_at", "duration_minutes", "subject", "type_id"? }`); cria a reunião com o tipo reunião da empresa, os mesmos vínculos e responsável, `booked_by_activity_id = p_id`, `channel_id` e `origin_channel_id` = canal da tarefa. Faltando → `OXYN_MEETING_REQUIRED`.
  4. Regra de próxima atividade: o registro de referência é o negócio (se houver `deal_id`), senão o lead. Regra = `pipelines.next_activity_rule` do negócio, ou `companies.settings->>'lead_next_activity_rule'` (padrão `off`). Com `require`, registro aberto (negócio `open`; lead `open`) e sem outra atividade aberta para ele após a conclusão (contando a reunião criada no passo 3), exige `p_next` (`{ "type_id", "channel_id", "subject", "due_at", "duration_minutes", "reminder_minutes"? }`), senão `OXYN_NEXT_ACTIVITY_REQUIRED`. Com `p_next`, cria a próxima atividade com os mesmos vínculos.
  5. Marca `done`, `completed_at`, resultado e nota; grava `activity_completed` na linha do tempo dos registros vinculados.
  6. Devolve `{ "meeting_id": …, "next_id": …, "rule": "off|suggest|require" }`.
- `reopen_activity(p_id uuid) returns void`: desfaz a conclusão (limpa resultado, nota e `completed_at`); a reunião criada pela cadeia não é apagada.
- **Trava de conclusão direta:** trigger impede mudar `done`, `completed_at`, `outcome_id` ou `meeting_outcome` fora das duas funções (flag de sessão `oxyn.completing` combinada com `pg_trigger_depth()`), e impede trocar `type_id` de atividade concluída (`OXYN_FORBIDDEN_FIELD`).
- **Linha do tempo:** inserir atividade grava `activity_scheduled` nos registros vinculados (`{activity_id, type, due_at}`); concluir grava `activity_completed` (`{activity_id, outcome, classification, meeting_outcome}`).
- **Lembretes:** mudar `due_at` ou `reminder_minutes` zera `reminder_sent_at`. Função `generate_activity_reminders() returns int` (`security definer`, execute só para postgres) insere em `notifications` uma linha por atividade aberta, fora da lixeira, com `due_at - reminder_minutes <= now()` e `reminder_sent_at is null` (título "Lembrete: <assunto>", `due_at`), marca `reminder_sent_at`; agendada no `pg_cron` a cada minuto (`oxyn-activity-reminders`, idempotente).
- **Próximas atividades por registro:** `next_activity_for(p_entity text, p_ids uuid[]) returns table(record_id uuid, activity_id uuid, due_at timestamptz, subject text, overdue boolean)` (`security invoker`, `stable`, inlinável): a atividade aberta mais próxima de cada lead ou negócio pedido. Usada no kanban e na caixa de leads.
- `deals_with_overdue_activity(p_company uuid) returns setof uuid` (invoker): negócios com atividade aberta atrasada (filtro do kanban).
- [ ] **Step 1: pgTAP que falha:**
  - Concluir tarefa sem resultado → `OXYN_OUTCOME_REQUIRED`; reunião com resultado comum → `OXYN_OUTCOME_REQUIRED`; reunião com `held` → ok. (Review Focus 1.)
  - "Reunião agendada" sem `p_meeting` → `OXYN_MEETING_REQUIRED`; com `p_meeting` → reunião criada com `booked_by_activity_id` e `origin_channel_id` = LinkedIn.
  - Funil com `require`: concluir sem próxima → `OXYN_NEXT_ACTIVITY_REQUIRED`; com `p_next` → ok; negócio ganho → não exige; atividade com lead e negócio segue a regra do funil; lead com regra `require` na empresa → exige; lead desqualificado → não exige; a reunião criada no mesmo passo conta como próxima. (Review Focus 3.)
  - `update activities set done = true` direto → bloqueado; trocar `type_id` de concluída → `OXYN_FORBIDDEN_FIELD`.
  - `reopen_activity` limpa resultado e mantém a reunião criada.
  - Lixeira na reunião criada não altera a tarefa de origem. (Review Focus 5.)
  - Lembrete: `generate_activity_reminders()` cria 1 notificação e marca `reminder_sent_at`; segunda chamada não duplica; remarcar `due_at` zera e gera nova notificação no novo horário. (Review Focus 4.)
  - `next_activity_for('deals', …)` devolve a mais próxima e marca `overdue`; `deals_with_overdue_activity` só devolve negócios com atrasada.
  - Linha do tempo recebe `activity_scheduled` e `activity_completed`.
- [ ] **Step 2 a 5:** falhar, implementar, passar (01 a 17), commit `feat(db): conclusão, reunião, próxima atividade e lembretes`.

---

### Task 4: Configurações de atividades

**Files:**
- Create: `src/app/(app)/configuracoes/atividades/page.tsx`, componentes em `src/components/settings/`
- Modify: navegação de configurações; ações de listas genéricas aceitam `kind` `activity_type`, `activity_channel`, `activity_outcome` (ou ações dedicadas quando houver campos extras)
- Test: `e2e/activities-settings.spec.ts`, unitários dos schemas

**Comportamento:** página com seletor de empresa (`?empresa=`) e quatro blocos: **Tipos** (nome, "É reunião", ativo, ordem), **Canais** (nome, ativo, ordem; o canal legado aparece só com o selo "Importação" e não pode ser ativado), **Resultados** (nome, classificação "Sucesso", "Neutro" ou "Insucesso", "Agenda reunião", ativo, ordem) e **Regra de próxima atividade para leads** ("Desligada", "Sugerir", "Obrigar", gravada em `companies.settings.lead_next_activity_rule`). Itens inativos somem dos formulários e continuam nas atividades existentes. A empresa precisa manter ao menos um tipo reunião ativo e um resultado com "Agenda reunião" ativo (mensagem: "Mantenha ao menos um tipo de reunião ativo." / "Mantenha ao menos um resultado que agenda reunião.").
- [ ] **Step 1: E2E que falha:** criar canal "Indicação"; criar resultado neutro; desativar canal (some do formulário de atividade, checado via DB até a Task 6); mudar a regra de leads para "Obrigar" e conferir em `companies.settings`; tentar desativar o único tipo reunião → mensagem.
- [ ] **Step 2 a 4:** falhar, implementar, passar. **Step 5:** commit `feat(config): tipos, canais e resultados de atividades`.

---

### Task 5: Domínio de atividades (lib)

**Files:**
- Create: `src/lib/activities/{schema,time,reminders,queries,actions}.ts`, `src/lib/notifications/{queries,actions}.ts`
- Modify: `src/lib/db-errors.ts`, `src/lib/timeline/{describe,queries}.ts`
- Test: `src/lib/activities/{schema,time}.test.ts`, `src/lib/timeline/queries.test.ts`

**Interfaces:**
- `activitySchema` (tipo, canal, assunto 1 a 200, descrição, data e hora `YYYY-MM-DDTHH:mm` no fuso de São Paulo convertida para UTC, duração, lembrete de `REMINDER_OPTIONS`, responsável, vínculos com ao menos um: "Vincule a atividade a um lead, negócio, pessoa ou organização."), `completeSchema` (resultado ou resultado de reunião conforme o tipo, nota até 2.000, `meeting` e `next` opcionais validados com o mesmo `activitySchema` parcial).
- `REMINDER_OPTIONS`: Sem lembrete, Na hora, 15 minutos antes, 30 minutos antes, 1 hora antes, 1 dia antes.
- `time.ts`: `TZ = "America/Sao_Paulo"`; `toUtc(localIso)`, `toLocalInput(utcIso)`; `dueStatus(dueAt, done, now): "done" | "overdue" | "today" | "upcoming"`; `dayKey(utcIso)` (`YYYY-MM-DD` em São Paulo); `weekGrid(anchor)` (7 dias de segunda a domingo) e `monthGrid(anchor)` (semanas completas cobrindo o mês); `formatDue(utcIso, now)` ("Hoje, 14:30", "Amanhã, 09:00", "qua., 23/10, 10:00", "Atrasada há 2 dias").
- Queries: `listActivities(scope, query & { tab: "overdue" | "today" | "upcoming" | "done"; type[]; channel[]; team[] })`, `getAgenda(scope, from, to, filters)`, `getActivitiesFor(entity, id)` (abertas e concluídas, para a linha do tempo), `nextActivitiesFor(entity, ids)` (RPC `next_activity_for`).
- Actions: `createActivity`, `updateActivity`, `completeActivity(id, input)` (RPC; devolve `{ ok: false, code: "next_required" | "meeting_required" | "outcome_required" }` quando aplicável, mais `rule` para a UI decidir sugerir), `reopenActivity`, e lixeira pelas ações genéricas.
- Notificações: `listNotifications(limit)`, `markNotificationRead(id)`, `markAllNotificationsRead()`.
- `translateDbError`: `OXYN_OUTCOME_REQUIRED` "Informe o resultado da atividade.", `OXYN_MEETING_REQUIRED` "Agende a reunião para concluir com este resultado.", `OXYN_NEXT_ACTIVITY_REQUIRED` "Agende a próxima atividade para concluir.", `OXYN_LINK_FORBIDDEN` "Você não tem acesso a um dos registros vinculados.".
- `describeEvent`: `activity_scheduled` → "Agendou <tipo>: <assunto> para <data>"; `activity_completed` → "Concluiu <tipo>: <assunto> (<resultado>)" e, para reunião, "(Realizada | No-show | Remarcada | Cancelada)".
- [ ] **Step 1: Unitários que falham:** `dueStatus` com atividade às 23h30 de São Paulo de hoje e de ontem em relação a um `now` UTC do dia seguinte (Review Focus 2); `dayKey("2026-10-24T02:30:00Z") = "2026-10-23"`; `weekGrid` começa na segunda; `monthGrid` de outubro de 2026 tem 5 semanas; `formatDue` nos quatro formatos; `activitySchema` sem vínculo → mensagem; `completeSchema` de reunião sem resultado de reunião → erro; `describeEvent` dos dois novos tipos.
- [ ] **Step 2 a 4:** falhar, implementar, passar. **Step 5:** commit `feat(atividades): domínio, consultas e ações`.

---

### Task 6: Criar e concluir atividades nos registros

**Files:**
- Create: `src/components/activities/{activity-form,complete-dialog,activity-chip}.tsx`
- Modify: `src/components/records/{record-tabs,timeline}.tsx` (aba "Atividade" ativa; seção "Planejado" lista as atividades abertas com o check de concluir), páginas de detalhe de leads, pessoas, organizações e negócios (passam os vínculos)
- Test: `e2e/complete-activity.spec.ts`

**Comportamento:**
- Aba **Atividade**: formulário com tipo (botões com ícone), canal (obrigatório), assunto (sugerido pelo tipo, ex.: "Ligação"), data e hora, duração, lembrete, responsável e vínculos (preenchidos com o registro atual; dá para adicionar pessoa ou organização relacionada).
- **Planejado** na linha do tempo: atividades abertas ordenadas por data, cada uma com chip de status (vermelho "Atrasada", teal "Hoje", cinza nas próximas), canal, responsável e um círculo de concluir.
- **Concluir** abre o `CompleteDialog`:
  - Tarefa, ligação, e-mail, mensagem: lista de resultados agrupada por classificação (Sucesso, Neutro, Insucesso) e nota.
  - Escolher um resultado que agenda reunião expande "Agendar reunião" (data, hora, duração, assunto "Reunião com <pessoa ou organização>"); o botão só habilita com a reunião preenchida.
  - Reunião: escolha entre Realizada, No-show, Remarcada e Cancelada e nota. Remarcada sugere criar uma nova reunião.
  - Depois de concluir, conforme `rule`: `suggest` abre o formulário de próxima atividade já preenchido (dá para fechar); `require` mostra o mesmo formulário dentro do dialog e não conclui sem ele (o servidor confirma com `next_required`).
- [ ] **Step 1: E2E que falha:** criar tarefa no LinkedIn num lead; concluir exige resultado; concluir com "Reunião agendada" exige agendar e cria a reunião (aparece em Planejado com o canal herdado); concluir a reunião como Realizada; funil com "Obrigar" não conclui sem próxima atividade e conclui com ela; "Sugerir" abre o formulário que pode ser fechado; atividade atrasada mostra o chip vermelho.
- [ ] **Step 2 a 4:** falhar, implementar, passar. **Step 5:** commit `feat(atividades): criar e concluir nos registros`.

---

### Task 7: Página de atividades (lista e agenda)

**Files:**
- Create: `src/app/(app)/[empresa]/atividades/page.tsx`, `src/components/activities/{activity-list,agenda-week,agenda-month}.tsx`
- Modify: `src/lib/nav.ts` (`CURRENT_PHASE = 4`; Atividades habilitado; o item desabilitado de exemplo passa a ser "E-mail"), `src/lib/nav.test.ts`, `e2e/shell.spec.ts`
- Test: `e2e/activities.spec.ts`, `e2e/agenda.spec.ts`

**Comportamento:**
- `?visao=lista` (padrão): abas **Atrasadas** (com contador vermelho), **Hoje**, **Próximas** e **Concluídas**; colunas: concluir, tipo, assunto, vínculo principal (link), canal, data, responsável; filtros por tipo, canal, responsável e equipe; "Nova atividade" (o formulário exige escolher um vínculo).
- `?visao=semana` e `?visao=mes`: grade (segunda a domingo) com navegação "Anterior", "Hoje" e "Próxima" (`?data=YYYY-MM-DD`); na semana, cada dia lista as atividades por horário; no mês, até 3 por dia e "+N" que abre o dia. Atrasadas em vermelho, concluídas riscadas. Clicar abre um popover com detalhes, link do registro e o botão Concluir (mesmo `CompleteDialog`).
- Na visão "Todas as empresas" a lista e a agenda juntam as empresas e mostram a empresa no item.
- [ ] **Step 1: E2E que falha:** abas trazem as atividades certas (criadas via service role com datas relativas); filtro por canal; agenda semanal mostra a atividade das 23h30 no dia correto (Review Focus 2); navegação de semana e mês; concluir pela agenda; usuário padrão só vê as próprias.
- [ ] **Step 2 a 4:** falhar, implementar, passar. **Step 5:** commit `feat(atividades): lista e agenda`.

---

### Task 8: Próxima atividade no kanban e na caixa de leads

**Files:**
- Create: `src/components/activities/next-activity-badge.tsx`
- Modify: `src/lib/deals/queries.ts` (`getBoard` traz a próxima atividade de cada negócio via `next_activity_for`; filtro "Atividades atrasadas" via `deals_with_overdue_activity`), `src/components/deals/{deal-card,deals-toolbar}.tsx`, `src/lib/leads/queries.ts` e colunas da caixa de leads (Próxima atividade, Canal da última atividade concluída)
- Test: ampliar `e2e/kanban.spec.ts` e `e2e/leads.spec.ts`

**Comportamento:** card do kanban mostra um ícone de relógio: vermelho com "Atrasada" quando há atividade aberta atrasada, cinza com "Sem atividade" quando não há nenhuma aberta, e a data curta ("Hoje", "Amanhã", "23/10") nos demais casos (tooltip com o assunto). Filtro "Atividades atrasadas" na barra do kanban e da lista de negócios. Caixa de leads ganha as colunas "Próxima atividade" (mesmo badge) e "Último canal".
- [ ] **Step 1: E2E que falha:** negócio com atividade atrasada mostra o badge vermelho e aparece no filtro; negócio sem atividade mostra "Sem atividade"; lead mostra a próxima atividade e o último canal.
- [ ] **Step 2 a 4:** falhar, implementar, passar. **Step 5:** commit `feat(atividades): próxima atividade no kanban e nos leads`.

---

### Task 9: Lembretes (notificações no app e e-mail)

**Files:**
- Create: `src/components/shell/notifications-bell.tsx`, `src/app/api/cron/lembretes/route.ts`, `scripts/send-reminders.ts`, `vercel.json`
- Modify: topbar (sino ao lado do tema), `src/lib/email/templates.ts` (`reminderEmail`), `.env.example` (`CRON_SECRET`), `README.md` (seção de lembretes)
- Test: `e2e/reminders.spec.ts`, unitário do template

**Comportamento:**
- **Sino:** contador de não lidas; lista das últimas 20 (título, horário formatado, link para o registro da atividade); "Marcar todas como lidas". Assinatura do Supabase Realtime em `notifications` filtrada por `user_id`; nova notificação mostra um toast "Lembrete: <assunto>" com o botão "Abrir".
- **E-mail:** `GET /api/cron/lembretes` exige `Authorization: Bearer ${CRON_SECRET}` (401 sem ele); usa o cliente service role (`server-only`) para ler notificações com `email_sent_at is null` dos últimos 60 minutos, envia `reminderEmail` (assunto "Lembrete: <assunto>", horário em São Paulo, link para o registro) pelo `sendEmail` existente e marca `email_sent_at`. Idempotente. `vercel.json` agenda a rota a cada 5 minutos. `pnpm reminders:send` chama a rota localmente.
- [ ] **Step 1: E2E que falha:** atividade com lembrete "Na hora" e `due_at` já passado → chamar `generate_activity_reminders()` via DB helper → o sino mostra 1 e o toast aparece sem recarregar (Realtime); marcar como lida zera; chamar a rota com o segredo grava o e-mail no outbox (`e2e/helpers/outbox.ts`) e não duplica numa segunda chamada; sem o segredo → 401.
- [ ] **Step 2 a 4:** falhar, implementar, passar. **Step 5:** commit `feat(atividades): lembretes no app e por e-mail`.

---

### Task 10: Fechamento da fase 4

**Files:**
- Modify: `README.md` (módulo Atividades), novo `docs/superpowers/followups/<data>-fase-4-pendencias.md` (incluindo "Notas para a fase 6": consultas do funil por canal, com tentativas = atividades concluídas em leads por canal, reuniões agendadas = resultados `books_meeting`, realizadas = reuniões `held` por `origin_channel_id`, oportunidades = leads convertidos com reunião realizada de origem, ganhos = negócios ganhos desses leads)
- Test: `e2e/phase4-smoke.spec.ts`

- [ ] **Step 1: E2E de jornada:** SDR cria tarefa no LinkedIn num lead → conclui com "Reunião agendada" e agenda a reunião → conclui a reunião como Realizada → converte o lead em negócio num funil com regra "Obrigar" → ao concluir uma ligação no negócio, o dialog exige a próxima atividade → o card do kanban mostra a próxima atividade; uma atividade atrasada deixa o badge vermelho; um lembrete aparece no sino.
- [ ] **Step 2:** suíte completa verde (`pnpm lint && pnpm typecheck && pnpm test && pnpm test:db && pnpm build && pnpm test:e2e`).
- [ ] **Step 3: Commit** — `docs: fechamento da fase 4`.

---

## Cobertura da spec (fase 4)

| Requisito | Task |
|---|---|
| Tabelas da seção 4.4 (resultado de reunião como coluna) | 1 |
| Canal obrigatório, vínculos | 1, 5, 6 |
| Conclusão exige resultado (todos os caminhos) | 3, 6 |
| Resultado que agenda reunião cria a reunião com canal de origem | 3, 6 |
| Resultado de reunião (Realizada, No-show, Remarcada, Cancelada) | 3, 6 |
| Próxima atividade: off, suggest, require (funil e leads da empresa) | 3, 4, 6 |
| Lista (atrasadas, hoje, próximas) e agenda semanal e mensal | 7 |
| Atrasadas em vermelho na agenda, no card do kanban e no painel | 6, 7, 8 |
| Lembretes no app (Realtime) e por e-mail (pg_cron) | 3, 9 |
| Indicador e filtro de atividades no kanban (adiados da fase 3) | 8 |
