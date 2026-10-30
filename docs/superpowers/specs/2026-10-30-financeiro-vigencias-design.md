# Financeiro: vigência em todo item, acumulado, resultado mês a mês e alterações visíveis

Data: 2026-10-30. Complementa [2026-10-29-financeiro-design.md](2026-10-29-financeiro-design.md), depois do primeiro uso.

## Decisões do usuário (2026-10-30)

- Toda receita e toda despesa tem **início e fim**, qualquer que seja o tipo, inclusive avulsos. O avulso é um item com periodicidade "Única", cujo fim é igual ao início.
- Os relatórios devem mostrar um **gráfico acumulado comparativo**: quanto entrou e quanto saiu, somados mês a mês.
- Os relatórios devem mostrar, **mês a mês, quanto sobra no caixa**, ou seja, o resultado do mês (entradas − saídas, que pode ser negativo).
- Qualquer alteração manual deve ser percebida: o lançamento editado à mão aparece com o **selo "editado"** e o **valor previsto original** ao lado.

## Mudanças

### Vigência em todo item

- **Receitas e despesas recorrentes avulsas.** A tabela `fin_recurring_expenses` passa a guardar itens dos dois sentidos.
  - Ganha `direction` (`in` ou `out`, padrão `out`), `income_category_id`, `service_category_id` e `organization_id`.
  - Para `in`, `nature` fica nula; para `out`, `nature` continua obrigatória.
  - A geração respeita o sentido do item.
- **`end_month` obrigatório** em todo item novo ou alterado.
  - Os itens antigos sem fim (os da carga) continuam válidos, mas a tela os marca com "Defina o fim".
  - Ao salvar um desses itens, o fim passa a ser exigido.
- **Novo lançamento.** O formulário pede:
  - sentido, descrição, categoria e valor;
  - periodicidade: Única, Mensal, Trimestral ou Anual;
  - **Início** e **Fim**, ambos obrigatórios.
  - Com "Única", o resultado é um lançamento avulso na data de início. Com as outras periodicidades, vira um item recorrente.
- **Contratos.** No editor de linhas, as linhas recorrentes e de comissão passam a mostrar **Início** e **Fim** (mês/ano) no lugar de "meses". O número de meses é calculado a partir dos dois. A linha de setup mostra o início e as parcelas, e o fim é exibido já calculado. A lista e o detalhe do contrato mostram a vigência como "início – fim".
- **Aba "Despesas" vira "Recorrentes".** Ela lista entradas e saídas, com as colunas Início e Fim, e o selo "Defina o fim" quando o item não tem fim.

### Relatórios

- **Período da Projeção.** Ela passa a cobrir de janeiro do ano corrente até o fim do horizonte escolhido. Os meses passados mostram o realizado (só lançamentos liquidados) com o rótulo "realizado".
- **Gráfico acumulado.** Duas linhas, entradas acumuladas e saídas acumuladas, mês a mês. Uma área destaca a diferença entre elas.
- **Resultado do mês.** Um gráfico de barras com o resultado de cada mês, verde quando positivo e vermelho quando negativo. A tabela da Projeção ganha também a linha "Resultado acumulado".
- **Filtros.** Os filtros existentes valem para os novos gráficos.

### Alterações manuais visíveis

- `fin_entries` ganha `original_gross` e `original_due_date`. O trigger de trava preenche os dois na primeira edição manual de um lançamento gerado (contrato, recorrente ou venda), guardando os valores de antes da edição. As travas seguintes não os sobrescrevem.
- **Selo "editado".** Aparece nos lançamentos travados, na visão Mês, em Lançamentos e no detalhe do contrato, com o texto "previsto R$ X em dd/mm".
- **Selo "pago diferente".** Aparece no lançamento liquidado cujo valor pago é diferente do previsto, com o texto "pago R$ Y · previsto R$ X".
- **Filtro "Só alterados".** Fica em Lançamentos e mostra apenas os lançamentos editados ou pagos com valor diferente do previsto.

## Fora do escopo

- Histórico completo de alterações (quem e quando).
- Aviso agregado nos relatórios.
