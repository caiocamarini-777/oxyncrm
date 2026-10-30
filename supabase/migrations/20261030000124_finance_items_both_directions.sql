-- Financeiro: itens recorrentes nos dois sentidos (entrada e saída), fim obrigatório e valor original
-- dos lançamentos gerados que foram editados à mão.

-- ===== Itens recorrentes: sentido, categorias de receita/serviço e organização =====
alter table public.fin_recurring_expenses
  add column direction text not null default 'out' check (direction in ('in','out')),
  add column income_category_id uuid references public.fin_income_categories on delete restrict,
  add column service_category_id uuid references public.service_categories on delete restrict,
  add column organization_id uuid references public.organizations on delete set null,
  alter column expense_category_id drop not null,
  alter column nature drop not null;

-- Saída: categoria de despesa e natureza. Entrada: sem natureza, com categoria de receita ou de serviço.
alter table public.fin_recurring_expenses
  add constraint fin_recurring_expenses_out_chk check (
    direction <> 'out' or (expense_category_id is not null and nature is not null)),
  add constraint fin_recurring_expenses_in_chk check (
    direction <> 'in' or (nature is null and (income_category_id is not null or service_category_id is not null)));

-- Fim obrigatório em todo item novo ou alterado. NOT VALID: os itens legados sem fim continuam válidos
-- (e gerando até o horizonte), mas qualquer UPDATE deles precisa informar o fim.
alter table public.fin_recurring_expenses
  add constraint fin_recurring_expenses_end_month_required check (end_month is not null) not valid;

-- ===== Valor original dos lançamentos editados à mão =====
alter table public.fin_entries
  add column original_gross numeric(14,2),
  add column original_due_date date;

-- guard_same_company: função completa (de 20261030000115), com todos os ramos anteriores intactos
-- e os vínculos novos de fin_recurring_expenses (categoria de despesa agora opcional).
create or replace function public.guard_same_company() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  j jsonb := to_jsonb(new);
  rec_company uuid;
  label_company uuid;
begin
  if tg_table_name = 'persons' then
    if new.organization_id is not null and
       (select company_id from public.organizations where id = new.organization_id) is distinct from new.company_id then
      raise exception 'OXYN_CROSS_COMPANY';
    end if;
  elsif tg_table_name = 'leads' then
    if new.person_id is not null and
       (select company_id from public.persons where id = new.person_id) is distinct from new.company_id then
      raise exception 'OXYN_CROSS_COMPANY';
    end if;
    if new.organization_id is not null and
       (select company_id from public.organizations where id = new.organization_id) is distinct from new.company_id then
      raise exception 'OXYN_CROSS_COMPANY';
    end if;
    if new.source_id is not null and
       (select company_id from public.lead_sources where id = new.source_id) is distinct from new.company_id then
      raise exception 'OXYN_CROSS_COMPANY';
    end if;
    if new.disqualification_reason_id is not null and
       (select company_id from public.disqualification_reasons where id = new.disqualification_reason_id)
         is distinct from new.company_id then
      raise exception 'OXYN_CROSS_COMPANY';
    end if;
    if new.converted_deal_id is not null and
       (select company_id from public.deals where id = new.converted_deal_id) is distinct from new.company_id then
      raise exception 'OXYN_CROSS_COMPANY';
    end if;
  elsif tg_table_name = 'deals' then
    if (select company_id from public.pipelines where id = new.pipeline_id) is distinct from new.company_id then
      raise exception 'OXYN_CROSS_COMPANY';
    end if;
    if not exists (select 1 from public.stages
                   where id = new.stage_id and company_id = new.company_id and pipeline_id = new.pipeline_id) then
      raise exception 'OXYN_CROSS_COMPANY';
    end if;
    if new.lost_reason_id is not null and
       (select company_id from public.lost_reasons where id = new.lost_reason_id) is distinct from new.company_id then
      raise exception 'OXYN_CROSS_COMPANY';
    end if;
    if new.person_id is not null and
       (select company_id from public.persons where id = new.person_id) is distinct from new.company_id then
      raise exception 'OXYN_CROSS_COMPANY';
    end if;
    if new.organization_id is not null and
       (select company_id from public.organizations where id = new.organization_id) is distinct from new.company_id then
      raise exception 'OXYN_CROSS_COMPANY';
    end if;
    if new.lead_id is not null and
       (select company_id from public.leads where id = new.lead_id) is distinct from new.company_id then
      raise exception 'OXYN_CROSS_COMPANY';
    end if;
    if new.service_category_id is not null and
       (select company_id from public.service_categories where id = new.service_category_id)
         is distinct from new.company_id then
      raise exception 'OXYN_CROSS_COMPANY';
    end if;
  elsif tg_table_name = 'products' then
    if new.service_category_id is not null and
       (select company_id from public.service_categories where id = new.service_category_id)
         is distinct from new.company_id then
      raise exception 'OXYN_CROSS_COMPANY';
    end if;
  elsif tg_table_name = 'activities' then
    if (select company_id from public.activity_types where id = new.type_id) is distinct from new.company_id then
      raise exception 'OXYN_CROSS_COMPANY';
    end if;
    if (select company_id from public.activity_channels where id = new.channel_id) is distinct from new.company_id then
      raise exception 'OXYN_CROSS_COMPANY';
    end if;
    if new.origin_channel_id is not null and
       (select company_id from public.activity_channels where id = new.origin_channel_id) is distinct from new.company_id then
      raise exception 'OXYN_CROSS_COMPANY';
    end if;
    if new.outcome_id is not null and
       (select company_id from public.activity_outcomes where id = new.outcome_id) is distinct from new.company_id then
      raise exception 'OXYN_CROSS_COMPANY';
    end if;
    if new.lead_id is not null and
       (select company_id from public.leads where id = new.lead_id) is distinct from new.company_id then
      raise exception 'OXYN_CROSS_COMPANY';
    end if;
    if new.deal_id is not null and
       (select company_id from public.deals where id = new.deal_id) is distinct from new.company_id then
      raise exception 'OXYN_CROSS_COMPANY';
    end if;
    if new.person_id is not null and
       (select company_id from public.persons where id = new.person_id) is distinct from new.company_id then
      raise exception 'OXYN_CROSS_COMPANY';
    end if;
    if new.organization_id is not null and
       (select company_id from public.organizations where id = new.organization_id) is distinct from new.company_id then
      raise exception 'OXYN_CROSS_COMPANY';
    end if;
    if new.booked_by_activity_id is not null and
       (select company_id from public.activities where id = new.booked_by_activity_id) is distinct from new.company_id then
      raise exception 'OXYN_CROSS_COMPANY';
    end if;
  elsif tg_table_name = 'fin_balance_snapshots' then
    if (select company_id from public.fin_accounts where id = new.account_id) is distinct from new.company_id then
      raise exception 'OXYN_CROSS_COMPANY';
    end if;
  elsif tg_table_name = 'fin_contracts' then
    if new.organization_id is not null and
       (select company_id from public.organizations where id = new.organization_id) is distinct from new.company_id then
      raise exception 'OXYN_CROSS_COMPANY';
    end if;
    if new.deal_id is not null and
       (select company_id from public.deals where id = new.deal_id) is distinct from new.company_id then
      raise exception 'OXYN_CROSS_COMPANY';
    end if;
    if new.account_id is not null and
       (select company_id from public.fin_accounts where id = new.account_id) is distinct from new.company_id then
      raise exception 'OXYN_CROSS_COMPANY';
    end if;
  elsif tg_table_name = 'fin_contract_lines' then
    if (select company_id from public.fin_contracts where id = new.contract_id) is distinct from new.company_id then
      raise exception 'OXYN_CROSS_COMPANY';
    end if;
    if new.service_category_id is not null and
       (select company_id from public.service_categories where id = new.service_category_id)
         is distinct from new.company_id then
      raise exception 'OXYN_CROSS_COMPANY';
    end if;
  elsif tg_table_name = 'fin_recurring_expenses' then
    if new.expense_category_id is not null and
       (select company_id from public.fin_expense_categories where id = new.expense_category_id) is distinct from new.company_id then
      raise exception 'OXYN_CROSS_COMPANY';
    end if;
    if new.income_category_id is not null and
       (select company_id from public.fin_income_categories where id = new.income_category_id) is distinct from new.company_id then
      raise exception 'OXYN_CROSS_COMPANY';
    end if;
    if new.service_category_id is not null and
       (select company_id from public.service_categories where id = new.service_category_id) is distinct from new.company_id then
      raise exception 'OXYN_CROSS_COMPANY';
    end if;
    if new.organization_id is not null and
       (select company_id from public.organizations where id = new.organization_id) is distinct from new.company_id then
      raise exception 'OXYN_CROSS_COMPANY';
    end if;
    if new.account_id is not null and
       (select company_id from public.fin_accounts where id = new.account_id) is distinct from new.company_id then
      raise exception 'OXYN_CROSS_COMPANY';
    end if;
  elsif tg_table_name = 'fin_contract_sellers' then
    if (tg_op = 'INSERT' or new.company_id is distinct from old.company_id or new.contract_id is distinct from old.contract_id)
       and (select company_id from public.fin_contracts where id = new.contract_id) is distinct from new.company_id then
      raise exception 'OXYN_CROSS_COMPANY';
    end if;
    if (tg_op = 'INSERT' or new.company_id is distinct from old.company_id or new.user_id is distinct from old.user_id)
       and not exists (select 1 from public.memberships where user_id = new.user_id and company_id = new.company_id) then
      raise exception 'OXYN_CROSS_COMPANY';
    end if;
  elsif tg_table_name = 'fin_client_sales' then
    if (tg_op = 'INSERT' or new.company_id is distinct from old.company_id or new.contract_id is distinct from old.contract_id)
       and (select company_id from public.fin_contracts where id = new.contract_id) is distinct from new.company_id then
      raise exception 'OXYN_CROSS_COMPANY';
    end if;
    -- a linha precisa ser de comissão e do mesmo contrato
    if (tg_op = 'INSERT' or new.company_id is distinct from old.company_id or new.contract_id is distinct from old.contract_id
        or new.contract_line_id is distinct from old.contract_line_id)
       and not exists (select 1 from public.fin_contract_lines
                        where id = new.contract_line_id and contract_id = new.contract_id
                          and company_id = new.company_id and kind = 'commission') then
      raise exception 'OXYN_CROSS_COMPANY';
    end if;
  elsif tg_table_name = 'fin_entries' then
    -- Num UPDATE, só revalida o vínculo que mudou (ou todos, se mudou a empresa): o ON DELETE SET NULL
    -- em cascata ao apagar um contrato atualiza a entry quando a linha do contrato já não existe.
    if new.contract_id is not null
       and (tg_op = 'INSERT' or new.company_id is distinct from old.company_id or new.contract_id is distinct from old.contract_id)
       and (select company_id from public.fin_contracts where id = new.contract_id) is distinct from new.company_id then
      raise exception 'OXYN_CROSS_COMPANY';
    end if;
    if new.contract_line_id is not null
       and (tg_op = 'INSERT' or new.company_id is distinct from old.company_id or new.contract_line_id is distinct from old.contract_line_id)
       and (select company_id from public.fin_contract_lines where id = new.contract_line_id) is distinct from new.company_id then
      raise exception 'OXYN_CROSS_COMPANY';
    end if;
    if new.recurring_expense_id is not null
       and (tg_op = 'INSERT' or new.company_id is distinct from old.company_id or new.recurring_expense_id is distinct from old.recurring_expense_id)
       and (select company_id from public.fin_recurring_expenses where id = new.recurring_expense_id) is distinct from new.company_id then
      raise exception 'OXYN_CROSS_COMPANY';
    end if;
    if new.client_sale_id is not null
       and (tg_op = 'INSERT' or new.company_id is distinct from old.company_id or new.client_sale_id is distinct from old.client_sale_id)
       and (select company_id from public.fin_client_sales where id = new.client_sale_id) is distinct from new.company_id then
      raise exception 'OXYN_CROSS_COMPANY';
    end if;
    if new.account_id is not null
       and (tg_op = 'INSERT' or new.company_id is distinct from old.company_id or new.account_id is distinct from old.account_id)
       and (select company_id from public.fin_accounts where id = new.account_id) is distinct from new.company_id then
      raise exception 'OXYN_CROSS_COMPANY';
    end if;
    if new.organization_id is not null
       and (tg_op = 'INSERT' or new.company_id is distinct from old.company_id or new.organization_id is distinct from old.organization_id)
       and (select company_id from public.organizations where id = new.organization_id) is distinct from new.company_id then
      raise exception 'OXYN_CROSS_COMPANY';
    end if;
    if new.service_category_id is not null
       and (tg_op = 'INSERT' or new.company_id is distinct from old.company_id or new.service_category_id is distinct from old.service_category_id)
       and (select company_id from public.service_categories where id = new.service_category_id) is distinct from new.company_id then
      raise exception 'OXYN_CROSS_COMPANY';
    end if;
    if new.income_category_id is not null
       and (tg_op = 'INSERT' or new.company_id is distinct from old.company_id or new.income_category_id is distinct from old.income_category_id)
       and (select company_id from public.fin_income_categories where id = new.income_category_id) is distinct from new.company_id then
      raise exception 'OXYN_CROSS_COMPANY';
    end if;
    if new.expense_category_id is not null
       and (tg_op = 'INSERT' or new.company_id is distinct from old.company_id or new.expense_category_id is distinct from old.expense_category_id)
       and (select company_id from public.fin_expense_categories where id = new.expense_category_id) is distinct from new.company_id then
      raise exception 'OXYN_CROSS_COMPANY';
    end if;
  elsif tg_table_name = 'stages' then
    if (select company_id from public.pipelines where id = new.pipeline_id) is distinct from new.company_id then
      raise exception 'OXYN_CROSS_COMPANY';
    end if;
  elsif tg_table_name = 'deal_items' then
    if (select company_id from public.deals where id = new.deal_id) is distinct from new.company_id then
      raise exception 'OXYN_CROSS_COMPANY';
    end if;
    if (select company_id from public.products where id = new.product_id) is distinct from new.company_id then
      raise exception 'OXYN_CROSS_COMPANY';
    end if;
    if new.service_category_id is not null and
       (select company_id from public.service_categories where id = new.service_category_id)
         is distinct from new.company_id then
      raise exception 'OXYN_CROSS_COMPANY';
    end if;
  elsif tg_table_name in ('notes','record_labels') and
        coalesce(j->>'entity', '') not in ('leads','persons','organizations','deals') then
    return new; -- o CHECK de entity rejeita
  elsif tg_table_name = 'notes' then
    execute format('select company_id from public.%I where id = $1', j->>'entity')
      into rec_company using (j->>'record_id')::uuid;
    if rec_company is distinct from new.company_id then
      raise exception 'OXYN_CROSS_COMPANY';
    end if;
  elsif tg_table_name = 'record_labels' then
    select company_id into label_company from public.labels where id = new.label_id;
    execute format('select company_id from public.%I where id = $1', new.entity)
      into rec_company using new.record_id;
    if rec_company is null or label_company is distinct from rec_company then
      raise exception 'OXYN_CROSS_COMPANY';
    end if;
  end if;
  return new;
end $$;

-- Trava (corpo de 20261030000115) que também guarda o bruto e o vencimento de antes da primeira edição
-- manual. Os originais nunca são sobrescritos depois de preenchidos.
create or replace function public.fin_entries_lock_on_edit() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if new.source_kind in ('contract', 'recurring', 'sale') and not new.locked
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
    if not old.locked then
      new.original_gross := coalesce(old.original_gross, old.gross);
      new.original_due_date := coalesce(old.original_due_date, old.due_date);
    end if;
  end if;
  -- uma vez preenchidos, os originais ficam
  if old.original_gross is not null then
    new.original_gross := old.original_gross;
  end if;
  if old.original_due_date is not null then
    new.original_due_date := old.original_due_date;
  end if;
  return new;
end $$;

-- Regera as entries de um item recorrente (corpo de 20261030000118). Agora copia o sentido, a natureza,
-- as categorias e a organização do item.
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
    -- inativo: só o futuro some; as abertas vencidas ficam
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
      due_date, competence, gross, account_id, expense_category_id, income_category_id, service_category_id,
      organization_id, nature, description)
    values (e.company_id, e.direction, 'recurring', e.id,
      public.fin_due_date(v_comp, e.due_day), v_comp, v_gross, e.account_id, e.expense_category_id,
      e.income_category_id, e.service_category_id, e.organization_id, e.nature,
      case when e.installments is not null
           then e.description || ' (' || (i + 1) || '/' || e.installments || ')'
           else e.description end)
    on conflict (recurring_expense_id, competence) where recurring_expense_id is not null do nothing;
    i := i + 1;
  end loop;
end $$;
revoke execute on function public.fin_regenerate_recurring(uuid) from public, anon, authenticated;
