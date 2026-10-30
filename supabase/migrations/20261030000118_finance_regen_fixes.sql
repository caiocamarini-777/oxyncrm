-- Financeiro: correções da regeneração de contratos e despesas recorrentes.
-- 1. Comissão estimada: só do mês corrente (São Paulo) em diante, e nunca somada à comissão real —
--    competência em que a linha já tem lançamentos de venda (source_kind 'sale', não cancelados)
--    fica sem estimativa. Mudanças nas vendas da linha regeram as estimativas do contrato.
-- 2. Contrato inativo (cancelado) / despesa inativa: só somem as abertas do mês corrente em diante;
--    as vencidas continuam visíveis para cobrança/pagamento.

-- Mês corrente em São Paulo (dia 1).
create or replace function public.fin_current_month() returns date
language sql stable set search_path = public, pg_temp as $$
  select date_trunc('month', (now() at time zone 'America/Sao_Paulo')::date)::date;
$$;

-- A linha de comissão tem comissão real (venda) na competência?
create or replace function public.fin_line_has_sales(p_line uuid, p_comp date) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1
      from public.fin_entries se
      join public.fin_client_sales s on s.id = se.client_sale_id
     where s.contract_line_id = p_line
       and se.source_kind = 'sale'
       and se.status <> 'cancelled'
       and se.competence = p_comp);
$$;
revoke execute on function public.fin_line_has_sales(uuid, date) from public, anon, authenticated;

create or replace function public.fin_regenerate_contract(p_contract uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  c public.fin_contracts;
  l public.fin_contract_lines;
  v_found boolean;
  v_horizon date := public.fin_horizon_end();
  v_month date := public.fin_current_month();
  v_rule text;
  v_comp date;
  v_cycle int;
  v_len int;
  v_gross numeric(14,2);
  v_acc numeric(14,2);
  i int;
begin
  select * into c from public.fin_contracts where id = p_contract;
  v_found := found;

  if v_found and c.status <> 'active' then
    -- inativo (rascunho/cancelado): só o futuro some; as abertas vencidas ficam
    delete from public.fin_entries
     where contract_id = p_contract and source_kind = 'contract' and status = 'open' and not locked
       and competence >= v_month;
    return;
  end if;

  delete from public.fin_entries
   where contract_id = p_contract and source_kind = 'contract' and status = 'open' and not locked;
  if not v_found then
    return;
  end if;
  v_rule := coalesce(c.end_rule, 'ends');

  for l in select * from public.fin_contract_lines where contract_id = p_contract order by created_at, id loop
    if l.kind = 'setup' then
      v_acc := 0;
      for i in 0 .. l.installments - 1 loop
        if i < l.installments - 1 then
          v_gross := trunc(l.amount / l.installments, 2);
        else
          v_gross := l.amount - v_acc;
        end if;
        v_acc := v_acc + v_gross;
        v_comp := (l.first_month + make_interval(months => i))::date;
        insert into public.fin_entries (company_id, direction, source_kind, contract_id, contract_line_id,
          due_date, competence, gross, retention, account_id, organization_id, service_category_id, description)
        values (c.company_id, 'in', 'contract', c.id, l.id,
          public.fin_due_date(v_comp, c.due_day), v_comp, v_gross, round(v_gross * c.retention_rate / 100, 2),
          c.account_id, c.organization_id, l.service_category_id, c.title || ' – ' || l.description)
        on conflict (contract_line_id, competence) where contract_line_id is not null do nothing;
      end loop;

    elsif l.kind = 'recurring' or (l.kind = 'commission' and l.estimated_monthly is not null) then
      v_comp := l.first_month;
      v_cycle := 0;
      loop
        v_len := case when v_cycle = 0 then l.months else coalesce(c.renewal_months, l.months) end;
        v_gross := case
          when l.kind = 'commission' then l.estimated_monthly
          when v_rule = 'renew_adjust' then round(l.amount * power(1 + c.adjust_rate / 100, v_cycle::numeric), 2)
          else l.amount end;
        for i in 1 .. v_len loop
          exit when v_comp >= v_horizon;
          -- estimativa de comissão: nada no passado, nada onde já há comissão real
          if l.kind <> 'commission'
             or (v_comp >= v_month and not public.fin_line_has_sales(l.id, v_comp)) then
            insert into public.fin_entries (company_id, direction, source_kind, contract_id, contract_line_id,
              due_date, competence, gross, retention, account_id, organization_id, service_category_id, description,
              is_renewal, renewal_pending, estimated)
            values (c.company_id, 'in', 'contract', c.id, l.id,
              public.fin_due_date(v_comp, c.due_day), v_comp, v_gross, round(v_gross * c.retention_rate / 100, 2),
              c.account_id, c.organization_id, l.service_category_id, c.title || ' – ' || l.description,
              v_cycle > 0, v_cycle > 0 and v_rule = 'confirm', l.kind = 'commission')
            on conflict (contract_line_id, competence) where contract_line_id is not null do nothing;
          end if;
          v_comp := (v_comp + interval '1 month')::date;
        end loop;
        exit when v_rule = 'ends' or v_comp >= v_horizon;
        v_cycle := v_cycle + 1;
      end loop;
    end if;
  end loop;
end $$;
revoke execute on function public.fin_regenerate_contract(uuid) from public, anon, authenticated;

create or replace function public.fin_regenerate_recurring(p_expense uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  e public.fin_recurring_expenses;
  v_found boolean;
  v_horizon date := public.fin_horizon_end();
  v_month date := public.fin_current_month();
  v_step int;
  v_comp date;
  v_t0 int;
  v_d int;
  v_n int;
  v_gross numeric(14,2);
  i int := 0;
begin
  select * into e from public.fin_recurring_expenses where id = p_expense;
  v_found := found;

  if v_found and not e.active then
    -- inativa: só o futuro some; as abertas vencidas ficam
    delete from public.fin_entries
     where recurring_expense_id = p_expense and source_kind = 'recurring' and status = 'open' and not locked
       and competence >= v_month;
    return;
  end if;

  delete from public.fin_entries
   where recurring_expense_id = p_expense and source_kind = 'recurring' and status = 'open' and not locked;
  if not v_found then
    return;
  end if;
  v_step := case e.frequency when 'monthly' then 1 when 'quarterly' then 3 else 12 end;

  loop
    v_comp := (e.start_month + make_interval(months => i * v_step))::date;
    exit when v_comp >= v_horizon;
    exit when e.end_month is not null and v_comp > e.end_month;
    exit when e.installments is not null and i >= e.installments;

    -- n = vezes que adjust_month foi alcançado depois de start_month (sem contar o próprio start_month)
    v_n := 0;
    if e.adjust_month is not null then
      v_d := i * v_step;
      v_t0 := ((e.adjust_month - extract(month from e.start_month)::int) + 12) % 12;
      if v_t0 = 0 then v_t0 := 12; end if;
      if v_d >= v_t0 then
        v_n := 1 + (v_d - v_t0) / 12;
      end if;
    end if;
    v_gross := round(e.amount * power(1 + e.adjust_rate / 100, v_n::numeric), 2);

    insert into public.fin_entries (company_id, direction, source_kind, recurring_expense_id,
      due_date, competence, gross, account_id, expense_category_id, nature, description)
    values (e.company_id, 'out', 'recurring', e.id,
      public.fin_due_date(v_comp, e.due_day), v_comp, v_gross, e.account_id, e.expense_category_id, e.nature,
      case when e.installments is not null
           then e.description || ' (' || (i + 1) || '/' || e.installments || ')'
           else e.description end)
    on conflict (recurring_expense_id, competence) where recurring_expense_id is not null do nothing;
    i := i + 1;
  end loop;
end $$;
revoke execute on function public.fin_regenerate_recurring(uuid) from public, anon, authenticated;

-- Recalcula as estimativas de comissão de um contrato depois de mudar as vendas.
-- Ativo: regera (só se tiver linha de comissão com estimativa). Outros status: só tira a estimativa
-- aberta das competências que já têm comissão real.
create or replace function public.fin_sync_commission_estimates(p_contract uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_status text;
begin
  if p_contract is null then
    return;
  end if;
  select status into v_status from public.fin_contracts where id = p_contract;
  if v_status is null then
    return;
  end if;
  if not exists (select 1 from public.fin_contract_lines
                  where contract_id = p_contract and kind = 'commission' and estimated_monthly is not null) then
    return;
  end if;
  if v_status = 'active' then
    perform public.fin_regenerate_contract(p_contract);
  else
    delete from public.fin_entries e
     where e.contract_id = p_contract and e.source_kind = 'contract' and e.estimated
       and e.status = 'open' and not e.locked
       and public.fin_line_has_sales(e.contract_line_id, e.competence);
  end if;
end $$;
revoke execute on function public.fin_sync_commission_estimates(uuid) from public, anon, authenticated;

-- Venda criada/alterada/apagada: regera a venda e as estimativas do contrato.
create or replace function public.fin_client_sales_regenerate() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'DELETE' then
    delete from public.fin_entries
     where client_sale_id = old.id and source_kind = 'sale' and status = 'open' and not locked;
    update public.fin_entries set client_sale_id = null where client_sale_id = old.id;
    perform public.fin_sync_commission_estimates(old.contract_id);
    return old;
  end if;
  perform public.fin_regenerate_sale(new.id);
  perform public.fin_sync_commission_estimates(new.contract_id);
  if tg_op = 'UPDATE' and new.contract_id is distinct from old.contract_id then
    perform public.fin_sync_commission_estimates(old.contract_id);
  end if;
  return null;
end $$;
revoke execute on function public.fin_client_sales_regenerate() from public, anon, authenticated;

create or replace function public.fin_contract_lines_regenerate_sales() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r record;
  v_any boolean := false;
begin
  for r in select id from public.fin_client_sales where contract_line_id = new.id loop
    perform public.fin_regenerate_sale(r.id);
    v_any := true;
  end loop;
  if v_any then
    perform public.fin_sync_commission_estimates(new.contract_id);
  end if;
  return null;
end $$;
revoke execute on function public.fin_contract_lines_regenerate_sales() from public, anon, authenticated;

create or replace function public.fin_contracts_regenerate_sales() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r record;
  v_any boolean := false;
begin
  for r in select id from public.fin_client_sales where contract_id = new.id loop
    perform public.fin_regenerate_sale(r.id);
    v_any := true;
  end loop;
  if v_any then
    perform public.fin_sync_commission_estimates(new.id);
  end if;
  return null;
end $$;
revoke execute on function public.fin_contracts_regenerate_sales() from public, anon, authenticated;

-- Cancelar (ou descancelar) um lançamento de venda à mão também muda a estimativa daquela competência.
create or replace function public.fin_entries_sale_status_sync() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.fin_sync_commission_estimates(new.contract_id);
  return null;
end $$;
revoke execute on function public.fin_entries_sale_status_sync() from public, anon, authenticated;

create trigger fin_entries_sale_status_sync after update of status on public.fin_entries
  for each row
  when (new.source_kind = 'sale' and (old.status = 'cancelled') is distinct from (new.status = 'cancelled'))
  execute function public.fin_entries_sale_status_sync();

-- Aplica as regras novas aos contratos ativos e despesas ativas existentes (tira estimativas no
-- passado e as que duplicam comissão real).
do $$
declare
  r record;
begin
  for r in select distinct contract_id as id from public.fin_contract_lines
            where kind = 'commission' and estimated_monthly is not null loop
    perform public.fin_sync_commission_estimates(r.id);
  end loop;
end $$;
