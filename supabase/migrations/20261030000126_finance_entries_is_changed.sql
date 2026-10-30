-- Filtro "Só alterados": o PostgREST não compara duas colunas, então a regra vira coluna gerada.
-- amount é gerada (gross - retention) e uma coluna gerada não pode ler outra; por isso a expressão é repetida.
alter table fin_entries
  add column is_changed boolean generated always as (
    locked or (status = 'settled' and settled_amount <> (gross - retention))
  ) stored;
