# Pendências da fase 3 (funil e receita)

Registro do que foi decidido, adiado e do que precisa de ação antes de seguir. A fase 3 entrega funis, produtos, negócios (kanban, lista, forecast e detalhe), cronograma de receita e a conversão de lead.

## Decisões

- Regras que protegem dados ficam no banco; a interface repete a validação, mas nunca é a única barreira.
- Um funil e suas etapas pertencem a uma empresa. Etapas nunca são removidas com negócios dentro (mensagem para mover antes) e funis e etapas arquivados não recebem negócios.
- Condições de contrato mantêm os checks da especificação: MRR exige início e duração, setup exige o mês da primeira parcela. Por isso, ao adicionar o primeiro item recorrente ou de setup a um negócio sem essas datas, a interface as pede no mesmo fluxo e a ação as grava antes do item.
- Com itens no negócio, os totais de setup e MRR vêm dos itens e não se editam à mão; remover o último item zera os totais. O tipo do item (setup ou recorrente) é copiado do produto e não muda.
- Uma etapa que exige "Produtos" não recebe um negócio na criação nem na conversão, porque ainda não há itens. A interface cria e converte em etapas sem essa exigência e mostra a lista do que falta quando for o caso.
- A conversão de lead mantém o responsável do lead. As datas de ganho, perda e entrada na etapa são controladas pelo banco e ignoradas quando enviadas.
- `leads.converted_deal_id` só é gravado dentro de `convert_lead`.
- O filtro por etiqueta usa a semântica "todas as etiquetas selecionadas" (antes era "qualquer uma"), e etiqueta vazia mostra todos os registros.
- O indicador e o filtro de atividades ficam para a fase 4.

## Melhorias adiadas

Itens menores, sem risco de dados, que ficaram de fora de propósito:

- Banco: o índice do quadro é parcial; o seed de funis não restaura etapas excluídas (por desenho). Excluir definitivamente um negócio zera `leads.converted_deal_id` e gera um evento "atualizado" genérico no lead.
- `convert_lead` não revalida o lead depois do bloqueio de linha (janela de corrida pequena), a checagem de funil arquivado não filtra por empresa, o gatilho de etapa não olha `pipelines.archived_at` e a flag `oxyn.converting` não tem a proteção de `pg_trigger_depth`.
- Configurações de funis: prazo de esfriar só com espaços vira erro; a lista de etapas perde edições não salvas ao remontar; atualizar e arquivar funil não confere linhas afetadas; a alça de arrastar usa margem fixa.
- Ações: `moveDeal` não confere etapa arquivada antes de chamar o banco (o banco já recusa).
- Kanban: posições calculadas a partir dos vizinhos visíveis quando há filtros; o diálogo de obrigatórios pode sobrescrever edição simultânea; o foco do teclado se perde no início do arraste; falta E2E de arraste por teclado (checar à mão); o E2E de atualização periódica espera cerca de 30 s.
- Lista: `?funil=` arquivado lista tudo e a exportação filtra; cabeçalho "Fechamento" na lista e "Data de fechamento" no CSV; o status não limpa ao trocar para kanban; o aviso de truncamento não tem teste.
- Detalhe: tabela de itens apertada na coluna de 360 px (conferir visualmente); sem E2E com usuário padrão; o formulário perde o que foi digitado se outra pessoa alterou o negócio e esta aba atualiza; a chave do formulário ignora nomes de pessoa e organização vinculados; o fim da ordem usa o máximo visível pela RLS; empates em edição simultânea; a assinatura de `moveDeal` no plano está desatualizada (posição é opcional).
- Conversão e etiquetas: o texto do filtro de etiqueta não diz "todas"; comentário da migração de etiquetas está truncado; `{NULL}` em array retorna tudo; o rótulo de erro de `resolveLink` para negócios; a página do lead busca funis e campos mesmo quando não é conversível; `?label=` não valida uuid em `parseListQuery`.

## Antes da importação do Pipedrive (fase 3.5)

- A importação precisa de um desvio autorizado (função definer ou flag de sessão restrita) para gravar `won_at`, `lost_at` e `stage_entered_at` históricos. Hoje `deals_status_fields` e `stage_entry` forçam esses valores.
- Também precisa inserir leads já convertidos, o que o guard de status do lead bloqueia, e preencher `converted_deal_id` fora de `convert_lead`.
- O histórico de etapas e o cronograma de receita devem ser gerados a partir do que for importado, sem disparar eventos de timeline falsos.
- Filtro por etiqueta: as funções `*_with_labels` já suportam volumes grandes (testado com 1200 registros por entidade e paginação até a última página), então a importação em massa não deve exigir mudança aí. Conferir o plano de execução depois da primeira carga real.

## Ações manuais

- Antes do merge: as migrações da fase 3 foram editadas no lugar durante o desenvolvimento. O banco de desenvolvimento deve ser recriado ou resetado para refletir exatamente os arquivos de `supabase/migrations/` (as alterações foram reaplicadas à mão, então pode haver deriva).
- Em produção, aplicar as migrações do zero com `pnpm supabase db push --db-url "<URI do pooler de produção>"`, na ordem normal. Não há migração parcial a corrigir lá.
- Conferir que a extensão pg_cron e a rotina `purge_trash` continuam agendadas em produção depois da aplicação.
