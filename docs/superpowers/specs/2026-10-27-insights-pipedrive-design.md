# Insights (relatórios e painéis no modelo do Pipedrive): design

Data: 2026-10-27. Substitui o módulo de relatórios/dashboards das fases 6 e 6.5.

## Objetivo

O módulo de relatórios do Oxyn deve funcionar como o Insights do Pipedrive.
- O **relatório** é o objeto principal: entidade, tipo, filtros, eixos, segmentação, gráfico, cores e lista de registros.
- O **painel** só reúne relatórios salvos, numa grade livre de 4 colunas, com filtros rápidos.
- Dá para criar relatórios e painéis novos. As cores dos gráficos podem ser trocadas por valor, por relatório e por empresa.
- Todos os painéis são refeitos a partir do Insights do Pipedrive:
  - "KPIs - <EMPRESA>" no modelo "KPIS - OMNI11 novo";
  - "<EMPRESA> - Resultados diretoria";
  - as 7 empresas recebem os dois.

Decisões do usuário (2026-10-27):
- Modelo "novo" para todas as empresas.
- Cores como no Pipedrive (por valor, em cada relatório) mais a cor padrão da empresa.
- Motor novo, guardando os relatórios no formato JSON do Pipedrive (abordagem B).
- Fazer tudo sem aprovações intermediárias.

Fora do escopo: entidades WhatsApp, Campanha, Projeto e E-mail, porque o Oxyn não tem esses dados. Também fica fora o "Gerar relatório (IA)".

## Referência

Os dados vieram da API interna do Insights do Pipedrive, lida com o token da empresa e salva em `scripts/.tmp/pd/` (ignorado pelo git):
- `insights-settings-api/dashboards`
- `insights-settings-api/reports`
- `insights-api/fields`

Também foram consultadas as telas do painel "KPIS - OMNI11 novo" e do editor de relatório.

## 1. Formato dos dados

### Relatório (`insight_reports`)
| campo | conteúdo |
|---|---|
| `company_id` | empresa do relatório (obrigatória) |
| `owner_id`, `name` | dono e nome |
| `data_type` | `deals`, `activities`, `leads`, `organizations`, `people` |
| `report_type` | deals: `stats`, `conversion_overall`, `funnel_conversion`, `duration`, `progress`, `product_performance`, `revenue_forecast`; leads: `performance`, `conversion`; activities/organizations/people: `performance` |
| `chart_type` | `column`, `bar`, `pie`, `scorecard`, `table`, `funnel` |
| `parameters` | `{group_by:{filter, interval}, measure_by, measure_by_aggregation, segment_by, filter_by[], stages[], is_cumulative, chart_size_amount}` |
| `columns` | colunas da lista de registros (ids de campo, inclusive ligados como `deal_id_channel`) |
| `colors` | `{ "<valor do segmento ou do eixo>": "#rrggbb" }` |

Formato de cada filtro em `filter_by[]`:
- Campos: `{filter, type, operands:[{name, defaultValue}], period}`.
- `period` é um dos valores: `today`, `yesterday`, `week`, `lastWeek`, `month`, `lastMonth`, `quarter`, `lastQuarter`, `year`, `lastYear`, `last7Days`, `last30Days`, `custom` ou `null`.
- Quando `period` não é `custom`, o intervalo é sempre recalculado na hora da execução, como no Pipedrive.
- Operadores: `isExactly`, `isNot`, `isAnyOf`, `isNotAnyOf`, `isEmpty`, `isNotEmpty`, `isMoreThan`, `isLessThan`, `contains`, `notContains`, `startsWith`, `endsWith`.
- Para datas, `isMoreThan` e `isLessThan` são inclusivos. Valem os dias no fuso de São Paulo, como no Pipedrive.
- `isAnyOf`/`isNotAnyOf` recebem `defaultValue` em lista. Os demais recebem um valor escalar.
- `isNotAnyOf` também deixa de fora os registros sem valor.

Compartilhamento:
- `insight_report_shares (report_id, user_id, can_edit)`.
- O dono e quem tem `can_edit` podem editar. Os compartilhados podem ver.

### Painel (`insight_dashboards`)
| tabela | conteúdo |
|---|---|
| `insight_dashboards` | `company_id`, `owner_id`, `name` |
| `insight_dashboard_reports` | `dashboard_id`, `report_id`, `x`, `y`, `w`, `h` (grade de 4 colunas; altura em unidades do Pipedrive) |
| `insight_dashboard_shares` | `dashboard_id`, `user_id`, `can_edit` |
| `insight_dashboard_links` | link público (token com hash), revogável |
| `insight_quick_filters` | por painel e usuário: `period`, `user_ids[]`, `pipeline_id` |

Regras de acesso:
- Ver um painel dá acesso de leitura aos relatórios dele.
- Os dados de cada relatório respeitam a visibilidade de quem vê, por `can_access_for`.
- No link público, quem vê é o dono do painel.

### Cores
- `insight_colors (company_id, field, value, color)`: cor padrão da empresa por campo e valor, como `status`/`won`.
- `insight_saved_colors (user_id, colors text[])`: as "Minhas cores salvas".
- Ordem de prioridade:
  1. `report.colors[valor]`;
  2. a cor da empresa;
  3. a cor do próprio cadastro (etiqueta);
  4. a paleta do sistema, na ordem.
- A paleta tem 42 cores, em 3 linhas de 14 (claras, médias e escuras), a mesma do Pipedrive.

### Migração
- As tabelas `reports`, `dashboards`, `dashboard_widgets`, `dashboard_shares` e `dashboard_share_links` são removidas, assim como as funções do motor v1/v2 que só elas usam. Os dados delas só existem no banco de desenvolvimento.
- As metas (`goals`) e o cálculo de progresso delas ficam como estão.
- As permissões continuam iguais:
  - `view_reports` para ver;
  - `can_create_dashboards` para criar relatórios e painéis;
  - `share_dashboards` para compartilhar e criar links.

## 2. Motor (Postgres, plpgsql)

### Catálogo
- `insights_field(data_type, report_type, field_id)` devolve a expressão SQL, o tipo (padrão Pipedrive: TEXT, USER, BOOLEAN, ORGANIZATION, PERSON, MONETARY, NUMERICAL, SINGLE_OPTION, DATE_TIME, DATE, MULTIPLE_OPTIONS, ID, PRODUCT), o rótulo e os papéis possíveis (filtro, ver por, segmentar por, medir por).
- Os ids e rótulos são os do Pipedrive, por exemplo: `addTime`, `userId`, `creatorUserId`, `label`, `channel`, `status`, `wonTime`, `lostTime`, `expectedCloseDate`, `stageId`, `pipelineId`, `lostReason`, `type`, `outcome`, `done`, `dueDate`, `markedAsDoneTime`, `orgId`, `personId`, `ownerId`, `activitiesCount`, `doneActivitiesCount` e outros.
- Campos personalizados entram com o id igual à chave do campo (`custom_field_defs.key`).
- Campos ligados são o prefixo mais o campo da outra entidade:
  - prefixos: `deal_id_`, `lead_id_`, `person_id_`, `org_id_`, `activity_id_`;
  - para a ligação direta (o negócio, o lead, a pessoa ou a organização do registro) viram um join;
  - para coleções (as atividades do lead, os leads da organização) viram `exists`.
- `insights_catalog(company)` devolve o catálogo para a tela. Para cada entidade e tipo, inclui os campos com operadores e as opções: usuários, etiquetas, canais, resultados, tipos, funis, etapas, motivos, produtos e as opções dos campos personalizados.

### Execução
`insights_run(company, definição, viewer, overrides)` devolve:

**Gráfico:** `{x:[{key,label}], segments:[{key,label}], values:[[...]], total, previous?, compare?}`.
- Na **performance/stats**, a medida pode ser contagem, soma, média ou um campo numérico.
  - "Ver por" de data agrupa por dia, semana, mês, trimestre ou ano, preenchendo os buracos dentro do período.
  - A segmentação é opcional.
  - Com `is_cumulative`, os valores vão acumulando.
- **funnel_conversion:** para cada etapa escolhida, quantos negócios chegaram a ela, a conversão para a etapa seguinte e a taxa de ganho, pelo histórico de etapas.
- **conversion_overall / leads conversion:** ganhos, perdidos e abertos por "Ver por", com a taxa.
- **duration:** tempo médio (ou total) em cada etapa, em dias, a partir de `deal_stage_history`.
- **progress:** negócios que entraram em cada etapa no período.
- **product_performance:** quantidade e valor por produto (`deal_items`).
- **revenue_forecast:** fechamento esperado ou data do ganho, por intervalo, com acumulado.

**Cartão de número:**
- Mostra o total e o mesmo total no período anterior, com a variação.
- O período anterior é calculado pelo primeiro filtro de data com `period`.

**Comparar:** período anterior ou período personalizado. Gera `compare.values` com o mesmo formato do gráfico.

**Lista de registros:**
- `insights_records(...)`, paginada (50 por página) e ordenável, com as colunas pedidas.
- Ao clicar numa barra, a lista filtra pelo ponto (x e segmento) clicado.

**Resumo:** contagem, soma e média da medida, e a mesma coisa por x.

**Segurança:**
- Ids, operadores e intervalos vêm só do catálogo.
- Os valores entram como parâmetros (`$1`).
- A visibilidade de cada registro passa por `can_access_for(viewer, company, entity, owner, 'read')`.

**Filtros rápidos do painel (overrides):**
- O período substitui os operandos de todo filtro de data que tem `period`. Os relatórios sem filtro de data com período não mudam.
- O usuário entra como filtro de dono (`userId`/`ownerId`) e substitui o dono que o relatório já tiver.
- O funil substitui `pipelineId` nos relatórios de negócio. Nas outras entidades, é ignorado.

## 3. Telas

**Rotas:**
- `/[empresa]/relatorios`: o Insights, que abre o último painel visto, ou a lista quando não há painel.
- `/[empresa]/relatorios/paineis/[id]`
- `/[empresa]/relatorios/r/[id]`
- `/[empresa]/relatorios/r/novo?entidade=&tipo=`
- `/[empresa]/relatorios/metas`
- `/d/[token]`: o link público.

**Lateral do Insights:**
- Botão Criar, com Relatório, Meta e Painel.
- Busca.
- Seções Painéis, Metas e Relatórios (com contador), cada uma separada em "Compartilhado comigo" e "Meus".

**Criar relatório:** um diálogo para escolher a entidade e depois o tipo, com a descrição de cada um como no Pipedrive.

**Editor de relatório:**
- Cabeçalho:
  - nome editável;
  - Salvar ou Descartar enquanto houver alteração;
  - "Adicionar ao painel", com a lista de painéis e um "novo painel";
  - menu com Duplicar, Compartilhar e Excluir.
- Seletor de tipo.
- Painel de filtros:
  - mostra "N filtros aplicados" e o resumo em chips;
  - cada linha tem entidade › campo (busca) › operador › valor (período com datas, opções, usuário, número ou texto);
  - botão "Adicionar filtro".
- Cartão do gráfico:
  - tipos de gráfico permitidos;
  - Comparar;
  - Exportar (CSV da tabela e PNG do gráfico);
  - engrenagem com "Colunas por página" (6, 7, 12, 13, 14, 18, 24) e "Personalizar cores do gráfico".
- Eixos:
  - "Medir por" no eixo Y;
  - "Ver por" no eixo X, com intervalo quando é data;
  - "Segmentar por", com ✕ para tirar;
  - "Ordenar por": padrão, valor crescente ou decrescente, nome.
- Legenda à direita e paginação das colunas.
- Embaixo, a aba da lista de registros (colunas configuráveis, ordenação, exportar) e a aba "Resumo".

**Diálogo de cores:** à esquerda os segmentos; à direita a paleta do sistema, "Minhas cores salvas" com "+ Adicionar novo", "Cor personalizada" e a caixa "Usar como padrão da empresa".

**Painel:**
- Cabeçalho:
  - nome editável;
  - filtros rápidos Período (presets e intervalo), Usuário e Funil, guardados por usuário;
  - menu com Compartilhar com usuários, Compartilhar como link público, Exportar PDF (impressão), Exportar PNG, Duplicar e Excluir.
- Grade:
  - 4 colunas, com posição e tamanho livres;
  - quem pode editar arrasta e redimensiona (react-grid-layout);
  - o layout é salvo ao soltar.
- Cada widget mostra o ícone da entidade, o nome (que abre o relatório), os chips dos filtros ("ESTE MÊS · OMNI11 · SIM"), o gráfico e um menu com Abrir, Remover do painel e Duplicar.

**Gráficos (recharts):**
- Coluna e barra, empilhadas quando há segmento, com rótulo de valor.
- Pizza com rótulo "n (p%)" e legenda.
- Número com ▲/▼ e variação.
- Tabela dinâmica: linhas × segmentos, com totais.
- Funil: barras com a conversão entre etapas e a taxa de ganho.
- Sem dados: o aviso "Os resultados não podem ser exibidos com as opções de filtro ou agrupamento atuais."

## 4. Painéis do Pipedrive

Script `pnpm insights:pipedrive <email-do-dono>`, idempotente: recria pelo nome.

1. Lê os painéis e relatórios do Pipedrive pelo token.
2. Para cada empresa do Oxyn, escolhe a fonte:
   - **KPIs:**
     - o "KPIS - <EMPRESA> novo" quando existe (OMNI11 → volt, HARPIX);
     - nas outras empresas, os blocos comuns (LEADS e NEGÓCIOS) do "KPIS - OMNI11 novo";
     - os blocos de evento (Fórum, Jitterbit, Brasil Sessions) só existem nas empresas que os têm.
   - **Diretoria:**
     - o "<EMPRESA> - Resultados diretoria" quando existe;
     - nas outras empresas, o da HARPIX.
3. Traduz cada relatório:
   - a etiqueta da empresa e as etiquetas de pessoa da empresa saem, porque o escopo já é a empresa;
   - o filtro de etiqueta de pessoa de outra empresa (por exemplo, `isNot`) sai;
   - usuários são casados pelo e-mail;
   - canais, resultados, motivos, tipos, funis e etapas são casados pelo nome, usando os dados do Pipedrive (`activityFields`, `dealFields`, `leadFields`, `stages`, `pipelines`);
   - campos personalizados são casados pelo rótulo;
   - quando a referência não existe na empresa, o filtro passa a não trazer nada, em vez de virar "todos";
   - as diferenças ficam registradas no relatório de tradução que o script imprime.
4. Grava os relatórios, o painel e o layout com as mesmas posições do Pipedrive, e compartilha com os membros ativos da empresa.
5. Coloca o filtro rápido "Este mês" no painel de KPIs.

Conferência: o script `--conferir` roda os relatórios de número da OMNI11 e da HARPIX no Oxyn e no Pipedrive (`insights-api/<entidade>/chart`) e imprime as diferenças.

## 5. Testes

- **pgTAP:**
  - esquema e RLS (dono, compartilhado, editor, link público);
  - catálogo;
  - cada operador e período;
  - cada tipo de relatório;
  - campos ligados e personalizados;
  - os filtros rápidos (regra de período);
  - visibilidade.
- **Vitest:**
  - tipos e validação (zod) da definição;
  - formatação do gráfico (pivot, acumulado, variação, cores);
  - a tradução do Pipedrive.
- **Playwright:**
  - criar um relatório, filtrar, segmentar, trocar a cor, salvar, adicionar a um painel, mover no painel, usar o filtro rápido e abrir o link público.
