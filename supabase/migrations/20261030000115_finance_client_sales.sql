-- Financeiro: vendas do cliente registradas por vendedores geram comissão da Oxyn no mês seguinte
-- ao recebimento do cliente. O vendedor (register_sales) não lê nada do Financeiro: usa só as funções.

-- Vendedores de um contrato. Contrato sem vendedores aparece para todos com register_sales.
create table public.fin_contract_sellers (
  contract_id uuid not null references public.fin_contracts on delete cascade,
  user_id uuid not null references public.profiles on delete cascade,
  company_id uuid not null references public.companies on delete cascade,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles default auth.uid(),
  updated_at timestamptz not null default now(),
  primary key (contract_id, user_id)
);
create index fin_contract_sellers_user_idx on public.fin_contract_sellers (user_id);

create table public.fin_client_sales (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies on delete cascade,
  contract_id uuid not null references public.fin_contracts on delete cascade,
  contract_line_id uuid not null references public.fin_contract_lines on delete cascade,
  buyer text not null check (length(btrim(buyer)) > 0),
  sold_on date not null,
  setup_value numeric(14,2) not null default 0 check (setup_value >= 0),
  setup_installments int not null default 1 check (setup_installments between 1 and 60),
  setup_first_month date check (setup_first_month = date_trunc('month', setup_first_month)::date),
  recurring_value numeric(14,2) not null default 0 check (recurring_value >= 0),
  recurring_start date check (recurring_start = date_trunc('month', recurring_start)::date),
  recurring_months int check (recurring_months between 1 and 120),
  note text,
  status text not null default 'active' check (status in ('active','cancelled')),
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles default auth.uid(),
  updated_at timestamptz not null default now(),
  constraint fin_client_sales_setup_chk check (setup_value = 0 or setup_first_month is not null),
  constraint fin_client_sales_recurring_chk check (
    recurring_value = 0 or (recurring_start is not null and recurring_months is not null)),
  constraint fin_client_sales_total_chk check (setup_value + recurring_value > 0)
);
create index fin_client_sales_contract_idx on public.fin_client_sales (contract_id);
create index fin_client_sales_line_idx on public.fin_client_sales (contract_line_id);
create index fin_client_sales_creator_idx on public.fin_client_sales (company_id, created_by);

alter table public.fin_entries
  add column client_sale_id uuid references public.fin_client_sales on delete cascade,
  add column kind_tag text check (kind_tag in ('setup','recurring'));
create unique index fin_entries_sale_competence_key on public.fin_entries (client_sale_id, competence, kind_tag)
  where client_sale_id is not null;

-- fin_contract_sellers: leitura com view, escrita com manage.
do $$
declare t text := 'fin_contract_sellers';
begin
  execute format('create trigger set_updated_at before update on public.%I for each row execute function public.set_updated_at()', t);
  execute format('alter table public.%I enable row level security', t);
  execute format('revoke all on public.%I from anon', t);
  execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  execute format('create policy %I on public.%I for select to authenticated using (public.can_finance(company_id, ''view''))', t || '_select', t);
  execute format('create policy %I on public.%I for insert to authenticated with check (public.can_finance(company_id, ''manage''))', t || '_insert', t);
  execute format('create policy %I on public.%I for update to authenticated using (public.can_finance(company_id, ''manage'')) with check (public.can_finance(company_id, ''manage''))', t || '_update', t);
  execute format('create policy %I on public.%I for delete to authenticated using (public.can_finance(company_id, ''manage''))', t || '_delete', t);
  execute format('create trigger guard_same_company before insert or update on public.%I for each row execute function public.guard_same_company()', t);
end $$;

-- fin_client_sales: só leitura com view. Nenhuma política de escrita: vendedor e gestor gravam pelas funções.
create trigger set_updated_at before update on public.fin_client_sales
  for each row execute function public.set_updated_at();
alter table public.fin_client_sales enable row level security;
revoke all on public.fin_client_sales from anon;
revoke all on public.fin_client_sales from authenticated;
grant select on public.fin_client_sales to authenticated;
create policy fin_client_sales_select on public.fin_client_sales for select to authenticated
  using (public.can_finance(company_id, 'view'));
create trigger guard_same_company before insert or update on public.fin_client_sales
  for each row execute function public.guard_same_company();

-- guard_same_company: função completa (de 20261030000106), com todos os ramos anteriores intactos
-- e os novos de vendedores, vendas e fin_entries.client_sale_id.
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
    if (select company_id from public.fin_expense_categories where id = new.expense_category_id) is distinct from new.company_id then
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

-- Trava (corpo de 20261030000109) estendida às entries de venda.
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
  end if;
  return new;
end $$;

-- Regera a comissão de uma venda. Só toca source_kind = 'sale'; preserva liquidadas, canceladas e locked
-- (o índice venda+competência+tipo impede duplicar a competência delas). Recebimento do cliente no mês M
-- gera a comissão com competência M + 1, só se M estiver na vigência da linha de comissão.
create or replace function public.fin_regenerate_sale(p_sale uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  s public.fin_client_sales;
  c public.fin_contracts;
  l public.fin_contract_lines;
  v_renews boolean;
  v_end date;
  v_month date;
  v_comp date;
  v_part numeric(14,2);
  v_acc numeric(14,2) := 0;
  v_gross numeric(14,2);
  i int;
begin
  delete from public.fin_entries
   where client_sale_id = p_sale and source_kind = 'sale' and status = 'open' and not locked;

  select * into s from public.fin_client_sales where id = p_sale;
  if not found or s.status <> 'active' then
    return;
  end if;
  select * into c from public.fin_contracts where id = s.contract_id;
  if not found or c.status not in ('active', 'ended') then
    return;
  end if;
  select * into l from public.fin_contract_lines
   where id = s.contract_line_id and contract_id = c.id and kind = 'commission';
  if not found then
    return;
  end if;

  -- vigência: o primeiro ciclo; renovações automáticas contam, as de 'confirm' (não confirmadas) não
  v_renews := coalesce(c.end_rule, 'ends') in ('auto_renew', 'renew_adjust');
  v_end := (l.first_month + make_interval(months => l.months))::date;

  if s.setup_value > 0 and l.setup_rate is not null then
    for i in 0 .. s.setup_installments - 1 loop
      if i < s.setup_installments - 1 then
        v_part := trunc(s.setup_value / s.setup_installments, 2);
      else
        v_part := s.setup_value - v_acc;
      end if;
      v_acc := v_acc + v_part;
      v_month := (s.setup_first_month + make_interval(months => i))::date;
      continue when v_month < l.first_month or (v_month >= v_end and not v_renews);
      v_gross := round(v_part * l.setup_rate / 100, 2);
      continue when v_gross <= 0;
      v_comp := (v_month + interval '1 month')::date;
      insert into public.fin_entries (company_id, direction, source_kind, contract_id, client_sale_id, kind_tag,
        due_date, competence, gross, retention, account_id, organization_id, service_category_id, description)
      values (s.company_id, 'in', 'sale', c.id, s.id, 'setup',
        public.fin_due_date(v_comp, c.due_day), v_comp, v_gross, round(v_gross * c.retention_rate / 100, 2),
        c.account_id, c.organization_id, l.service_category_id, 'Comissão – ' || s.buyer)
      on conflict (client_sale_id, competence, kind_tag) where client_sale_id is not null do nothing;
    end loop;
  end if;

  if s.recurring_value > 0 and l.recurring_rate is not null then
    v_gross := round(s.recurring_value * l.recurring_rate / 100, 2);
    if v_gross > 0 then
      for i in 0 .. s.recurring_months - 1 loop
        v_month := (s.recurring_start + make_interval(months => i))::date;
        continue when v_month < l.first_month or (v_month >= v_end and not v_renews);
        v_comp := (v_month + interval '1 month')::date;
        insert into public.fin_entries (company_id, direction, source_kind, contract_id, client_sale_id, kind_tag,
          due_date, competence, gross, retention, account_id, organization_id, service_category_id, description)
        values (s.company_id, 'in', 'sale', c.id, s.id, 'recurring',
          public.fin_due_date(v_comp, c.due_day), v_comp, v_gross, round(v_gross * c.retention_rate / 100, 2),
          c.account_id, c.organization_id, l.service_category_id, 'Comissão – ' || s.buyer)
        on conflict (client_sale_id, competence, kind_tag) where client_sale_id is not null do nothing;
      end loop;
    end if;
  end if;
end $$;
revoke execute on function public.fin_regenerate_sale(uuid) from public, anon, authenticated;

-- Venda criada/alterada: regera. Venda apagada: as abertas não travadas somem e as liquidadas/locked
-- ficam (desvinculadas da venda), em vez de cair no ON DELETE CASCADE.
create or replace function public.fin_client_sales_regenerate() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'DELETE' then
    delete from public.fin_entries
     where client_sale_id = old.id and source_kind = 'sale' and status = 'open' and not locked;
    update public.fin_entries set client_sale_id = null where client_sale_id = old.id;
    return old;
  end if;
  perform public.fin_regenerate_sale(new.id);
  return null;
end $$;
revoke execute on function public.fin_client_sales_regenerate() from public, anon, authenticated;

create trigger fin_client_sales_regenerate after insert or update on public.fin_client_sales
  for each row execute function public.fin_client_sales_regenerate();
create trigger fin_client_sales_cleanup before delete on public.fin_client_sales
  for each row execute function public.fin_client_sales_regenerate();

-- Linha de comissão: mudar %, vigência, tipo ou categoria regera todas as vendas da linha.
create or replace function public.fin_contract_lines_regenerate_sales() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r record;
begin
  for r in select id from public.fin_client_sales where contract_line_id = new.id loop
    perform public.fin_regenerate_sale(r.id);
  end loop;
  return null;
end $$;
revoke execute on function public.fin_contract_lines_regenerate_sales() from public, anon, authenticated;

create trigger fin_contract_lines_regenerate_sales after update on public.fin_contract_lines
  for each row
  when ((old.kind, old.setup_rate, old.recurring_rate, old.first_month, old.months, old.service_category_id, old.contract_id)
        is distinct from
        (new.kind, new.setup_rate, new.recurring_rate, new.first_month, new.months, new.service_category_id, new.contract_id))
  execute function public.fin_contract_lines_regenerate_sales();

-- Contrato: status, vencimento, retenção, regra de fim, conta ou cliente mudam as vendas também.
create or replace function public.fin_contracts_regenerate_sales() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r record;
begin
  for r in select id from public.fin_client_sales where contract_id = new.id loop
    perform public.fin_regenerate_sale(r.id);
  end loop;
  return null;
end $$;
revoke execute on function public.fin_contracts_regenerate_sales() from public, anon, authenticated;

create trigger fin_contracts_regenerate_sales after update on public.fin_contracts
  for each row
  when ((old.status, old.due_day, old.retention_rate, old.end_rule, old.renewal_months, old.account_id, old.organization_id)
        is distinct from
        (new.status, new.due_day, new.retention_rate, new.end_rule, new.renewal_months, new.account_id, new.organization_id))
  execute function public.fin_contracts_regenerate_sales();

-- ===== Funções do vendedor (exigem can_finance(empresa, 'sell'), senão 42501) =====

-- Contratos ativos com linha de comissão que o usuário pode usar. Sem valores nem %.
-- Com vendedores definidos, só eles veem o contrato (quem tem manage vê todos).
create or replace function public.fin_sales_contracts(p_company uuid)
returns table(contract_id uuid, line_id uuid, contract_title text, client_name text)
language plpgsql stable security definer set search_path = public, pg_temp as $$
#variable_conflict use_column
declare
  v_manage boolean;
begin
  if p_company is null or not public.can_finance(p_company, 'sell') then
    raise exception 'OXYN_FORBIDDEN' using errcode = '42501';
  end if;
  v_manage := public.can_finance(p_company, 'manage');
  return query
    select c.id, l.id, c.title, o.name
      from public.fin_contracts c
      join public.fin_contract_lines l on l.contract_id = c.id and l.kind = 'commission'
      left join public.organizations o on o.id = c.organization_id
     where c.company_id = p_company and c.status = 'active'
       and (v_manage
            or not exists (select 1 from public.fin_contract_sellers cs where cs.contract_id = c.id)
            or exists (select 1 from public.fin_contract_sellers cs where cs.contract_id = c.id and cs.user_id = auth.uid()))
     order by c.title, c.id, l.created_at, l.id;
end $$;
revoke execute on function public.fin_sales_contracts(uuid) from public, anon;
grant execute on function public.fin_sales_contracts(uuid) to authenticated;

-- Vendas do próprio usuário. editable: nenhuma comissão liquidada.
create or replace function public.fin_my_sales(p_company uuid)
returns table(id uuid, contract_title text, buyer text, sold_on date, setup_value numeric, recurring_value numeric,
              recurring_months int, status text, editable boolean)
language plpgsql stable security definer set search_path = public, pg_temp as $$
#variable_conflict use_column
begin
  if p_company is null or not public.can_finance(p_company, 'sell') then
    raise exception 'OXYN_FORBIDDEN' using errcode = '42501';
  end if;
  return query
    select s.id, c.title, s.buyer, s.sold_on, s.setup_value, s.recurring_value, s.recurring_months, s.status,
           not exists (select 1 from public.fin_entries e where e.client_sale_id = s.id and e.status = 'settled')
      from public.fin_client_sales s
      join public.fin_contracts c on c.id = s.contract_id
     where s.company_id = p_company and s.created_by = auth.uid()
     order by s.sold_on desc, s.created_at desc, s.id;
end $$;
revoke execute on function public.fin_my_sales(uuid) from public, anon;
grant execute on function public.fin_my_sales(uuid) to authenticated;

-- Confere se o usuário pode alterar/cancelar a venda: dono (ou manage) e, sem manage, sem comissão liquidada.
create or replace function public.fin_assert_sale_editable(p_sale public.fin_client_sales) returns void
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.can_finance(p_sale.company_id, 'sell') then
    raise exception 'OXYN_FORBIDDEN' using errcode = '42501';
  end if;
  if public.can_finance(p_sale.company_id, 'manage') then
    return;
  end if;
  if p_sale.created_by is distinct from auth.uid() then
    raise exception 'OXYN_FORBIDDEN' using errcode = '42501';
  end if;
  if exists (select 1 from public.fin_entries where client_sale_id = p_sale.id and status = 'settled') then
    raise exception 'Esta venda já tem comissão recebida e não pode ser alterada.';
  end if;
end $$;
revoke execute on function public.fin_assert_sale_editable(public.fin_client_sales) from public, anon, authenticated;

-- Cria (p_id nulo) ou edita uma venda. Payload: contract_id, line_id, buyer, sold_on, setup_value,
-- setup_installments, setup_first_month, recurring_value, recurring_start, recurring_months, note.
create or replace function public.fin_save_sale(p_id uuid, p_payload jsonb) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  s public.fin_client_sales;
  v_contract uuid := (p_payload->>'contract_id')::uuid;
  v_line uuid := (p_payload->>'line_id')::uuid;
  v_company uuid;
  v_id uuid;
begin
  if p_id is not null then
    select * into s from public.fin_client_sales where id = p_id for update;
    if not found then
      raise exception 'OXYN_FORBIDDEN' using errcode = '42501';
    end if;
    perform public.fin_assert_sale_editable(s);
  end if;

  select company_id into v_company from public.fin_contracts where id = v_contract;
  if v_company is null or not public.can_finance(v_company, 'sell')
     or (p_id is not null and v_company is distinct from s.company_id)
     or not exists (select 1 from public.fin_sales_contracts(v_company) x
                     where x.contract_id = v_contract and x.line_id = v_line) then
    raise exception 'OXYN_FORBIDDEN' using errcode = '42501';
  end if;

  if p_id is null then
    insert into public.fin_client_sales (company_id, contract_id, contract_line_id, buyer, sold_on,
      setup_value, setup_installments, setup_first_month, recurring_value, recurring_start, recurring_months, note)
    values (v_company, v_contract, v_line, btrim(p_payload->>'buyer'), (p_payload->>'sold_on')::date,
      coalesce((p_payload->>'setup_value')::numeric, 0),
      coalesce((p_payload->>'setup_installments')::int, 1),
      date_trunc('month', (p_payload->>'setup_first_month')::date)::date,
      coalesce((p_payload->>'recurring_value')::numeric, 0),
      date_trunc('month', (p_payload->>'recurring_start')::date)::date,
      (p_payload->>'recurring_months')::int,
      nullif(btrim(p_payload->>'note'), ''))
    returning id into v_id;
  else
    update public.fin_client_sales set
      contract_id = v_contract,
      contract_line_id = v_line,
      buyer = btrim(p_payload->>'buyer'),
      sold_on = (p_payload->>'sold_on')::date,
      setup_value = coalesce((p_payload->>'setup_value')::numeric, 0),
      setup_installments = coalesce((p_payload->>'setup_installments')::int, 1),
      setup_first_month = date_trunc('month', (p_payload->>'setup_first_month')::date)::date,
      recurring_value = coalesce((p_payload->>'recurring_value')::numeric, 0),
      recurring_start = date_trunc('month', (p_payload->>'recurring_start')::date)::date,
      recurring_months = (p_payload->>'recurring_months')::int,
      note = nullif(btrim(p_payload->>'note'), '')
     where id = p_id
    returning id into v_id;
  end if;
  return v_id;
end $$;
revoke execute on function public.fin_save_sale(uuid, jsonb) from public, anon;
grant execute on function public.fin_save_sale(uuid, jsonb) to authenticated;

-- Cancela uma venda: as comissões abertas não travadas somem; as liquidadas ficam.
create or replace function public.fin_cancel_sale(p_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  s public.fin_client_sales;
begin
  select * into s from public.fin_client_sales where id = p_id for update;
  if not found then
    raise exception 'OXYN_FORBIDDEN' using errcode = '42501';
  end if;
  perform public.fin_assert_sale_editable(s);
  update public.fin_client_sales set status = 'cancelled' where id = p_id and status <> 'cancelled';
end $$;
revoke execute on function public.fin_cancel_sale(uuid) from public, anon;
grant execute on function public.fin_cancel_sale(uuid) to authenticated;
