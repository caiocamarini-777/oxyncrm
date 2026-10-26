# Pendências da fase 3 (funil e receita)

Registro do que foi decidido, adiado e do que precisa de ação antes de seguir. A fase 3 entrega funis, produtos, negócios (kanban, lista, forecast e detalhe), cronograma de receita e a conversão de lead.

## Decisões

- Regras que protegem dados ficam no banco; a interface repete a validação, mas nunca é a única barreira.
- Um funil e suas etapas pertencem a uma empresa. Etapas nunca são removidas com negócios dentro, nem com negócios na lixeira (mensagens diferentes para cada caso). Funis e etapas arquivados não recebem negócios, e o banco garante isso (`OXYN_PIPELINE_ARCHIVED`, `OXYN_STAGE_ARCHIVED`).
- Condições de contrato mantêm os checks da especificação: MRR exige início e duração, setup exige o mês da primeira parcela. Por isso, ao adicionar o primeiro item recorrente ou de setup a um negócio sem essas datas, a interface as pede no mesmo fluxo e a ação as grava antes do item.
- Os totais são calculados por tipo: o setup vem dos itens de setup só quando há itens de setup, e o MRR vem dos itens recorrentes só quando há itens recorrentes. Um tipo sem itens mantém o valor digitado e continua editável; remover o último item de um tipo zera só aquele tipo. O tipo e o produto de um item são copiados na criação e não mudam.
- Lead desqualificado pode ser arquivado (além de aberto para desqualificado ou arquivado, e de volta para aberto).
- Valores em reais sem vírgula: pontos em grupos de três são separador de milhar ("30.000" é trinta mil); nos outros casos o ponto é decimal ("1.5", "1500.25").
- Uma etapa que exige "Produtos" não recebe um negócio na criação nem na conversão, porque ainda não há itens. A interface cria e converte em etapas sem essa exigência e mostra a lista do que falta quando for o caso.
- A conversão de lead mantém o responsável do lead. As datas de ganho, perda e entrada na etapa são controladas pelo banco e ignoradas quando enviadas.
- `leads.converted_deal_id` só é gravado dentro de `convert_lead`.
- O filtro por etiqueta usa a semântica "todas as etiquetas selecionadas" (antes era "qualquer uma"), e etiqueta vazia mostra todos os registros.
- O indicador e o filtro de atividades ficam para a fase 4.

## Melhorias adiadas

Itens menores, sem risco de dados, que ficaram de fora de propósito:

- Banco: o índice do quadro é parcial; o seed de funis não restaura etapas excluídas (por desenho). Excluir definitivamente um negócio zera `leads.converted_deal_id` sem gerar evento no lead.
- `convert_lead` não revalida o lead depois do bloqueio de linha (janela de corrida pequena) e a flag `oxyn.converting` não tem a proteção de `pg_trigger_depth`.
- Produtos: a checagem "tipo não muda depois de usado" da tela conta só itens visíveis pela RLS (itens de negócios na lixeira não contam). Sem risco de dados: o tipo do item é copiado e não muda.
- Configurações de funis: prazo de esfriar só com espaços vira erro; a lista de etapas perde edições não salvas ao remontar; atualizar e arquivar funil não confere linhas afetadas; a alça de arrastar usa margem fixa.
- Ações: `moveDeal` não confere etapa arquivada antes de chamar o banco (o banco já recusa).
- Kanban: posições calculadas a partir dos vizinhos visíveis quando há filtros; o diálogo de obrigatórios pode sobrescrever edição simultânea; o E2E de teclado cobre levantar e cancelar (mover entre etapas pelo teclado, conferir à mão); o E2E de atualização periódica espera cerca de 30 s.
- Lista: `?funil=` arquivado lista tudo e a exportação filtra; cabeçalho "Fechamento" na lista e "Data de fechamento" no CSV; o status não limpa ao trocar para kanban; o aviso de truncamento não tem teste.
- Detalhe: tabela de itens apertada na coluna de 360 px (conferir visualmente); sem E2E com usuário padrão; o formulário perde o que foi digitado se outra pessoa alterou o negócio e esta aba atualiza; a chave do formulário ignora nomes de pessoa e organização vinculados; o fim da ordem usa o máximo visível pela RLS; empates em edição simultânea; a assinatura de `moveDeal` no plano está desatualizada (posição é opcional).
- Conversão e etiquetas: `{NULL}` em array retorna tudo (a URL já descarta valores que não são uuid); o rótulo de erro de `resolveLink` para negócios; a página do lead busca funis e campos mesmo quando não é conversível.

## Antes da importação do Pipedrive (fase 3.5)

Resolvidas na fase 3.5 (detalhes em `2026-10-26-fase-3-5-pendencias.md`):

- Resolvido: desvio autorizado para gravar `won_at`, `lost_at` e `stage_entered_at` históricos. A função `importing()` (GUC `oxyn.importing` presa a um `import_jobs` em execução, sem `auth.uid()`) faz os gatilhos respeitarem as datas. Commits 557e25b e 8fe0e40; migrações `20261026000001` e `20261026000002`.
- Resolvido: inserção de leads já convertidos e preenchimento de `converted_deal_id` fora de `convert_lead`, pelo mesmo desvio (inclusive conversão por UPDATE). Commits 557e25b e 8fe0e40; migrações `20261026000001` e `20261026000002`.
- Resolvido: histórico de etapas e cronograma de receita gerados a partir do importado, sem eventos de timeline falsos (timelines suprimidas durante a importação; `import_rebuild_deal_derivatives`). Commits d53335f e 27caf64; migrações `20261026000003` e `20261026000004`.
- Pendente, depois da primeira carga real: conferir o plano de execução do filtro por etiqueta (as funções `*_with_labels` já suportam volumes grandes e não devem exigir mudança).

## Notas para a fase 6 (relatórios)

- A policy de `deal_revenue_schedule` usa `can_read_record`, que roda SQL dinâmico por linha. Relatórios sobre o cronograma vão precisar de um `EXISTS` sobre `deals` que o planner consiga expandir em linha, ou de uma função de relatório security definer que aplique a visibilidade uma vez.
- Negócios perdidos mantêm as linhas do cronograma: relatórios de receita precisam juntar com `deals.status` (e ignorar perdidos, ou separar por status).
- Negócios abertos só com valor estimado não têm linhas no cronograma; previsão de receita que quiser incluí-los precisa usar `estimated_value` e a data de fechamento esperada.

## Ações manuais

- Antes do merge: as migrações da fase 3 foram editadas no lugar durante o desenvolvimento. O banco de desenvolvimento deve ser recriado ou resetado para refletir exatamente os arquivos de `supabase/migrations/` (as alterações foram reaplicadas à mão, então pode haver deriva).
- Em produção, aplicar as migrações do zero com `pnpm supabase db push --db-url "<URI do pooler de produção>"`, na ordem normal. Não há migração parcial a corrigir lá.
- Conferir que a extensão pg_cron e a rotina `purge_trash` continuam agendadas em produção depois da aplicação.

## Observações da última revisão

- "Excluir etapa" conta os negócios ativos sob as permissões de quem exclui; um gestor que só enxerga os próprios negócios pode receber a mensagem de lixeira mesmo havendo negócios de outros na etapa (o banco continua impedindo a exclusão).
- A regra de milhar do valor em reais faz "0.500" virar 500 e uma quantidade "1.500" virar 1500.
- No modal de campos obrigatórios, um negócio com produtos mostra os totais do contrato como editáveis, mas o valor do tipo calculado pelos produtos é ignorado ao salvar.
- Restaurar da lixeira um negócio de um funil arquivado ainda é permitido.
