-- Financeiro: contas, saldo informado e categorias de despesa/receita.

create table public.fin_accounts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies on delete cascade,
  name text not null check (length(btrim(name)) > 0),
  bank text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles default auth.uid(),
  updated_at timestamptz not null default now()
);
create unique index fin_accounts_name_key on public.fin_accounts (company_id, lower(name));

create table public.fin_balance_snapshots (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies on delete cascade,
  account_id uuid not null references public.fin_accounts on delete cascade,
  as_of date not null,
  balance numeric(14,2) not null,
  note text,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles default auth.uid(),
  updated_at timestamptz not null default now(),
  unique (account_id, as_of)
);
create index fin_balance_snapshots_company_idx on public.fin_balance_snapshots (company_id, as_of desc);

create table public.fin_expense_categories (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies on delete cascade,
  name text not null check (length(btrim(name)) > 0),
  default_nature text not null check (default_nature in ('fixed','variable','non_recurring')),
  position int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles default auth.uid(),
  updated_at timestamptz not null default now()
);
create unique index fin_expense_categories_name_key on public.fin_expense_categories (company_id, lower(name));

create table public.fin_income_categories (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies on delete cascade,
  name text not null check (length(btrim(name)) > 0),
  position int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles default auth.uid(),
  updated_at timestamptz not null default now()
);
create unique index fin_income_categories_name_key on public.fin_income_categories (company_id, lower(name));

do $$
declare t text;
begin
  foreach t in array array['fin_accounts','fin_balance_snapshots','fin_expense_categories','fin_income_categories'] loop
    execute format('create trigger set_updated_at before update on public.%I for each row execute function public.set_updated_at()', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.can_finance(company_id, ''view''))', t || '_select', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.can_finance(company_id, ''manage''))', t || '_insert', t);
    execute format('create policy %I on public.%I for update to authenticated using (public.can_finance(company_id, ''manage'')) with check (public.can_finance(company_id, ''manage''))', t || '_update', t);
    execute format('create policy %I on public.%I for delete to authenticated using (public.can_finance(company_id, ''manage''))', t || '_delete', t);
  end loop;
end $$;

-- guard_same_company: função completa, com todos os ramos anteriores intactos e o novo de fin_balance_snapshots
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

create trigger guard_same_company before insert or update on public.fin_balance_snapshots
  for each row execute function public.guard_same_company();

-- Semeador real (substitui o stub da Task 3). Idempotente por nome.
create or replace function public.fin_seed_categories(p_company uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.fin_expense_categories (company_id, name, default_nature, position)
  select p_company, n, nat, ord - 1
  from (values
    (1, 'Aquisição de clientes', 'variable'),
    (2, 'Pró-labore', 'fixed'),
    (3, 'Pessoas', 'fixed'),
    (4, 'Comissão', 'variable'),
    (5, 'Escritório/administração geral', 'fixed'),
    (6, 'Custo de mercadorias/custo de serviços', 'variable'),
    (7, 'Viagens', 'variable'),
    (8, 'Despesas jurídicas', 'variable'),
    (9, 'Seguros', 'fixed'),
    (10, 'Tecnologia', 'fixed'),
    (11, 'Repasses', 'variable'),
    (12, 'Impostos/taxas bancárias', 'variable')
  ) as t(ord, n, nat)
  on conflict (company_id, lower(name)) do nothing;

  insert into public.fin_income_categories (company_id, name, position)
  select p_company, n, ord - 1
  from unnest(array['Vendas', 'Comissão', 'Repasses', 'Investimentos/rendimentos'])
       with ordinality as t(n, ord)
  on conflict (company_id, lower(name)) do nothing;

  perform public.seed_service_categories(p_company);
end $$;
revoke execute on function public.fin_seed_categories(uuid) from public, anon, authenticated;
