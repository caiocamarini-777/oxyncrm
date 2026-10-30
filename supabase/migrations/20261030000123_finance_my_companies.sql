-- Financeiro: acesso do usuário em todas as empresas numa chamada só (menu e páginas),
-- no lugar de uma chamada a can_finance por empresa e ação. Mesma regra de can_finance; só
-- devolve empresas não arquivadas com o Financeiro ligado em que o usuário tem alguma das três.
create or replace function public.fin_my_companies()
returns table(company_id uuid, can_view boolean, can_manage boolean, can_sell boolean)
language sql stable security definer set search_path = public, pg_temp as $$
  select x.id, x.v, x.m, x.s
    from (
      select c.id,
             public.can_finance(c.id, 'view') as v,
             public.can_finance(c.id, 'manage') as m,
             public.can_finance(c.id, 'sell') as s
        from public.companies c
       where c.finance_enabled and c.archived_at is null
    ) x
   where x.v or x.m or x.s;
$$;
revoke execute on function public.fin_my_companies() from public, anon;
grant execute on function public.fin_my_companies() to authenticated;
