-- Financeiro: rascunho → ativo só por fin_activate_contract (que valida os dados).
-- A função marca a ativação numa GUC local da transação (padrão de oxyn.converting); um UPDATE
-- direto de status 'draft' para 'active' sem a marca é rejeitado.

create or replace function public.fin_contracts_guard_activation() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if old.status = 'draft' and new.status = 'active'
     and coalesce(current_setting('oxyn.activating_contract', true), '') is distinct from new.id::text then
    raise exception 'OXYN_CONTRACT_ACTIVATE_VIA_RPC'
      using hint = 'Ative o contrato com fin_activate_contract.';
  end if;
  return new;
end $$;

create trigger fin_contracts_guard_activation before update of status on public.fin_contracts
  for each row execute function public.fin_contracts_guard_activation();

-- Corpo de 20261030000107, com a marca de ativação em volta do UPDATE.
create or replace function public.fin_activate_contract(p_contract uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  c public.fin_contracts;
  missing text[] := '{}';
  v_lines int;
  v_uncategorized int;
begin
  select * into c from public.fin_contracts where id = p_contract;
  if not found or not public.can_finance(c.company_id, 'manage') then
    raise exception 'OXYN_FORBIDDEN' using errcode = '42501';
  end if;
  if c.status <> 'draft' then
    raise exception 'OXYN_CONTRACT_NOT_DRAFT';
  end if;

  select count(*), count(*) filter (where service_category_id is null) into v_lines, v_uncategorized
    from public.fin_contract_lines where contract_id = c.id;

  if c.organization_id is null then missing := missing || 'Cliente'::text; end if;
  if c.due_day is null then missing := missing || 'Dia de vencimento'::text; end if;
  if c.account_id is null then missing := missing || 'Conta'::text; end if;
  if c.end_rule is null then missing := missing || 'Regra de fim de vigência'::text; end if;
  if v_lines = 0 then missing := missing || 'Linhas'::text; end if;
  if v_uncategorized > 0 then missing := missing || 'Categoria de serviço'::text; end if;
  if cardinality(missing) > 0 then
    raise exception 'Faltam dados para ativar o contrato' using detail = array_to_string(missing, ', ');
  end if;

  perform set_config('oxyn.activating_contract', c.id::text, true);
  update public.fin_contracts set status = 'active' where id = c.id;
  perform set_config('oxyn.activating_contract', '', true);
end $$;
revoke execute on function public.fin_activate_contract(uuid) from public, anon;
grant execute on function public.fin_activate_contract(uuid) to authenticated;
