-- Financeiro: baixa, reabertura e trava de lançamentos editados à mão.

-- Editar valor, retenção, vencimento ou descrição de um lançamento gerado (contrato/recorrente)
-- trava o lançamento: a regeneração passa a preservá-lo.
create or replace function public.fin_entries_lock_on_edit() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if new.source_kind in ('contract', 'recurring') and not new.locked
     and (new.gross is distinct from old.gross
          or new.retention is distinct from old.retention
          or new.due_date is distinct from old.due_date
          or new.description is distinct from old.description) then
    new.locked := true;
  end if;
  return new;
end $$;
create trigger fin_entries_lock_on_edit before update on public.fin_entries
  for each row execute function public.fin_entries_lock_on_edit();

-- Liquida lançamentos abertos. p_amount só vale para um único lançamento.
create or replace function public.fin_settle_entries(
  p_ids uuid[], p_settled_on date, p_account uuid default null, p_amount numeric default null
) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  e record;
  n int := 0;
begin
  if p_ids is null or coalesce(array_length(p_ids, 1), 0) = 0 or p_settled_on is null then
    raise exception 'OXYN_INVALID_ARGS';
  end if;
  if p_amount is not null and array_length(p_ids, 1) <> 1 then
    raise exception 'OXYN_AMOUNT_SINGLE_ONLY';
  end if;
  if p_amount is not null and p_amount < 0 then
    raise exception 'OXYN_INVALID_ARGS';
  end if;

  for e in select id, company_id from public.fin_entries where id = any(p_ids) order by id for update loop
    if not public.can_finance(e.company_id, 'manage') then
      raise exception 'OXYN_FORBIDDEN' using errcode = '42501';
    end if;
  end loop;

  update public.fin_entries
     set status = 'settled',
         settled_on = p_settled_on,
         settled_amount = coalesce(p_amount, amount),
         account_id = coalesce(p_account, account_id)
   where id = any(p_ids) and status = 'open';
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function public.fin_settle_entries(uuid[], date, uuid, numeric) from public, anon;
grant execute on function public.fin_settle_entries(uuid[], date, uuid, numeric) to authenticated;

-- Desfaz a baixa.
create or replace function public.fin_reopen_entry(p_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  e public.fin_entries;
begin
  select * into e from public.fin_entries where id = p_id for update;
  if not found or not public.can_finance(e.company_id, 'manage') then
    raise exception 'OXYN_FORBIDDEN' using errcode = '42501';
  end if;
  if e.status <> 'settled' then
    raise exception 'OXYN_ENTRY_NOT_SETTLED';
  end if;
  update public.fin_entries set status = 'open', settled_on = null, settled_amount = null where id = p_id;
end $$;
revoke execute on function public.fin_reopen_entry(uuid) from public, anon;
grant execute on function public.fin_reopen_entry(uuid) to authenticated;
