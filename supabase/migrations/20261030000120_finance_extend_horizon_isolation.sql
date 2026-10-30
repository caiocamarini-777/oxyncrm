-- Financeiro: a extensão mensal do horizonte isola cada contrato/despesa (um erro vira warning e o
-- job segue) e ignora empresas com o Financeiro desligado ou arquivadas.

create or replace function public.fin_extend_horizon() returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r record;
  v_month date := public.fin_current_month();
begin
  for r in
    select c.id from public.fin_contracts c join public.companies co on co.id = c.company_id
     where c.status = 'active' and co.finance_enabled and co.archived_at is null
  loop
    begin
      perform public.fin_regenerate_contract(r.id);
    exception when others then
      raise warning 'fin_extend_horizon: contrato %: % (%)', r.id, sqlerrm, sqlstate;
    end;
  end loop;

  for r in
    select e.id from public.fin_recurring_expenses e join public.companies co on co.id = e.company_id
     where e.active and co.finance_enabled and co.archived_at is null
  loop
    begin
      perform public.fin_regenerate_recurring(r.id);
    exception when others then
      raise warning 'fin_extend_horizon: despesa recorrente %: % (%)', r.id, sqlerrm, sqlstate;
    end;
  end loop;

  for r in
    select c.id from public.fin_contracts c join public.companies co on co.id = c.company_id
     where c.status = 'active' and c.end_rule = 'ends' and co.finance_enabled and co.archived_at is null
       and (select max(competence) from public.fin_entries
             where contract_id = c.id and source_kind = 'contract') < v_month
  loop
    begin
      update public.fin_contracts set status = 'ended' where id = r.id;
    exception when others then
      raise warning 'fin_extend_horizon: encerrar contrato %: % (%)', r.id, sqlerrm, sqlstate;
    end;
  end loop;
end $$;
revoke execute on function public.fin_extend_horizon() from public, anon, authenticated;
