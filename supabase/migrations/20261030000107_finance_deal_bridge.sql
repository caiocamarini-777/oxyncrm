-- Financeiro: negócio ganho vira contrato rascunho; ativação do contrato.

-- Cria ou reconstrói o contrato rascunho de um negócio. Contrato já ativo (ou encerrado/cancelado)
-- nunca é tocado aqui. Linhas: uma por item com total > 0; o tipo sem itens usa o valor digitado
-- no negócio (como deal_items_recalc) com a categoria do negócio.
create or replace function public.fin_draft_from_deal(p_deal uuid) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  d public.deals;
  c public.fin_contracts;
  it record;
  v_has_setup boolean;
  v_has_mrr boolean;
begin
  select * into d from public.deals where id = p_deal;
  if not found then
    return null;
  end if;

  select * into c from public.fin_contracts where deal_id = p_deal;
  if found and c.status <> 'draft' then
    return c.id;
  end if;

  if c.id is null then
    insert into public.fin_contracts (company_id, organization_id, deal_id, title, status)
    values (d.company_id, d.organization_id, d.id, d.title, 'draft')
    returning * into c;
  else
    update public.fin_contracts set title = d.title, organization_id = d.organization_id
     where id = c.id and (title is distinct from d.title or organization_id is distinct from d.organization_id);
    delete from public.fin_contract_lines where contract_id = c.id;
  end if;

  select bool_or(kind = 'setup'), bool_or(kind = 'recurring') into v_has_setup, v_has_mrr
    from public.deal_items where deal_id = d.id;

  for it in
    select i.kind, i.total, coalesce(i.service_category_id, d.service_category_id) as category, p.name
      from public.deal_items i join public.products p on p.id = i.product_id
     where i.deal_id = d.id and i.total > 0
     order by i.position, i.created_at, i.id
  loop
    if it.kind = 'setup' and d.setup_first_due is not null then
      insert into public.fin_contract_lines (contract_id, company_id, kind, description, service_category_id,
        amount, first_month, installments)
      values (c.id, d.company_id, 'setup', it.name, it.category, it.total, d.setup_first_due, d.setup_installments);
    elsif it.kind = 'recurring' and d.mrr_start is not null and d.contract_months is not null then
      insert into public.fin_contract_lines (contract_id, company_id, kind, description, service_category_id,
        amount, first_month, months)
      values (c.id, d.company_id, 'recurring', it.name, it.category, it.total, d.mrr_start, d.contract_months);
    end if;
  end loop;

  if not coalesce(v_has_setup, false) and d.setup_total > 0 and d.setup_first_due is not null then
    insert into public.fin_contract_lines (contract_id, company_id, kind, description, service_category_id,
      amount, first_month, installments)
    values (c.id, d.company_id, 'setup', 'Setup', d.service_category_id, d.setup_total, d.setup_first_due, d.setup_installments);
  end if;
  if not coalesce(v_has_mrr, false) and d.mrr > 0 and d.mrr_start is not null and d.contract_months is not null then
    insert into public.fin_contract_lines (contract_id, company_id, kind, description, service_category_id,
      amount, first_month, months)
    values (c.id, d.company_id, 'recurring', 'Recorrente', d.service_category_id, d.mrr, d.mrr_start, d.contract_months);
  end if;

  return c.id;
end $$;
revoke execute on function public.fin_draft_from_deal(uuid) from public, anon, authenticated;

-- Aplica a regra da ponte para um negócio. p_was_won: o negócio estava ganho antes da mudança.
create or replace function public.fin_sync_deal(p_deal uuid, p_was_won boolean) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  d public.deals;
  c public.fin_contracts;
begin
  select * into d from public.deals where id = p_deal;
  if not found then
    return;
  end if;
  if not coalesce((select finance_enabled from public.companies where id = d.company_id), false) then
    return;
  end if;
  if d.status <> 'won' and not p_was_won then
    return;
  end if;

  select * into c from public.fin_contracts where deal_id = p_deal;
  if found and c.status <> 'draft' then
    -- contrato já ativado: nada é apagado nem reconstruído; só sinaliza a divergência
    if not c.source_changed then
      update public.fin_contracts set source_changed = true where id = c.id;
    end if;
  elsif d.status = 'won' then
    perform public.fin_draft_from_deal(p_deal);
  elsif found then
    delete from public.fin_contracts where id = c.id;
  end if;
end $$;
revoke execute on function public.fin_sync_deal(uuid, boolean) from public, anon, authenticated;

create or replace function public.fin_deals_bridge() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.fin_sync_deal(new.id, old.status = 'won');
  return null;
end $$;
revoke execute on function public.fin_deals_bridge() from public, anon, authenticated;

create trigger fin_deals_bridge after update of status, title, organization_id, service_category_id,
    setup_total, setup_installments, setup_first_due, mrr, mrr_start, contract_months on public.deals
  for each row
  when ((old.status, old.title, old.organization_id, old.service_category_id, old.setup_total, old.setup_installments,
         old.setup_first_due, old.mrr, old.mrr_start, old.contract_months)
        is distinct from
        (new.status, new.title, new.organization_id, new.service_category_id, new.setup_total, new.setup_installments,
         new.setup_first_due, new.mrr, new.mrr_start, new.contract_months))
  execute function public.fin_deals_bridge();

create or replace function public.fin_deal_items_bridge() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_deal uuid := case when tg_op = 'DELETE' then old.deal_id else new.deal_id end;
  v_won boolean;
begin
  select status = 'won' into v_won from public.deals where id = v_deal;
  if coalesce(v_won, false) then
    perform public.fin_sync_deal(v_deal, true);
  end if;
  if tg_op = 'UPDATE' and new.deal_id is distinct from old.deal_id then
    select status = 'won' into v_won from public.deals where id = old.deal_id;
    if coalesce(v_won, false) then
      perform public.fin_sync_deal(old.deal_id, true);
    end if;
  end if;
  return null;
end $$;
revoke execute on function public.fin_deal_items_bridge() from public, anon, authenticated;

create trigger fin_deal_items_bridge after insert or update or delete on public.deal_items
  for each row execute function public.fin_deal_items_bridge();

-- Regeneração do contrato (corpo de 20261030000106): ignora updates que só mudam source_changed,
-- para que a sinalização vinda do negócio não recrie as entries.
create or replace function public.fin_contracts_regenerate() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'DELETE' then
    delete from public.fin_entries
     where contract_id = old.id and source_kind = 'contract' and status = 'open' and not locked;
    return old;
  end if;
  if new.status = 'ended' then
    return null;
  end if;
  if (to_jsonb(new) - 'source_changed' - 'updated_at') = (to_jsonb(old) - 'source_changed' - 'updated_at') then
    return null;
  end if;
  perform public.fin_regenerate_contract(new.id);
  return null;
end $$;
revoke execute on function public.fin_contracts_regenerate() from public, anon, authenticated;

-- Ativação: valida os dados e muda o status (o trigger de fin_contracts regenera as entries).
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

  update public.fin_contracts set status = 'active' where id = c.id;
end $$;
revoke execute on function public.fin_activate_contract(uuid) from public, anon;
grant execute on function public.fin_activate_contract(uuid) to authenticated;
