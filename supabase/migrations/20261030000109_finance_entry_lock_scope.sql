-- Financeiro: a trava também vale para conta, cliente, categorias e natureza editados à mão.
-- Baixa e reabertura (mudam o status) nunca travam, mesmo trocando a conta.
create or replace function public.fin_entries_lock_on_edit() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if new.source_kind in ('contract', 'recurring') and not new.locked
     and new.status is not distinct from old.status
     and (new.gross is distinct from old.gross
          or new.retention is distinct from old.retention
          or new.due_date is distinct from old.due_date
          or new.description is distinct from old.description
          or new.account_id is distinct from old.account_id
          or new.organization_id is distinct from old.organization_id
          or new.service_category_id is distinct from old.service_category_id
          or new.income_category_id is distinct from old.income_category_id
          or new.expense_category_id is distinct from old.expense_category_id
          or new.nature is distinct from old.nature) then
    new.locked := true;
  end if;
  return new;
end $$;
