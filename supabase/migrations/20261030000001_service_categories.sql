-- Categorias de serviço: classificam produtos, negócios e itens de negócio (base do Financeiro).

create table public.service_categories (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies on delete cascade,
  name text not null check (length(btrim(name)) > 0),
  color text not null default '#64748b',
  position int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles default auth.uid(),
  updated_at timestamptz not null default now()
);
create unique index service_categories_name_key on public.service_categories (company_id, lower(name));
create index service_categories_company_idx on public.service_categories (company_id, position);

create trigger set_updated_at before update on public.service_categories
  for each row execute function public.set_updated_at();

-- RLS: leitura para membros e admin geral; escrita só do admin geral
alter table public.service_categories enable row level security;
revoke all on public.service_categories from anon;
grant select, insert, update, delete on public.service_categories to authenticated;

create policy service_categories_select on public.service_categories for select to authenticated
  using (public.has_company_access(company_id));
create policy service_categories_insert on public.service_categories for insert to authenticated
  with check (public.is_super_admin());
create policy service_categories_update on public.service_categories for update to authenticated
  using (public.is_super_admin()) with check (public.is_super_admin());
create policy service_categories_delete on public.service_categories for delete to authenticated
  using (public.is_super_admin());

-- Colunas novas (restrict: categoria em uso não pode ser excluída)
alter table public.products add column service_category_id uuid references public.service_categories on delete restrict;
alter table public.deals add column service_category_id uuid references public.service_categories on delete restrict;
alter table public.deal_items add column service_category_id uuid references public.service_categories on delete restrict;
create index products_service_category_idx on public.products (service_category_id) where service_category_id is not null;
create index deals_service_category_idx on public.deals (service_category_id) where service_category_id is not null;
create index deal_items_service_category_idx on public.deal_items (service_category_id) where service_category_id is not null;

-- Item novo herda a categoria do produto quando não informada
create function public.deal_item_default_category() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.service_category_id is null then
    select p.service_category_id into new.service_category_id
    from public.products p where p.id = new.product_id and p.company_id = new.company_id;
  end if;
  return new;
end $$;
create trigger deal_items_default_category before insert on public.deal_items
  for each row execute function public.deal_item_default_category();
revoke execute on function public.deal_item_default_category() from public, anon, authenticated;

-- Referências precisam ser da mesma empresa (função completa, com todos os ramos anteriores intactos e os novos de service_category_id)
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

create trigger guard_same_company before insert or update on public.products
  for each row execute function public.guard_same_company();

-- Seed das categorias padrão (só se a empresa ainda não tem nenhuma)
create function public.seed_service_categories(p_company uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.is_super_admin() then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;
  if exists (select 1 from public.service_categories where company_id = p_company) then
    return;
  end if;
  insert into public.service_categories (company_id, name, position)
  select p_company, n, ord - 1
  from unnest(array['Consultoria Vendas', 'Terceirização Vendas', 'Comissionamento',
                    'Consultoria Pessoas', 'Terceirização Pessoas', 'Serviço SEO/GEO'])
       with ordinality as t(n, ord);
end $$;
revoke execute on function public.seed_service_categories(uuid) from public, anon;
grant execute on function public.seed_service_categories(uuid) to authenticated;
