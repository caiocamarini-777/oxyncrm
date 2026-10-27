# Fase 6.5: painéis iguais ao Pipedrive

> Execução: inline (executing-plans), o usuário pediu para seguir sem aprovação intermediária e avisar no fim.

**Goal:** os painéis "KPIS - <EMPRESA>" e "<EMPRESA> - Resultados diretoria" do Pipedrive existirem no Oxyn para as 7
empresas, com os mesmos relatórios, filtros, gráficos e posições, sobre dados completos.

**Origem (levantada em 2026-10-27 no Pipedrive, API interna do Insights):** painel KPIS - HARPIX novo (34 relatórios)
e HARPIX - Resultados diretoria (15). As outras empresas têm a mesma visão. A especificação de cada relatório está no
catálogo `src/lib/reports/pipedrive-dashboards.ts` (Task 5), que é a fonte de verdade desta fase.

## Global Constraints

- Banco continua a autoridade do motor: SQL montado só a partir de mapas fixos; valores do usuário sempre por parâmetro.
- Visibilidade: toda base nova passa por `can_access_for(viewer, company, entity, owner, 'read')`.
- Migrações novas só a partir de `20261028000001`; nada de editar migração antiga.
- Backfill não apaga registro; só preenche campos a partir do Pipedrive via `external_ids`.
- Toda mensagem e texto de tela em PT-BR.

## Decisões (rulings)

1. **Canal de origem** do lead e do negócio = `lead_sources` da empresa (nomes do campo "Canal de origem" do
   Pipedrive). Negócio ganha `deals.source_id`. O "source_name" do Pipedrive (Import, Manually created) deixa de
   ser a origem; fontes que ficarem sem uso são desativadas.
2. **Resultado da atividade** = `activity_outcomes` com os nomes do Pipedrive (um por nome na empresa). Reunião
   passa a aceitar `outcome_id` junto com `meeting_outcome` (cai o check que proibia os dois); Concluída
   Qualificada/Desqualificada/com Pendência => held + outcome; Não compareceu => no_show; Remarcada => rescheduled.
   O diálogo de concluir reunião ganha o seletor de resultado.
3. **Ligação** do Pipedrive vai para o canal "Telefone" (antes caía em "Não informado").
4. **Motor:** bases `organizations` e `persons`; `segment_by` (segunda dimensão, barras empilhadas); período
   relativo (`relative`: this_week, last_week, this_month, last_month, this_year, last_year) resolvido no banco em
   America/Sao_Paulo; comparação com o período anterior no cartão de número; gráfico `list` (registros com colunas
   escolhidas); campos ligados por `exists` (atividade da pessoa/lead/organização, canal da pessoa); dimensões
   organização, concluída e "tipo Pipedrive" (Reunião ou canal); campo de valor do negócio; preset
   `stage_duration`; previsão acumulada (`cumulative`) feita na tela.
5. **Painel:** grade de 4 colunas; filtros rápidos período (com relativos), usuário e funil; o período do painel
   substitui o período de cada widget (como no Pipedrive), em vez de recortar.
6. **Etiqueta da empresa** do Pipedrive (HARPIX etc.) vira o escopo de empresa do relatório; não é filtro.
7. **Seed:** `pnpm dashboards:pipedrive` cria (ou recria, idempotente pelo nome) os relatórios salvos da empresa e os
   dois painéis por empresa, donos do admin geral, compartilhados com os membros da empresa.

## Tasks

1. Migração de modelo: `deals.source_id`, check de reunião, índices. pgTAP.
2. Backfill `pnpm backfill:pipedrive` + mapeamento da importação (canal, resultado, ligação). Vitest.
3. Motor v2 (migração 20261028000002): bases, segmento, relativo, comparação, list, exists, dimensões, preset.
   pgTAP por recurso.
4. Espelho TS (`spec.ts`), construtor de relatório, gráficos (empilhado, lista, cartão com variação, acumulado),
   grade de 4 colunas e filtros rápidos. Vitest.
5. Catálogo dos painéis + seed para as 7 empresas.
6. Validação: números da HARPIX contra o Pipedrive no mesmo período; e2e do painel.

## Review Focus

- Empresa sem dados (FQD STUDIOS): painel abre com zeros, sem erro.
- Período relativo na virada do mês/semana (fuso São Paulo).
- Usuário sem visibilidade de empresa: widgets de outra empresa não vazam.
- Filtro rápido de funil em widget de base sem funil: ignorado, sem erro.
- Reimportação depois do backfill não desfaz canal/resultado.
