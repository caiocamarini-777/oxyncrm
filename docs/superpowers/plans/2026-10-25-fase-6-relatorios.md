# Fase 6: Relatórios, dashboards e metas. Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** construtor de relatórios com spec controlada, relatórios prontos de canal, conversão, forecast e receita, dashboards com grade de widgets compartilháveis com usuários e por link público, e metas por empresa, usuário ou equipe.

**Architecture:**
- **Motor de relatórios.** O motor roda no banco: `run_report(p_spec jsonb, p_companies uuid[], p_viewer uuid)` é `security definer` e traduz a spec em SQL a partir de uma lista fechada de bases, campos, métricas e agrupamentos. Ele aplica a visibilidade de `p_viewer` com `can_access_for(viewer, company, entity, owner, 'read')`, uma variante de `can_access` com usuário explícito.
- **Quem pode chamar.** Nenhum cliente chama `run_report` direto. O cliente chama `run_report_self(spec, companies)`, que usa `auth.uid()`, ou `run_widget(widget_id, filters)`. `run_widget` decide o alcance: o próprio usuário quando o dashboard não é compartilhado com ele, ou o criador quando o acesso vem de compartilhamento. Links públicos passam por `run_widget_public(token, widget_id, filters)`, que só o service role executa, a partir de uma rota do Next fora da área logada.
- **Interface.** Gráficos com Recharts, grade de dashboard com dnd-kit (ordem e tamanho em colunas e linhas da grade) e metas calculadas por função.

**Tech Stack:** Next.js 16 App Router (Cache Components), Supabase Postgres 17 com RLS e pgTAP, zod 4, Recharts 3 (nova dependência), dnd-kit (já instalado), Vitest e Playwright.

**Spec:** `docs/superpowers/specs/2026-10-21-oxyn-crm-design.md`, seções 4.6, 5.3 (Dashboards) e 6 (Fase 6). Também valem as "Notas para a fase 6" de `docs/superpowers/followups/2026-10-23-fase-3-pendencias.md` e de `docs/superpowers/followups/2026-10-24-fase-4-pendencias.md`.

## Global Constraints

- Interface em PT-BR. Sem emoji e sem travessão (em dash) em textos, comentários de interface e mensagens.
- Marca: teal `#1A82A2`, `#6498A8`, `#75ACBA`; fundos escuros `#111D17`, `#06090F`, `#0C0C0C`. Nunca laranja ou âmbar. Paleta dos gráficos: tons de teal e neutros. Vermelho neutro só para valores negativos ou perdas.
- Fontes Montserrat (títulos) e Inter (texto).
- Regras vivem no banco. Toda consulta de relatório passa pelas funções do banco, sem SQL livre e sem montar consulta no front.
- Migrações novas a partir de `20261025000001`. Migrações já aplicadas são imutáveis. Para mudar uma função, use `create or replace` sobre o corpo mais recente.
- Funções `security definer` com `set search_path = public, pg_temp`. Revogue `execute` de `public, anon` e conceda só o necessário.
- Next.js 16:
  - `await connection()` antes de ler relógio ou sessão.
  - `export const instant = false` nas páginas que precisam de 404 real.
  - Sem `Date.now` em render (regra react-hooks/purity).
  - Middleware em `proxy.ts` / `src/lib/supabase/middleware.ts`.
- Fuso de exibição `America/Sao_Paulo`, via `src/lib/activities/time.ts`.
- Permissões do papel (`roles.permissions.settings`):
  - `view_reports` libera o menu Relatórios e os relatórios.
  - `create_dashboards` libera criar dashboards.
  - `share_dashboards` libera compartilhar.
  - O admin geral pode tudo.
- A base "e-mails" fica para quando a fase 5 existir. Não entra nesta fase. Registrar nos follow-ups.
- Commits em português no estilo convencional, com o trailer do agente.

## Review Focus

- **Escopo do compartilhamento.** Um destinatário de dashboard compartilhado vê os números do criador, mas só dos widgets daquele dashboard. Pedir outro `widget_id` ou outra spec com o mesmo acesso deve falhar. Teste em pgTAP na Task 4.
- **Filtros só restringem.** Quem recebe pode filtrar por período, empresa, usuário e equipe. Uma empresa fora das empresas do criador, ou um período maior que o do widget, nunca amplia o resultado. Teste em pgTAP na Task 4.
- **Spec maliciosa ou inválida.** Campo fora da lista, operador desconhecido, valor com SQL, agrupamento inexistente ou spec vazia devem gerar `OXYN_INVALID_REPORT`, nunca erro de sintaxe nem consulta executada. Teste em pgTAP na Task 2 e em Vitest no schema da Task 5.
- **Link público revogado ou expirado.** Deve devolver 404 na rota pública, sem revelar se o token existiu. O token nunca é guardado em claro. Teste em pgTAP na Task 4 e em E2E na Task 8.
- **Divisões por zero e períodos vazios.** Taxa de conversão sem denominador, média sem linhas e mês sem dados devem mostrar 0 ou "sem dados", sem erro nem NaN. Teste em pgTAP na Task 3 e em Vitest na formatação da Task 5.

---

### Task 1: Schema de relatórios, dashboards e metas, e visibilidade com usuário explícito

**Files:**
- Create: `supabase/migrations/20261025000001_reports_schema.sql`
- Test: `supabase/tests/24_reports_schema.test.sql`

**Interfaces:**
- Produces:
  - Tabelas:
    - `reports(id, company_id null, owner_id, name, spec jsonb, created_at, updated_at)`.
    - `dashboards(id, owner_id, name, default_filters jsonb, created_at, updated_at)`.
    - `dashboard_widgets(id, dashboard_id, report_id null, spec jsonb null, title, position int, col_span int 1..4, row_span int 1..3)`, com check: `report_id` ou `spec` presente, nunca os dois.
    - `dashboard_shares(dashboard_id, user_id, primary key)`.
    - `dashboard_share_links(id, dashboard_id, token_hash text unique, created_by, created_at, expires_at null, revoked_at null)`.
    - `goals(id, company_id, target_kind 'company'|'user'|'team', target_user_id null, target_team_id null, metric, period 'week'|'month'|'quarter', starts_on date, target_value numeric > 0, created_by, created_at)`. Checks de coerência entre `target_kind` e os ids.
    - Métricas de meta: `meetings_booked`, `meetings_held`, `opportunities_created`, `won_value`, `won_mrr`, `activities_done`.
    - `starts_on` alinhado ao período: segunda-feira para semana, dia 1 para mês, dia 1 de janeiro, abril, julho ou outubro para trimestre.
  - Funções `security definer` e `stable`, com `execute` só para o dono e para o service role (revogado de `public, anon, authenticated`):
    - `is_super_admin_for(p_user uuid) returns boolean`
    - `role_permissions_for(p_user uuid, p_company uuid) returns jsonb`
    - `shares_team_for(p_user uuid, p_other uuid) returns boolean`
    - `can_access_for(p_user uuid, p_company uuid, p_entity text, p_owner uuid, p_action text) returns boolean`. Mesma lógica de `can_access`, mas com o usuário explícito e exigindo `profiles.active` desse usuário.
    - `has_report_setting(p_company uuid, p_setting text) returns boolean`, concedida a `authenticated`. Verdadeira para o admin geral ou quando `role_permissions(p_company)->'settings'->>p_setting = 'true'`.
  - RLS:
    - `reports`: o dono lê e escreve (com `company_id` nulo ou com `has_report_setting(company_id,'view_reports')`), e o admin geral também.
    - `dashboards`: o dono lê e escreve, o admin geral também, e quem está em `dashboard_shares` só lê. Criar exige `create_dashboards` em pelo menos uma empresa acessível ou ser admin geral. Faça isso com uma função `can_create_dashboards()`.
    - `dashboard_widgets`: herda do dashboard. Só o dono escreve.
    - `dashboard_shares`: só o dono do dashboard escreve e só com `share_dashboards`; o destinatário precisa ser um usuário ativo. O dono e o destinatário leem a própria linha.
    - `dashboard_share_links`: só o dono do dashboard, com `share_dashboards`. `token_hash` nunca é exposto em select para `authenticated`; use uma view ou revogue a coluna.
    - `goals`: leitura para quem tem `has_company_access`. Escrita só para o admin geral.

- [ ] **Step 1: Escrever o teste pgTAP `24_reports_schema.test.sql`.** Fixtures no padrão de `supabase/tests/19_activities_functions_fixes.test.sql`, com `pg_temp.u`, `as_user` e `as_pg`. Asserções:
  - `can_access_for` reproduz a matriz de `can_access` para own, team e company, admin geral, sem membership e usuário inativo.
  - Usuário sem `view_reports` não insere relatório com `company_id` da empresa.
  - Sem `create_dashboards`, o insert em `dashboards` falha.
  - O destinatário lê o dashboard compartilhado e não o altera.
  - Sem `share_dashboards`, o insert em `dashboard_shares` falha.
  - Usuário comum não lê `token_hash`.
  - Insert de `goals` por não admin falha.
  - `starts_on` desalinhado viola o check.
  - Widget sem `report_id` e sem `spec` viola o check.
- [ ] **Step 2: Rodar `pnpm test:db` e ver o arquivo 24 falhar** porque as tabelas ainda não existem.
- [ ] **Step 3: Escrever a migração** com as tabelas, checks, índices (`dashboard_widgets(dashboard_id, position)` e `goals(company_id, period, starts_on)`), funções, grants e RLS descritos acima.
- [ ] **Step 4: Rodar `pnpm db:migrate` e depois `pnpm test:db`.** Esperado: todos os arquivos verdes.
- [ ] **Step 5: Commit** com a mensagem `feat(db): schema de relatórios, dashboards e metas`.

### Task 2: Motor de relatórios personalizados no banco

**Files:**
- Create: `supabase/migrations/20261025000002_report_engine.sql`
- Test: `supabase/tests/25_report_engine.test.sql`

**Interfaces:**
- Consumes: `can_access_for` (Task 1).
- Produces:
  - `run_report(p_spec jsonb, p_companies uuid[], p_viewer uuid) returns jsonb`. É `security definer`, com `execute` revogado de todos exceto o dono. Devolve `{"columns":[...], "rows":[[...]], "total": number|null}`.
  - `run_report_self(p_spec jsonb, p_companies uuid[]) returns jsonb`, concedida a `authenticated`. Antes de chamar `run_report(spec, companies, auth.uid())`, exige:
    - usuário ativo;
    - toda empresa de `p_companies` com `has_company_access`;
    - `has_report_setting(company, 'view_reports')` em cada uma.
  - Formato da spec, que é a fonte única e espelhada em zod na Task 5:
    ```json
    {
      "kind": "custom",
      "base": "leads|deals|activities|revenue|stage_history",
      "metric": {"op": "count|sum|avg|conversion_rate|avg_days", "field": "<campo numérico ou null>"},
      "group_by": "<dimensão ou null>",
      "filters": [{"field": "<campo>", "op": "eq|in|gte|lte|between|is_null|not_null", "value": "..."}],
      "period": {"field": "<campo de data>", "from": "YYYY-MM-DD", "to": "YYYY-MM-DD"},
      "chart": "number|bar|line|funnel|pie|table"
    }
    ```
  - Lista fechada de campos por base:

    | Base | Datas | Somáveis | Dimensões |
    |---|---|---|---|
    | leads | `created_at`, `converted_at` | `estimated_value` | `owner`, `team`, `company`, `status`, `source`, `label`, `month`, `custom:<key>` (só custom fields do tipo select) |
    | deals | `created_at`, `won_at`, `lost_at`, `expected_close_date` | `contract_value`, `setup_total`, `mrr`, `estimated_value` | `owner`, `team`, `company`, `pipeline`, `stage`, `status`, `lost_reason`, `label`, `month`, `custom:<key>` |
    | activities | `due_at`, `completed_at` | nenhum | `owner`, `team`, `company`, `type`, `channel`, `outcome`, `outcome_classification`, `meeting_outcome`, `month` |
    | revenue (`deal_revenue_schedule` junto com `deals`) | `month` | `setup`, `mrr`, `total` (setup + mrr) | `company`, `pipeline`, `owner`, `deal_status`, `month` |
    | stage_history | `moved_at` | nenhum | `pipeline`, `from_stage`, `to_stage`, `owner`, `month` |

  - Métricas:
    - `avg_days` vale para `stage_history` (`seconds_in_previous / 86400`), para deals (`won_at - created_at`) e para leads (`converted_at - created_at`).
    - `conversion_rate` vale para leads (convertidos / total) e para deals (ganhos / (ganhos + perdidos)). Devolve um número de 0 a 100 com uma casa decimal, ou 0 quando o denominador é 0.
  - `month` agrupa por `date_trunc('month', <period.field> at time zone 'America/Sao_Paulo')`.
  - Exclui `deleted_at is not null` e, na base revenue, negócios perdidos (`deals.status <> 'lost'`).
  - A visibilidade é aplicada uma única vez por linha da entidade base com `can_access_for(p_viewer, company_id, entidade, owner_id, 'read')`. Revenue e stage_history usam o negócio dono.
  - Qualquer violação da lista gera `OXYN_INVALID_REPORT`. Valores entram sempre por parâmetro (`format('%L')` ou `using`), nunca concatenados.
  - Limite de 500 linhas de saída.

- [ ] **Step 1: Escrever `25_report_engine.test.sql`.** Fixtures: 2 empresas, vendedor own, gestor company, leads, negócios, atividades e cronograma com datas conhecidas. Asserções:
  - count de leads por `owner` para o vendedor só conta os dele;
  - o gestor vê todos;
  - `sum(contract_value)` de negócios ganhos por `month` dá o valor exato;
  - `conversion_rate` de leads com 4 leads e 1 convertido dá 25.0;
  - `conversion_rate` sem leads dá 0;
  - revenue ignora negócio perdido;
  - `avg_days` em stage_history dá o valor esperado;
  - empresa fora do acesso em `run_report_self` gera `OXYN_FORBIDDEN`;
  - sem `view_reports` gera `OXYN_FORBIDDEN`;
  - spec com `field` igual a `"id; drop table leads"` gera `OXYN_INVALID_REPORT`;
  - base desconhecida, operador desconhecido e spec `{}` geram `OXYN_INVALID_REPORT`;
  - `authenticated` não executa `run_report` direto, e a chamada gera erro de permissão.
- [ ] **Step 2: Rodar `pnpm test:db`** e ver o arquivo 25 falhar.
- [ ] **Step 3: Implementar a migração.** Valide a spec em uma função `validate_report_spec(p_spec jsonb) returns void`. Monte o SQL com `format()` só a partir de mapas fixos, declarados como `case` no código, de nome lógico para expressão SQL.
- [ ] **Step 4: Rodar `pnpm db:migrate` e depois `pnpm test:db`.** Esperado: tudo verde.
- [ ] **Step 5: Commit** com a mensagem `feat(db): motor de relatórios personalizados`.

### Task 3: Relatórios prontos no banco

**Files:**
- Create: `supabase/migrations/20261025000003_report_presets.sql`
- Test: `supabase/tests/26_report_presets.test.sql`

**Interfaces:**
- Consumes: `run_report` e `can_access_for`.
- Produces: o `run_report` passa a aceitar `"kind": "<preset>"` com `"params": {...}`, mais o `period` e os `filters` comuns `company`, `owner`, `team` e `pipeline`. A saída tem o mesmo formato `{columns, rows, total}`. Presets:
  - `channel_funnel`: uma linha por canal com `attempts`, `meetings_booked`, `meetings_held`, `opportunities`, `won` e as quatro taxas entre etapas (0 quando o denominador é 0). As regras saem das notas da fase 4:
    - tentativas são atividades concluídas em leads, por `channel_id`;
    - agendadas são atividades com resultado `books_meeting`;
    - realizadas são `meeting_outcome = 'held'`, agrupadas por `origin_channel_id`;
    - oportunidades são leads convertidos com reunião realizada de origem;
    - ganhos são negócios ganhos desses leads.
  - `channel_success`: por canal, as contagens de atividades concluídas por `activity_outcomes.classification` e a taxa de sucesso (positivos / concluídas).
  - `conversion_influence`: canal da última atividade concluída antes de cada evento, com contagem por canal para três eventos: lead convertido (`converted_at`), avanço de etapa (`deal_stage_history.moved_at`) e ganho (`won_at`).
  - `stage_conversion`: para um `pipeline` (param obrigatório), por etapa, quantos negócios entraram e quantos saíram para a etapa seguinte ou para ganho, com a taxa. Agrupamento opcional por `owner` ou `month`.
  - `forecast`: por mês de `expected_close_date`, a quantidade e o valor previstos (abertos) e o realizado (ganhos em `won_at` no mês).
  - `revenue_monthly`: por mês, Setup e MRR contratados (ganhos, a partir do cronograma) e previstos. Os previstos são os abertos ponderados por `stages.probability / 100`, a partir do cronograma ou, sem cronograma, de `estimated_value` no mês de `expected_close_date`.
  - `pipeline_overview`: por funil e etapa, a quantidade e o valor (`contract_value`, ou `estimated_value` quando o contrato é 0) dos abertos.
  - `aging`: para leads abertos e negócios abertos, `days_since_created`, e para negócios `days_in_stage`. São linhas por registro, limitadas a 500, ordenadas pela idade em ordem decrescente.
  - `activities_by_user`: por usuário, concluídas, atrasadas (abertas com `due_at < now()`) e abertas.
  - `lost_reasons`: por motivo de perda, a quantidade e o valor.
  - `goal_progress`: devolve `goal_progress(goal_id, viewer)` para as metas visíveis no período corrente (ver Task 4).

- [ ] **Step 1: Escrever `26_report_presets.test.sql`.** Fixture de jornada completa:
  - Atividades por canal: 3 tentativas LinkedIn, 1 com `books_meeting`; 2 tentativas por e-mail, nenhuma agendou.
  - A reunião LinkedIn foi `held`.
  - O lead foi convertido e o negócio, ganho.
  - Um segundo negócio aberto com probabilidade 50.
  - Um terceiro negócio perdido com motivo.

  Asserções exatas:
  - `channel_funnel` LinkedIn dá 3/1/1/1/1, e e-mail dá 2/0/0/0/0 com taxas 0.
  - `channel_success` conta por classificação.
  - `conversion_influence` credita LinkedIn na conversão.
  - `stage_conversion` dá as contagens por etapa.
  - `forecast` dá o previsto e o realizado no mês.
  - `revenue_monthly` dá o Setup e o MRR contratados e o previsto ponderado por 0.5.
  - `pipeline_overview` dá os totais.
  - `aging` ordena pela idade.
  - `activities_by_user` conta as atrasadas.
  - `lost_reasons` dá a contagem.
  - O vendedor own não vê os números dos negócios de outro.
  - Um preset desconhecido gera `OXYN_INVALID_REPORT`.
  - `stage_conversion` sem `pipeline` gera `OXYN_INVALID_REPORT`.
- [ ] **Step 2: Rodar `pnpm test:db`** e ver o arquivo 26 falhar.
- [ ] **Step 3: Implementar.** Use uma função por preset, `report_preset_<nome>(p_params jsonb, p_companies uuid[], p_viewer uuid, p_from date, p_to date) returns jsonb`, toda `security definer` e com `execute` revogado. O `run_report` despacha pelo `kind`.
- [ ] **Step 4: Rodar `pnpm db:migrate` e depois `pnpm test:db`.** Esperado: tudo verde.
- [ ] **Step 5: Commit** com a mensagem `feat(db): relatórios prontos de canal, conversão, forecast e receita`.

### Task 4: Execução de widgets, compartilhamento, links públicos e progresso de metas no banco

**Files:**
- Create: `supabase/migrations/20261025000004_dashboard_runtime.sql`
- Test: `supabase/tests/27_dashboard_runtime.test.sql`

**Interfaces:**
- Consumes: `run_report` e as tabelas da Task 1.
- Produces:
  - `run_widget(p_widget uuid, p_filters jsonb) returns jsonb`, para `authenticated`:
    - Carrega o widget e o dashboard.
    - Se `auth.uid()` é o dono ou admin geral, o viewer é `auth.uid()` e as empresas são as de `has_company_access`.
    - Se `auth.uid()` está em `dashboard_shares`, o viewer é o dono (que precisa estar ativo) e as empresas são as acessíveis ao dono.
    - Fora isso, gera `OXYN_FORBIDDEN`.
    - Aplica `restrict_filters`.
    - Usa `spec` = `reports.spec` (quando há `report_id`) ou `widget.spec`.
  - `restrict_filters(p_spec jsonb, p_filters jsonb, p_allowed_companies uuid[]) returns (spec jsonb, companies uuid[])`, interna. Regras:
    - `companies` é a interseção do filtro com as permitidas; lista vazia depois da interseção dá resultado vazio, não a lista toda.
    - O período do filtro é recortado ao período da spec, quando ela tem um.
    - `owner` e `team` viram filtros adicionais (`and`).
    - Nada amplia o resultado.
  - `create_share_link(p_dashboard uuid, p_expires_at timestamptz) returns text`, para `authenticated`:
    - Exige ser o dono com `share_dashboards`.
    - Gera um token aleatório de 32 bytes em base64url, guarda `encode(digest(token,'sha256'),'hex')` e devolve o token em claro uma única vez.
    - Use pgcrypto (`extensions.gen_random_bytes` e `extensions.digest`); confirme o schema da extensão no projeto.
  - `revoke_share_link(p_link uuid) returns void`, para `authenticated` (somente o dono).
  - `dashboard_public(p_token text) returns jsonb`, só para o service role. Devolve o dashboard (nome, filtros padrão e widgets sem specs sensíveis: id, título, tamanhos e tipo de gráfico) quando o token é válido, não revogado e não expirado, e o dono está ativo. Caso contrário devolve `null`.
  - `run_widget_public(p_token text, p_widget uuid, p_filters jsonb) returns jsonb`, só para o service role. Usa a mesma regra do compartilhamento (viewer = dono) e exige que o widget pertença ao dashboard do token.
  - `goal_progress(p_goal uuid, p_viewer uuid) returns jsonb`, interna:
    - Devolve `{target, actual, percent, period_start, period_end}` do período corrente que contém `now()` em São Paulo, a partir de `starts_on` e do período.
    - `actual` é calculado pela métrica para o alvo: empresa = todos; usuário = `owner_id`; equipe = membros da equipe.
    - `meetings_booked` e `meetings_held` usam as regras do funil por canal; `opportunities_created` conta negócios criados; `won_value` soma `contract_value` dos ganhos; `won_mrr` soma `mrr` dos ganhos; `activities_done` conta atividades concluídas.
    - Respeita a visibilidade de `p_viewer`.
  - `goals_progress_self(p_companies uuid[]) returns jsonb`, para `authenticated`: a lista de metas com o progresso, usando o viewer `auth.uid()`.

- [ ] **Step 1: Escrever `27_dashboard_runtime.test.sql`.** Asserções:
  - O dono roda o próprio widget com o próprio alcance.
  - O destinatário (vendedor own) roda o widget compartilhado e recebe os números do dono (gestor company).
  - O destinatário pede um widget de outro dashboard do mesmo dono e recebe `OXYN_FORBIDDEN`.
  - Um terceiro sem compartilhamento recebe `OXYN_FORBIDDEN`.
  - Filtro com empresa que o dono não acessa dá resultado vazio.
  - Filtro com período maior que o da spec é recortado.
  - Filtro `owner` restringe.
  - Dono desativado faz o widget compartilhado dar `OXYN_FORBIDDEN`.
  - `create_share_link` sem `share_dashboards` gera `OXYN_FORBIDDEN`.
  - O token devolvido funciona em `dashboard_public`.
  - O hash guardado é diferente do token.
  - Token revogado e token expirado dão `null`.
  - `run_widget_public` com widget de outro dashboard gera `OXYN_FORBIDDEN`.
  - `authenticated` não executa `dashboard_public`.
  - `goal_progress` de meta mensal de `won_value` dá `actual` e `percent` exatos.
  - Meta de equipe soma os membros.
  - `percent` com alvo atingido em dobro dá 200.
- [ ] **Step 2: Rodar `pnpm test:db`** e ver o arquivo 27 falhar.
- [ ] **Step 3: Implementar a migração.** O preset `goal_progress` da Task 3 passa a chamar esta função. Faça o `create or replace` do despachante no corpo mais recente.
- [ ] **Step 4: Rodar `pnpm db:migrate` e depois `pnpm test:db`.** Esperado: tudo verde.
- [ ] **Step 5: Commit** com a mensagem `feat(db): execução de widgets, compartilhamento e metas`.

### Task 5: Camada lib de relatórios

**Files:**
- Create: `src/lib/reports/spec.ts` (schema zod da spec e catálogo de campos e dimensões com rótulos PT-BR, espelhando a Task 2)
- Create: `src/lib/reports/presets.ts` (catálogo dos presets: chave, nome, descrição, gráfico padrão, params)
- Create: `src/lib/reports/format.ts` (formatação de célula por tipo: moeda BRL, número, porcentagem, dias, mês "out/2026")
- Create: `src/lib/reports/queries.ts` (`server-only`)
- Create: `src/lib/reports/actions.ts` (server actions)
- Create: `src/lib/reports/permissions.ts`
- Test: `src/lib/reports/spec.test.ts`, `src/lib/reports/format.test.ts`, `src/lib/reports/presets.test.ts`
- Modify: `src/lib/db-errors.ts` (adicionar `OXYN_INVALID_REPORT`: "Relatório inválido. Revise os campos escolhidos." e garantir `OXYN_FORBIDDEN`)

**Interfaces:**
- Consumes: as RPCs `run_report_self`, `run_widget`, `create_share_link`, `revoke_share_link`, `goals_progress_self` e as tabelas da Task 1.
- Produces:
  - `reportSpecSchema` (zod) e o tipo `ReportSpec`.
  - `BASES`, `fieldsFor(base)`, `dimensionsFor(base)` e `metricsFor(base)`, cada item com `{key, label, type}`.
  - `PRESETS: Preset[]`, com `Preset = {key, name, description, chart, params: ParamDef[]}`.
  - `ReportResult = {columns: {key,label,type}[], rows: unknown[][], total: number|null}`.
  - `formatCell(value, type): string`, em que `type` é `currency`, `number`, `percent`, `days`, `month`, `text` ou `date`.
  - `runReport(spec, scopeSlug): Promise<ReportResult>`, que resolve as empresas pelo escopo.
  - `runWidget(widgetId, filters): Promise<ReportResult>`.
  - Relatórios: `listReports(scopeSlug)`, `getReport(id)`, `saveReport(input)`, `deleteReport(id)`.
  - Dashboards:
    - `listDashboards()`, que devolve os próprios e os compartilhados comigo, com `shared: boolean`;
    - `getDashboard(id)` e `createDashboard(name)`;
    - `renameDashboard`, `deleteDashboard`;
    - `addWidget(dashboardId, {reportId?|spec?, title, colSpan, rowSpan})`;
    - `updateWidgetLayout(dashboardId, items: {id, position, colSpan, rowSpan}[])` e `removeWidget(id)`.
  - Compartilhamento:
    - `shareDashboard(dashboardId, userIds)` e `unshareDashboard(dashboardId, userId)`;
    - `createShareLink(dashboardId, expiresAt?)`, que devolve `{url}` montada com `NEXT_PUBLIC_SITE_URL` + `/d/<token>`;
    - `revokeShareLink(linkId)`.
  - Metas: `listGoals(scopeSlug)` (com progresso), `createGoal(input)` e `deleteGoal(id)`.
  - Permissões: `getReportPermissions(scopeSlug): {viewReports, createDashboards, shareDashboards}`.
  - Todas as actions validam com zod, chamam o banco, traduzem erros com `translateDbError` e revalidam o caminho.

- [ ] **Step 1: Escrever os testes Vitest.**
  - `spec.test.ts` aceita uma spec válida de cada base.
  - `spec.test.ts` rejeita: campo fora do catálogo da base, `metric.op` `sum` sem campo somável, `conversion_rate` em `activities`, filtro com operador desconhecido, `period.from` maior que `to` e `chart` inválido.
  - `format.test.ts` cobre:
    - `formatCell(1234.5,'currency')` dá `"R$ 1.234,50"`, com espaço não separável conforme `Intl`; teste com regex `/R\$\s1\.234,50/`.
    - `formatCell(25,'percent')` dá `"25,0%"`.
    - `formatCell(null,'number')` dá `"0"`.
    - `formatCell(NaN,'percent')` dá `"0,0%"`.
    - `formatCell('2026-10-01','month')` dá `"out/2026"`.
  - `presets.test.ts`: toda chave de `PRESETS` aparece na lista de presets aceita pelo schema, e `stage_conversion` exige o param `pipeline`.
- [ ] **Step 2: Rodar `pnpm test src/lib/reports`** e ver os testes falharem.
- [ ] **Step 3: Implementar** os módulos com as assinaturas acima. Em `queries.ts`, use `await connection()` antes de ler a sessão.
- [ ] **Step 4: Rodar `pnpm lint && pnpm typecheck && pnpm test`.** Esperado: tudo verde.
- [ ] **Step 5: Commit** com a mensagem `feat(relatorios): spec, catálogo, formatação e ações`.

### Task 6: Gráficos, página Relatórios e construtor

**Files:**
- Modify: `package.json` (adicionar `recharts` na versão 3 estável mais recente compatível com React 19)
- Create: `src/components/reports/report-chart.tsx` (renderiza um `ReportResult` como número, barras, linha, funil, pizza ou tabela)
- Create: `src/components/reports/report-builder.tsx` (cliente: base, métrica, agrupamento, filtros, período e gráfico, com pré-visualização ao vivo via server action e botão Salvar)
- Create: `src/components/reports/preset-card.tsx`
- Create: `src/app/(app)/[empresa]/relatorios/page.tsx` (galeria de presets e relatórios salvos)
- Create: `src/app/(app)/[empresa]/relatorios/novo/page.tsx` e `src/app/(app)/[empresa]/relatorios/[id]/page.tsx` (construtor)
- Create: `src/app/(app)/[empresa]/relatorios/prontos/[preset]/page.tsx` (preset com filtros de período, empresa, usuário e equipe)
- Modify: `src/lib/nav.ts` e `src/lib/nav.test.ts`. Troque `CURRENT_PHASE` por `DELIVERED_PHASES = [1, 2, 3, 4, 6]` e `isNavItemEnabled` por `DELIVERED_PHASES.includes(item.availableFromPhase)`, para que E-mail (fase 5) continue desativado e Relatórios fique ativo. O item Relatórios só aparece ativo para quem tem `view_reports` na empresa do escopo ou é admin geral (passe a permissão ao shell).
- Modify: `e2e/shell.spec.ts` (Relatórios ativo, E-mail desativado)
- Test: `e2e/reports.spec.ts`

**Interfaces:**
- Consumes: Task 5 (`runReport`, `PRESETS`, `reportSpecSchema`, `formatCell`, `saveReport`, `getReportPermissions`).
- Produces: `<ReportChart result={ReportResult} chart={ChartKind} compact?={boolean} />`, reutilizado pelos dashboards nas Tasks 7 e 8.

Regras dos gráficos:
- As cores saem de uma paleta fixa em `report-chart.tsx` (`#1A82A2`, `#6498A8`, `#75ACBA`, `#3E6B78`, `#A9C9D2`, `#5A5F63`).
- O funil é barras horizontais decrescentes com a taxa entre etapas.
- Vazio mostra "Sem dados no período".
- Valores formatados com `formatCell`.
- Acessibilidade: cada gráfico tem um `aria-label` com título e um resumo, e um botão "Ver tabela" mostra a tabela equivalente.

- [ ] **Step 1: Escrever `e2e/reports.spec.ts`.**
  - Fixtures via helpers em `e2e/helpers/db.ts`: leads, negócios e atividades com valores conhecidos.
  - O admin abre `/oxyn/relatorios` e vê os presets.
  - Abre "Funil de reuniões por canal" e vê a linha LinkedIn com os números da fixture.
  - Monta um relatório personalizado (negócios, soma de valor do contrato, por etapa, barras), salva com nome único e vê o relatório na lista.
  - O usuário padrão sem `view_reports` vê Relatórios desativado e, ao abrir `/oxyn/relatorios`, recebe 404.
  - Ajuste o papel da fixture ou crie um papel de teste sem `view_reports`.
- [ ] **Step 2: Rodar `pnpm exec playwright test e2e/reports.spec.ts`** e ver o teste falhar.
- [ ] **Step 3: Instalar o Recharts (`pnpm add recharts@^3`) e implementar** componentes, páginas e nav.
- [ ] **Step 4: Rodar `pnpm lint && pnpm typecheck && pnpm test`, o spec novo e `e2e/shell.spec.ts`.** Esperado: tudo verde.
- [ ] **Step 5: Commit** com a mensagem `feat(relatorios): gráficos, presets e construtor`.

### Task 7: Dashboards com grade de widgets

**Files:**
- Create: `src/app/(app)/[empresa]/relatorios/dashboards/page.tsx` (lista: meus e compartilhados comigo)
- Create: `src/app/(app)/[empresa]/relatorios/dashboards/[id]/page.tsx`
- Create: `src/components/dashboards/dashboard-grid.tsx`:
  - Grade CSS de 4 colunas, que vira 1 coluna abaixo de 768px.
  - Ordenação com `@dnd-kit/sortable`.
  - Redimensionamento por alça que ajusta `colSpan` de 1 a 4 e `rowSpan` de 1 a 3, com atalhos de teclado.
  - Salva com `updateWidgetLayout`.
- Create: `src/components/dashboards/widget-card.tsx` (título, `ReportChart` compacto, menu com remover)
- Create: `src/components/dashboards/add-widget-dialog.tsx` (escolhe preset ou relatório salvo, título e tamanho)
- Create: `src/components/dashboards/dashboard-filters.tsx` (período: mês atual, trimestre atual, últimos 30, 90 ou 365 dias, ou intervalo; empresa, quando o escopo é "Todas as empresas")
- Test: `e2e/dashboards.spec.ts`

**Interfaces:**
- Consumes:
  - Da Task 5: `createDashboard`, `getDashboard`, `addWidget`, `updateWidgetLayout`, `removeWidget` e `runWidget`.
  - Da Task 6: `ReportChart`.
- Produces: `DashboardView` (componente servidor), que recebe `readOnly`, `widgets` e `filters`. É reutilizado pela página pública na Task 8.

Regras:
- Cada widget carrega os próprios dados (Suspense por widget) chamando `runWidget(id, filters)` no servidor.
- Os filtros vivem na URL (`?de=YYYY-MM-DD&ate=YYYY-MM-DD&empresa=<slug>`), validados. Valor inválido cai no padrão do dashboard, sem erro 500.
- Só o dono vê os controles de edição.
- Criar dashboard exige `create_dashboards`. Sem essa permissão, o botão não aparece e a action recusa.

- [ ] **Step 1: Escrever `e2e/dashboards.spec.ts`.**
  - O admin cria um dashboard com nome único.
  - Adiciona o widget "Pipeline geral" e um relatório salvo.
  - Arrasta o segundo para a primeira posição (use o padrão de arrasto de `e2e/kanban.spec.ts`).
  - Aumenta o tamanho de um widget pela alça.
  - Recarrega e confirma a ordem e o tamanho persistidos.
  - Muda o período para "Últimos 30 dias" e vê o widget recalcular.
  - `?de=lixo` não quebra a página.
  - O usuário sem `create_dashboards` não vê "Novo dashboard".
- [ ] **Step 2: Rodar o spec** e ver o teste falhar.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar `pnpm lint && pnpm typecheck && pnpm test` e os specs `dashboards` e `reports`.** Esperado: tudo verde.
- [ ] **Step 5: Commit** com a mensagem `feat(dashboards): grade de widgets com filtros globais`.

### Task 8: Compartilhamento com usuários e link público

**Files:**
- Create: `src/components/dashboards/share-dialog.tsx`:
  - Aba Usuários: busca entre os usuários das empresas do dono, adiciona e remove.
  - Aba Link público: criar com expiração opcional (7, 30 ou 90 dias, ou nunca), copiar e revogar. A URL completa aparece uma única vez, na criação.
- Create: `src/app/d/[token]/page.tsx`:
  - Página pública fora de `(app)`, sem shell e sem sessão.
  - Usa o cliente admin (`server-only`) para chamar `dashboard_public` e `run_widget_public`.
  - Renderiza `DashboardView` com `readOnly` e filtros de período na URL.
  - Token inválido dá `notFound()`.
  - Cabeçalho com a marca Oxyn e o nome do dashboard. Sem links para o CRM.
- Modify: `src/lib/supabase/middleware.ts` (isentar exatamente o prefixo `/d/` do redirecionamento de login, com o mesmo cuidado da isenção de `/api/cron/lembretes`). Adicione `<meta name="robots" content="noindex">` na página pública.
- Modify: `src/lib/reports/actions.ts` (actions de compartilhamento, se ainda faltar alguma)
- Test: `e2e/dashboard-sharing.spec.ts`

**Interfaces:**
- Consumes:
  - Da Task 4: `run_widget`, `create_share_link`, `revoke_share_link`, `dashboard_public` e `run_widget_public`.
  - Da Task 7: `DashboardView`.
- Produces: nada consumido depois.

- [ ] **Step 1: Escrever `e2e/dashboard-sharing.spec.ts`.**
  - O gestor (visibilidade company) cria um dashboard com o widget de contagem de negócios e o compartilha com o vendedor (own).
  - O vendedor vê o dashboard em "Compartilhados comigo" com o mesmo número do gestor, que é maior que o próprio número do vendedor.
  - O vendedor não vê os controles de edição.
  - O gestor cria um link público, abre-o em um contexto anônimo e vê o número.
  - O gestor revoga o link e o contexto anônimo recebe 404.
  - `/d/token-invalido` dá 404.
  - O usuário sem `share_dashboards` não vê o botão Compartilhar.
- [ ] **Step 2: Rodar o spec** e ver o teste falhar.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar `pnpm lint && pnpm typecheck && pnpm test` e os specs `dashboard-sharing`, `dashboards` e `shell`.** Esperado: tudo verde.
- [ ] **Step 5: Commit** com a mensagem `feat(dashboards): compartilhamento com usuários e link público`.

### Task 9: Metas

**Files:**
- Create: `src/app/(app)/[empresa]/relatorios/metas/page.tsx`. Lista as metas da empresa com uma barra de progresso teal (100% ou mais em teal escuro), alvo, realizado e período corrente.
- Create: `src/components/goals/goal-form.tsx`. Disponível só para o admin geral. Campos:
  - alvo: empresa, usuário ou equipe;
  - métrica, com os rótulos "Reuniões agendadas", "Reuniões realizadas", "Oportunidades criadas", "Valor ganho", "MRR ganho" e "Atividades concluídas";
  - período: "Semanal", "Mensal" ou "Trimestral";
  - início, alinhado automaticamente ao período;
  - valor-alvo.
- Create: `src/components/goals/goal-progress.tsx` (reutilizado pelo widget do preset `goal_progress` no `ReportChart`, quando `chart` é `table` e o preset é `goal_progress`)
- Test: `src/lib/reports/goals.test.ts`, que testa `alignStart(date, period)`:
  - semanal: segunda-feira;
  - mensal: dia 1;
  - trimestral: 1/jan, 1/abr, 1/jul ou 1/out.
- Test: `e2e/goals.spec.ts`

**Interfaces:**
- Consumes: da Task 5, `listGoals`, `createGoal` e `deleteGoal`; da Task 4, `goals_progress_self`.
- Produces: `alignStart(date: string, period: 'week'|'month'|'quarter'): string` em `src/lib/reports/goals.ts`.

- [ ] **Step 1: Escrever os testes.**
  - `goals.test.ts` com as datas `2026-10-22` (quinta-feira):
    - semana: `2026-10-19`;
    - mês: `2026-10-01`;
    - trimestre: `2026-10-01`.
  - Mais `2026-02-15`: trimestre `2026-01-01`.
  - `e2e/goals.spec.ts`:
    - O admin cria uma meta mensal de "Valor ganho" para a empresa com alvo 10000.
    - Com um negócio ganho de valor conhecido no mês na fixture, a página mostra o realizado e a porcentagem exatos.
    - O usuário padrão vê a meta mas não vê "Nova meta".
    - Um dashboard com o widget "Progresso de metas" mostra a mesma porcentagem.
- [ ] **Step 2: Rodar os testes** e ver que falham.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar `pnpm lint && pnpm typecheck && pnpm test` e o spec `goals`.** Esperado: tudo verde.
- [ ] **Step 5: Commit** com a mensagem `feat(metas): metas por empresa, usuário e equipe`.

### Task 10: Fechamento da fase 6

**Files:**
- Modify: `README.md` (módulo Relatórios, dashboards e metas: permissões `view_reports`, `create_dashboards`, `share_dashboards`; link público em `/d/<token>`; `NEXT_PUBLIC_SITE_URL` obrigatório para os links)
- Create: `docs/superpowers/followups/2026-10-25-fase-6-pendencias.md`, incluindo:
  - a base "e-mails" adiada para depois da fase 5;
  - as pendências que continuam das fases anteriores.
- Test: `e2e/phase6-smoke.spec.ts`

- [ ] **Step 1: E2E de jornada.**
  1. O SDR registra tentativas no LinkedIn e por e-mail em leads, agenda e realiza uma reunião vinda do LinkedIn, e o lead é convertido e ganho.
  2. O gestor abre o "Funil de reuniões por canal" e vê o LinkedIn com uma tentativa a mais, uma agendada, uma realizada, uma oportunidade e um ganho. Compare as contagens antes e depois, para não depender de dados preexistentes.
  3. O gestor cria um dashboard com esse widget e com o de receita mês a mês, e o compartilha por link público.
  4. A página pública mostra os mesmos números.
  5. A meta de "Valor ganho" avança.
- [ ] **Step 2: Rodar a suíte completa** com `pnpm lint && pnpm typecheck && pnpm test && pnpm test:db && pnpm build && pnpm test:e2e`, com a máquina ociosa. Esperado: tudo verde. O teste de e-mail de lembrete pode ficar pulado sem `CRON_SECRET`.
- [ ] **Step 3: Commit** com a mensagem `docs: fechamento da fase 6`.

---

## Cobertura da spec (fase 6)

| Requisito | Task |
|---|---|
| Tabelas da seção 4.6 | 1 |
| Construtor com spec controlada, execução no banco respeitando a visibilidade | 2, 5, 6 |
| Bases leads, negócios, atividades, receita e histórico de etapas (e-mails depois da fase 5) | 2 |
| Métricas: quantidade, soma, média, taxa de conversão e tempo médio | 2 |
| Agrupamentos: usuário, equipe, empresa, funil, etapa, canal, resultado, mês, etiqueta, origem e campo personalizado | 2 |
| Gráficos: número, barras, linha, funil, pizza e tabela | 6 |
| Relatórios prontos (funil por canal, sucesso por canal, influência, conversão por etapa, forecast, receita mês a mês, pipeline, idade, atividades por usuário, motivos de perda, progresso de metas) | 3, 4, 6, 9 |
| Dashboards: grade arrastável e redimensionável, filtro global de período e empresa | 7 |
| Compartilhamento com usuários (alcance do criador, filtros só restringem) e link público (hash, expiração, revogação) | 1, 4, 8 |
| Metas por empresa, usuário e equipe, com as seis métricas e os três períodos | 1, 4, 9 |
| Permissões `view_reports`, `create_dashboards` e `share_dashboards` | 1, 2, 6, 7, 8 |
