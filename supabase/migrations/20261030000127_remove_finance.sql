-- Remove o módulo Financeiro do CRM (ele vira um sistema separado).
-- Backup dos dados fin_* feito antes em JSON. Mantém as categorias de serviço
-- (service_categories, colunas em products/deals/deal_items, reordenação e seed).

-- 1. Job mensal do horizonte
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'fin-extend-horizon';
  end if;
end $$;

-- 2. Triggers do Financeiro em tabelas do CRM
drop trigger if exists fin_deals_bridge on public.deals;
drop trigger if exists fin_deal_items_bridge on public.deal_items;
drop trigger if exists companies_finance_enabled_seed on public.companies;

-- 3. Tabelas fin_* (levam junto políticas, índices e triggers delas)
drop table if exists
  public.fin_client_sales,
  public.fin_contract_sellers,
  public.fin_entries,
  public.fin_recurring_expenses,
  public.fin_contract_lines,
  public.fin_contracts,
  public.fin_balance_snapshots,
  public.fin_accounts,
  public.fin_expense_categories,
  public.fin_income_categories
  cascade;

-- 4. Funções do Financeiro (todas as fin_*, can_finance e o seed da ativação)
do $$
declare
  f regprocedure;
begin
  for f in
    select p.oid::regprocedure
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and (p.proname like 'fin\_%' or p.proname in ('can_finance', 'companies_finance_enabled_seed'))
  loop
    execute format('drop function %s cascade', f);
  end loop;
end $$;

-- 5. Ativação por empresa
alter table public.companies drop column if exists finance_enabled;

-- 6. guard_same_company sem os ramos fin_* (os demais ramos idênticos à versão anterior)
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


-- 7. Permissões: tira as 3 chaves de finanças dos papéis e volta a exigir exatamente as 6 chaves
update public.roles
set permissions = jsonb_set(permissions, '{settings}',
  (permissions->'settings') - 'view_finance' - 'manage_finance' - 'register_sales')
where (permissions->'settings') ?| array['view_finance', 'manage_finance', 'register_sales'];

create or replace function public.is_valid_permissions(p jsonb) returns boolean
language plpgsql immutable set search_path = public as $$
declare
  k text;
begin
  if p is null or jsonb_typeof(p) <> 'object' then return false; end if;
  if (select array_agg(x order by x) from jsonb_object_keys(p) x)
     is distinct from array['actions','settings','visibility'] then return false; end if;

  if jsonb_typeof(p->'visibility') <> 'object' or jsonb_typeof(p->'actions') <> 'object'
     or jsonb_typeof(p->'settings') <> 'object' then return false; end if;

  if (select array_agg(x order by x) from jsonb_object_keys(p->'visibility') x)
     is distinct from array['activities','deals','leads','organizations','persons'] then return false; end if;
  for k in select jsonb_object_keys(p->'visibility') loop
    if jsonb_typeof(p->'visibility'->k) <> 'string'
       or (p->'visibility'->>k) not in ('own','team','company') then return false; end if;
  end loop;

  if (select array_agg(x order by x) from jsonb_object_keys(p->'actions') x)
     is distinct from array['create','delete','edit','export','reassign_owner'] then return false; end if;
  for k in select jsonb_object_keys(p->'actions') loop
    if jsonb_typeof(p->'actions'->k) <> 'boolean' then return false; end if;
  end loop;

  if (select array_agg(x order by x) from jsonb_object_keys(p->'settings') x)
     is distinct from array['create_dashboards','manage_custom_fields','manage_pipelines','manage_products','share_dashboards','view_reports'] then return false; end if;
  for k in select jsonb_object_keys(p->'settings') loop
    if jsonb_typeof(p->'settings'->k) <> 'boolean' then return false; end if;
  end loop;

  return true;
end $$;
