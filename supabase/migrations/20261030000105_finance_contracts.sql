-- Financeiro: contratos, linhas e lançamentos gerados (fin_entries).

create table public.fin_contracts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies on delete cascade,
  organization_id uuid references public.organizations on delete set null,
  deal_id uuid unique references public.deals on delete set null,
  title text not null check (length(btrim(title)) > 0),
  status text not null default 'draft' check (status in ('draft','active','ended','cancelled')),
  due_day int check (due_day between 1 and 31),
  retention_rate numeric(5,2) not null default 0 check (retention_rate between 0 and 100),
  account_id uuid references public.fin_accounts on delete set null,
  end_rule text check (end_rule in ('ends','auto_renew','renew_adjust','confirm')),
  renewal_months int check (renewal_months between 1 and 120),
  adjust_kind text not null default 'none' check (adjust_kind in ('none','percent','index')),
  adjust_index text check (adjust_index in ('IPCA','IGP-M','INPC')),
  adjust_rate numeric(6,3) not null default 0,
  source_changed boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles default auth.uid(),
  updated_at timestamptz not null default now()
);
create index fin_contracts_company_idx on public.fin_contracts (company_id, status);

create table public.fin_contract_lines (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.fin_contracts on delete cascade,
  company_id uuid not null references public.companies on delete cascade,
  kind text not null check (kind in ('setup','recurring','commission')),
  description text not null check (length(btrim(description)) > 0),
  service_category_id uuid references public.service_categories on delete set null,
  setup_rate numeric(6,3),
  recurring_rate numeric(6,3),
  estimated_monthly numeric(14,2) check (estimated_monthly >= 0),
  amount numeric(14,2) check (amount > 0),
  first_month date not null check (first_month = date_trunc('month', first_month)::date),
  installments int not null default 1 check (installments between 1 and 60),
  months int check (months between 1 and 120),
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles default auth.uid(),
  updated_at timestamptz not null default now(),
  constraint fin_contract_lines_amount_chk check (
    case when kind = 'commission' then amount is null else amount is not null end),
  constraint fin_contract_lines_months_chk check (kind not in ('recurring','commission') or months is not null),
  constraint fin_contract_lines_commission_chk check (
    kind <> 'commission' or setup_rate is not null or recurring_rate is not null)
);
create index fin_contract_lines_contract_idx on public.fin_contract_lines (contract_id);

create table public.fin_entries (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies on delete cascade,
  direction text not null check (direction in ('in','out')),
  source_kind text not null check (source_kind in ('contract','recurring','sale','manual','import')),
  contract_id uuid references public.fin_contracts on delete set null,
  contract_line_id uuid references public.fin_contract_lines on delete set null,
  recurring_expense_id uuid, -- FK adicionada na Task 6
  source_key text,
  due_date date not null,
  competence date not null check (competence = date_trunc('month', competence)::date),
  gross numeric(14,2) not null check (gross >= 0),
  retention numeric(14,2) not null default 0 check (retention >= 0),
  amount numeric(14,2) generated always as (gross - retention) stored,
  status text not null default 'open' check (status in ('open','settled','cancelled')),
  settled_on date,
  settled_amount numeric(14,2),
  account_id uuid references public.fin_accounts on delete set null,
  organization_id uuid references public.organizations on delete set null,
  service_category_id uuid references public.service_categories on delete set null,
  income_category_id uuid references public.fin_income_categories on delete set null,
  expense_category_id uuid references public.fin_expense_categories on delete set null,
  nature text check (nature in ('fixed','variable','non_recurring')),
  description text,
  locked boolean not null default false,
  is_renewal boolean not null default false,
  renewal_pending boolean not null default false,
  estimated boolean not null default false,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles default auth.uid(),
  updated_at timestamptz not null default now(),
  constraint fin_entries_settled_chk check (status <> 'settled' or (settled_on is not null and settled_amount is not null)),
  constraint fin_entries_nature_chk check (direction <> 'out' or nature is not null)
);
create unique index fin_entries_line_competence_key on public.fin_entries (contract_line_id, competence)
  where contract_line_id is not null;
create unique index fin_entries_source_key on public.fin_entries (company_id, source_key)
  where source_key is not null;
create index fin_entries_company_due_idx on public.fin_entries (company_id, due_date);
create index fin_entries_contract_idx on public.fin_entries (contract_id) where contract_id is not null;

do $$
declare t text;
begin
  foreach t in array array['fin_contracts','fin_contract_lines','fin_entries'] loop
    execute format('create trigger set_updated_at before update on public.%I for each row execute function public.set_updated_at()', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.can_finance(company_id, ''view''))', t || '_select', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.can_finance(company_id, ''manage''))', t || '_insert', t);
    execute format('create policy %I on public.%I for update to authenticated using (public.can_finance(company_id, ''manage'')) with check (public.can_finance(company_id, ''manage''))', t || '_update', t);
    execute format('create policy %I on public.%I for delete to authenticated using (public.can_finance(company_id, ''manage''))', t || '_delete', t);
    execute format('create trigger guard_same_company before insert or update on public.%I for each row execute function public.guard_same_company()', t);
  end loop;
end $$;

-- guard_same_company: função completa, com todos os ramos anteriores intactos e os novos de contratos/entries
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

-- Vencimento: o dia pedido, limitado ao último dia do mês (31 em fevereiro vira 28/29).
create or replace function public.fin_due_date(p_month date, p_day int) returns date
language sql immutable set search_path = public, pg_temp as $$
  select make_date(
    extract(year from p_month)::int,
    extract(month from p_month)::int,
    least(coalesce(p_day, 1),
          extract(day from (date_trunc('month', p_month) + interval '1 month - 1 day'))::int));
$$;

-- Fim (exclusivo) do horizonte de geração: 36 meses a partir do mês corrente em São Paulo.
create or replace function public.fin_horizon_end() returns date
language sql stable set search_path = public, pg_temp as $$
  select (date_trunc('month', (now() at time zone 'America/Sao_Paulo')::date) + interval '36 months')::date;
$$;

-- Regera as entries de um contrato. Só toca source_kind = 'contract'; preserva liquidadas,
-- canceladas e locked, e não duplica a competência delas (índice único linha+competência).
create or replace function public.fin_regenerate_contract(p_contract uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  c public.fin_contracts;
  l public.fin_contract_lines;
  v_horizon date := public.fin_horizon_end();
  v_rule text;
  v_comp date;
  v_cycle int;
  v_len int;
  v_gross numeric(14,2);
  v_acc numeric(14,2);
  i int;
begin
  delete from public.fin_entries
   where contract_id = p_contract and source_kind = 'contract' and status = 'open' and not locked;

  select * into c from public.fin_contracts where id = p_contract;
  if not found or c.status <> 'active' then
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
          insert into public.fin_entries (company_id, direction, source_kind, contract_id, contract_line_id,
            due_date, competence, gross, retention, account_id, organization_id, service_category_id, description,
            is_renewal, renewal_pending, estimated)
          values (c.company_id, 'in', 'contract', c.id, l.id,
            public.fin_due_date(v_comp, c.due_day), v_comp, v_gross, round(v_gross * c.retention_rate / 100, 2),
            c.account_id, c.organization_id, l.service_category_id, c.title || ' – ' || l.description,
            v_cycle > 0, v_cycle > 0 and v_rule = 'confirm', l.kind = 'commission')
          on conflict (contract_line_id, competence) where contract_line_id is not null do nothing;
          v_comp := (v_comp + interval '1 month')::date;
        end loop;
        exit when v_rule = 'ends' or v_comp >= v_horizon;
        v_cycle := v_cycle + 1;
      end loop;
    end if;
  end loop;
end $$;
revoke execute on function public.fin_regenerate_contract(uuid) from public, anon, authenticated;

-- Triggers de regeneração (security definer: a função de regeneração não é executável por authenticated).
create or replace function public.fin_contract_lines_regenerate() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op in ('UPDATE','DELETE') then
    perform public.fin_regenerate_contract(old.contract_id);
  end if;
  if tg_op = 'INSERT' or (tg_op = 'UPDATE' and new.contract_id is distinct from old.contract_id) then
    perform public.fin_regenerate_contract(new.contract_id);
  end if;
  return null;
end $$;
revoke execute on function public.fin_contract_lines_regenerate() from public, anon, authenticated;

create trigger fin_contract_lines_regenerate after insert or update or delete on public.fin_contract_lines
  for each row execute function public.fin_contract_lines_regenerate();

create or replace function public.fin_contracts_regenerate() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'DELETE' then
    -- antes de apagar: remove as abertas não travadas (liquidadas/locked ficam, com contract_id nulo)
    delete from public.fin_entries
     where contract_id = old.id and source_kind = 'contract' and status = 'open' and not locked;
    return old;
  end if;
  perform public.fin_regenerate_contract(new.id);
  return null;
end $$;
revoke execute on function public.fin_contracts_regenerate() from public, anon, authenticated;

create trigger fin_contracts_regenerate after update on public.fin_contracts
  for each row execute function public.fin_contracts_regenerate();
create trigger fin_contracts_cleanup before delete on public.fin_contracts
  for each row execute function public.fin_contracts_regenerate();
