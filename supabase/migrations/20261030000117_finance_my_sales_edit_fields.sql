-- Financeiro: a edição de uma venda pelo vendedor precisa dos campos que a lista não trazia
-- (contrato/linha, parcelas e meses do setup e da recorrência, observação). Só colunas novas ao final.
drop function public.fin_my_sales(uuid);
create function public.fin_my_sales(p_company uuid)
returns table(id uuid, contract_title text, buyer text, sold_on date, setup_value numeric, recurring_value numeric,
              recurring_months int, status text, editable boolean,
              contract_id uuid, line_id uuid, setup_installments int, setup_first_month date,
              recurring_start date, note text)
language plpgsql stable security definer set search_path = public, pg_temp as $$
#variable_conflict use_column
begin
  if p_company is null or not public.can_finance(p_company, 'sell') then
    raise exception 'OXYN_FORBIDDEN' using errcode = '42501';
  end if;
  return query
    select s.id, c.title, s.buyer, s.sold_on, s.setup_value, s.recurring_value, s.recurring_months, s.status,
           not exists (select 1 from public.fin_entries e where e.client_sale_id = s.id and e.status = 'settled'),
           s.contract_id, s.contract_line_id, s.setup_installments, s.setup_first_month,
           s.recurring_start, s.note
      from public.fin_client_sales s
      join public.fin_contracts c on c.id = s.contract_id
     where s.company_id = p_company and s.created_by = auth.uid()
     order by s.sold_on desc, s.created_at desc, s.id;
end $$;
revoke execute on function public.fin_my_sales(uuid) from public, anon;
grant execute on function public.fin_my_sales(uuid) to authenticated;
