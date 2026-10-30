-- Fim obrigatório em item ativo: um item legado sem fim pode ser desativado sem informar o fim.
-- Continua NOT VALID, então os itens legados já gravados seguem válidos.
alter table public.fin_recurring_expenses
  drop constraint fin_recurring_expenses_end_month_required;
alter table public.fin_recurring_expenses
  add constraint fin_recurring_expenses_end_month_required check (end_month is not null or not active) not valid;
