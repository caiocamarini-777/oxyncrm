-- Financeiro: a retenção nunca passa do valor bruto (o líquido nunca fica negativo).
-- Verificado antes no banco de desenvolvimento: nenhuma linha viola.
alter table public.fin_entries
  add constraint fin_entries_retention_le_gross check (gross >= retention);
