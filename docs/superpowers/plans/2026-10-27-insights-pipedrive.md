# Insights no modelo do Pipedrive: plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Objetivo:** substituir o módulo de relatórios e dashboards por um Insights igual ao do Pipedrive: relatórios no formato JSON do Pipedrive, painéis montados com relatórios salvos, cores por valor e os painéis das 7 empresas recriados a partir do Pipedrive.

**Arquitetura:**
- **Motor:** plpgsql (`insights_*`), dirigido por um catálogo de campos com os ids do Pipedrive. A tela lê o catálogo por RPC e executa os relatórios por RPC, com a visibilidade de quem vê.
- **Telas:** Next 16 (App Router), com a lateral do Insights, o editor de relatório e o painel em grade livre (react-grid-layout).
- **Painéis:** recriados por um script que traduz os relatórios do Pipedrive.

**Tecnologias:** Next.js 16, Supabase Postgres (RLS, security definer), pgTAP, Vitest, Playwright, recharts 3, react-grid-layout, zod 4.

**Especificação:** `docs/superpowers/specs/2026-10-27-insights-pipedrive-design.md`

## Regras gerais
- Toda a interface em PT-BR.
- Datas sempre em America/Sao_Paulo. A semana vai de domingo a sábado.
- O SQL dinâmico só é montado a partir do catálogo. Valores do usuário sempre entram por `$1`.
- Permissões existentes:
  - `has_report_setting(company, 'view_reports')` para ver;
  - `can_create_dashboards()` para criar;
  - `has_any_report_setting('share_dashboards')` para compartilhar.
- Não mexer em `goals` nem em `goals_progress_self`.
- Nunca matar o servidor de dev na porta 3000. Nunca imprimir o `.env.local`. Reset destrutivo do banco de dev só com aprovação.
- Comandos com node: `PATH=$HOME/.local/node/bin:$PATH`.
- Migrações: `pnpm db:migrate`. Testes de banco: `pnpm test:db <filtro>`.

## Pontos de atenção na revisão
1. Relatório sem nenhum dado no período: o gráfico mostra o aviso "Os resultados não podem ser exibidos…", nunca erro nem gráfico em branco.
2. Filtro com referência que a empresa não tem (o canal não existe): não traz nada, em vez de virar "todos". O teste fica na tarefa 7.
3. Valor de segmento sem cor definida, com mais de 42 segmentos: a paleta recomeça do início, sem quebrar. O teste fica na tarefa 4.
4. Quem só tem acesso de leitura (compartilhado, sem `can_edit`) não consegue salvar, mover widgets nem trocar cores. O teste fica nas tarefas 1 e 5.
5. Filtro rápido de período num relatório sem filtro de data: o relatório não muda. O teste fica na tarefa 2.

---

### Tarefa 1: Esquema, RLS e remoção do módulo antigo

**Arquivos:**
- Criar: `supabase/migrations/20261029000001_insights_schema.sql`
- Teste: `supabase/tests/40_insights_schema.test.sql`

**O que entrega:**
- **Tabelas:** `insight_reports`, `insight_report_shares`, `insight_dashboards`, `insight_dashboard_reports`, `insight_dashboard_shares`, `insight_dashboard_links`, `insight_quick_filters`, `insight_colors`, `insight_saved_colors`. As colunas são as da especificação, seção 1.
- **Funções:** `can_read_insight_report(uuid)`, `can_edit_insight_report(uuid)`, `can_read_insight_dashboard(uuid)` e `can_edit_insight_dashboard(uuid)`, todas com security definer e baseadas em `auth.uid()`.
- **Remoção:** saem as tabelas e funções do módulo antigo que não são usadas pelas metas.

- [ ] Escrever o pgTAP com estes casos:
  - o dono lê e edita;
  - quem recebeu o compartilhamento lê, mas não edita;
  - com `can_edit`, edita;
  - um estranho não vê nada;
  - a posição tem `x` entre 0 e 3 e `x + w` até 4.
- [ ] Rodar `pnpm test:db 40` e confirmar que falha.
- [ ] Escrever a migração e aplicar com `pnpm db:migrate`.
- [ ] Rodar `pnpm test:db` (toda a suíte) e confirmar que passa. Ajustar ou remover os testes que cobriam o módulo antigo.
- [ ] Commit.

### Tarefa 2: Catálogo e motor

**Arquivos:**
- Criar: `supabase/migrations/20261029000002_insights_engine.sql`
- Teste: `supabase/tests/41_insights_engine.test.sql`

**Interface pública** (rpc, só para authenticated):
- `insights_catalog(p_company uuid) returns jsonb`. Formato: `{entities:{<data_type>:{report_types:{<rt>:{group_by:[ids], segment_by:[ids], measure_by:[{id,name,type,agg}]}}, fields:[{id,name,type,entity,operators,options?}]}}, users, ...}`.
- `insights_run(p_company uuid, p_def jsonb, p_overrides jsonb default '{}') returns jsonb`. Formato: `{x, segments, values, total, previous?, compare?, measure:{label,type}, summary}`.
- `insights_records(p_company uuid, p_def jsonb, p_overrides jsonb, p_page int, p_sort jsonb, p_point jsonb) returns jsonb`. Formato: `{columns, rows, total}`.
- `insights_run_dashboard_report(p_dashboard uuid, p_report uuid, p_overrides jsonb)`: confere o acesso ao painel. Quem vê os dados é `auth.uid()`.
- `insights_run_public(p_token text, p_report uuid, p_overrides jsonb)`: só service_role. Quem vê os dados é o dono do painel.

**Interface interna:** `insights_field(p_type text, p_report_type text, p_id text)` devolve `expr`, `kind`, `label`, `tmpl` e `join`.

`p_overrides` é `{period?: {period, from?, to?}, user_ids?: uuid[], pipeline_id?: uuid, compare?: {kind:'previous'|'custom', from?, to?}}`.

**Testes pgTAP:**
- [ ] Contagem de leads com `label isAnyOf`, `addTime[month]` e `active isExactly true`.
- [ ] `isNotAnyOf` também exclui os registros sem valor.
- [ ] `isEmpty` e `isNotEmpty`.
- [ ] Os limites dos períodos `week`, `lastWeek` (domingo a sábado) e `month`.
- [ ] `group_by` `addTime/month` preenche os meses vazios do período.
- [ ] `segment_by status` monta os segmentos.
- [ ] `measure_by value` soma o `estimated_value`.
- [ ] Os campos ligados `lead_id_label` (atividade → lead), `person_id_<custom>` e `activity_id_outcome` (lead com atividade).
- [ ] `funnel_conversion` com as etapas e o histórico.
- [ ] `duration` com a média em dias por etapa.
- [ ] `revenue_forecast` com `is_cumulative`.
- [ ] Scorecard com `previous`.
- [ ] O override de período só troca os filtros que têm `period`; um relatório sem data fica igual.
- [ ] O override de usuário troca o filtro de dono existente.
- [ ] A visibilidade: um vendedor restrito não conta o registro de outro dono.
- [ ] Uma definição inválida (campo desconhecido) gera `OXYN_INVALID_REPORT`.

**Passos:**
- [ ] Rodar `pnpm test:db 41` e confirmar que falha.
- [ ] Implementar, reaproveitando `can_access_for` e a lógica de período da v2.
- [ ] Rodar `pnpm test:db` e confirmar que passa.
- [ ] Commit.

### Tarefa 3: Tipos, validação e acesso a dados em TS

**Arquivos:**
- Criar: `src/lib/insights/types.ts`, `definition.ts` (zod e valores padrão), `palette.ts`, `chart-shape.ts`, `queries.ts`, `actions.ts`, `permissions.ts`.
- Testes: `definition.test.ts`, `chart-shape.test.ts`, `palette.test.ts`.

**Interfaces que as tarefas seguintes usam:**
- `InsightDefinition = {data_type, report_type, chart_type, parameters, columns, colors}`, igual ao JSON do Pipedrive.
- `defaultDefinition(dataType, reportType): InsightDefinition`.
- `parseDefinition(x): InsightDefinition`.
- `ChartResult`, que espelha o retorno de `insights_run`.
- `shapeChart(result, def, colorsCtx) → {rows, series[{key,label,color}], total, delta}`.
- `resolveColor(value, idx, ctx)`, com a ordem de prioridade da especificação.
- `PALETTE`: 42 cores hex, em 3 linhas de 14.
- `queries.ts`:
  - `getCatalog(companyId)`;
  - `listInsights(scopeSlug)`, que devolve `{dashboards, reports, shared/mine}`;
  - `getReport(id)`;
  - `getDashboard(id)`;
  - `runReport(companyId, def, overrides)`;
  - `runDashboardReport(dashId, reportId, overrides)`;
  - `getRecords(...)`.
- `actions.ts` (server actions):
  - relatórios: `createReport`, `saveReport`, `duplicateReport`, `deleteReport`, `shareReport`;
  - painéis: `createDashboard`, `renameDashboard`, `deleteDashboard`, `duplicateDashboard`, `addReportToDashboard`, `removeFromDashboard`, `saveLayout`;
  - filtros e cores: `saveQuickFilters`, `saveCompanyColor`, `saveMyColors`;
  - compartilhamento: `shareDashboard`, `createPublicLink`, `revokePublicLink`.

**Passos:**
- [ ] Escrever os testes:
  - a validação rejeita um `chart_type` fora do permitido para o `report_type`;
  - `shapeChart` pivota os segmentos e acumula com `is_cumulative`;
  - o delta é `(t - p) / p`, e com `p = 0` vira `null`;
  - `resolveColor` segue a ordem de prioridade e recomeça a paleta depois de 42.
- [ ] Rodar `pnpm test src/lib/insights` e confirmar que falha.
- [ ] Implementar.
- [ ] Rodar de novo e confirmar que passa.
- [ ] Commit.

### Tarefa 4: Componentes de gráfico

**Arquivos:**
- Criar: `src/components/insights/chart/insight-chart.tsx`, `scorecard.tsx`, `pivot-table.tsx`, `funnel-chart.tsx`, `empty-chart.tsx` e `chart-colors-dialog.tsx`.

**Detalhes:**
- `<InsightChart def result onPointClick? compact?>` escolhe o gráfico: coluna, barra, pizza, número, tabela ou funil.
- O diálogo de cores segue a especificação.
- Os testes de cores ficam em `palette.test.ts` (tarefa 3).
- Verificação visual feita na tarefa 8.
- [ ] Implementar.
- [ ] Rodar `pnpm typecheck` e confirmar que passa.
- [ ] Commit.

### Tarefa 5: Lateral do Insights e editor de relatório

**Arquivos:**
- Substituir `src/app/(app)/[empresa]/relatorios/**` por:
  - `layout.tsx`, com a lateral;
  - `page.tsx`;
  - `r/[id]/page.tsx`;
  - `r/novo/page.tsx`;
  - `paineis/[id]/page.tsx`;
  - `metas/page.tsx`, que continua usando o código atual das metas.
- Criar em `src/components/insights/`: `sidebar.tsx`, `create-menu.tsx`, `new-report-dialog.tsx`, `report-editor.tsx`, `filter-panel.tsx`, `filter-row.tsx`, `value-input.tsx`, `axis-controls.tsx`, `records-panel.tsx`, `summary-panel.tsx`, `add-to-dashboard.tsx` e `share-dialog.tsx`.

**Passos:**
- [ ] Implementar. A edição fica em estado local. Cada mudança chama `runReport` com debounce de 300 ms. "Salvar" só aparece com alteração e só para quem pode editar.
- [ ] Rodar `pnpm typecheck` e `pnpm lint`.
- [ ] Commit.

### Tarefa 6: Painel

**Arquivos:**
- Criar em `src/components/insights/dashboard/`: `dashboard-view.tsx`, `dashboard-grid.tsx` (react-grid-layout, 4 colunas, `rowHeight` 48), `widget.tsx`, `quick-filters.tsx`, `dashboard-menu.tsx`, `public-link-dialog.tsx` e `add-reports-panel.tsx`.
- Modificar: `src/app/d/[token]/page.tsx`.
- Dependências: `react-grid-layout@1.5.x` e `html-to-image@1.11.x`.

**Passos:**
- [ ] Implementar. Os filtros rápidos são salvos por usuário. O PDF sai por `window.print()` com CSS de impressão.
- [ ] Rodar `pnpm typecheck` e `pnpm lint`.
- [ ] Commit.

### Tarefa 7: Tradução e recriação dos painéis do Pipedrive

**Arquivos:**
- Criar: `src/lib/insights/pipedrive/translate.ts` (função pura), `translate.test.ts` e `scripts/insights-pipedrive.ts`.
- `package.json`: adicionar `insights:pipedrive`.
- Remover: `src/lib/reports/pipedrive-dashboards.ts` e `scripts/seed-pipedrive-dashboards.ts`.

**Interface:**
- `translateReport(pd: PdReport, map: RefMap, company: CompanyRefs): {def: InsightDefinition, notes: string[]}`.
- `RefMap` resolve usuário (e-mail), opção (campo + rótulo), etapa (funil + nome), funil, campo personalizado (rótulo) e etiqueta.
- `MISSING_ID` é usado quando a referência não existe.

**Passos:**
- [ ] Escrever os testes:
  - a etiqueta da empresa sai;
  - o `isNot` de etiqueta de pessoa de outra empresa sai;
  - o canal 102 vira o id do canal "Brasil Sessions…";
  - uma referência ausente vira `MISSING_ID`;
  - as posições se mantêm.
- [ ] Rodar `pnpm test translate` e confirmar que falha.
- [ ] Implementar.
- [ ] Rodar de novo e confirmar que passa.
- [ ] Rodar `pnpm insights:pipedrive caiocamarini@gmail.com`, que cria os painéis nas 7 empresas.
- [ ] Rodar `pnpm insights:pipedrive caiocamarini@gmail.com --conferir` e registrar as diferenças nas pendências.
- [ ] Commit.

### Tarefa 8: Telas de teste, limpeza e verificação final

**Arquivos:**
- Substituir os e2e `e2e/reports*.spec.ts` e `e2e/dashboards*.spec.ts` por `e2e/insights.spec.ts`.
- Remover `src/lib/reports/*`, `src/components/reports/*`, `src/components/dashboards/*` e `src/lib/dashboards/*`, menos o que as metas usam.
- Atualizar o menu, se o link mudar.

**Passos:**
- [ ] O e2e cobre o fluxo da especificação, seção 5.
- [ ] Rodar `pnpm test`, `pnpm test:db`, `pnpm typecheck`, `pnpm lint` e `pnpm test:e2e`, e confirmar que tudo passa.
- [ ] Conferir no navegador com admin@oxyn.test: o painel KPIs da OMNI11 e um relatório no editor, com tirar print.
- [ ] Atualizar o documento de pendências e a memória.
- [ ] Commit.
