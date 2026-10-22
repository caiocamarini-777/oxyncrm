-- Schema de funis, negócios, produtos e receita. RLS ligado sem policies (deny-all); policies na Task 2.

create function public.valid_required_fields(p text[]) returns boolean
language sql immutable set search_path = public as $$
  select p is not null and not exists (
    select 1 from unnest(p) e
    where e is null or e !~ '^(expected_close_date|person_id|organization_id|estimated_value|contract|products|cf:[a-z][a-z0-9_]{0,39})$');
$$;

create table public.pipelines (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  position int not null default 0,
  next_activity_rule text not null default 'off' check (next_activity_rule in ('off','suggest','require')),
  card_value_field text not null default 'total' check (card_value_field in ('total','mrr','setup')),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, name)
);

create table public.stages (
  id uuid primary key default gen_random_uuid(),
  pipeline_id uuid not null references public.pipelines on delete cascade,
  company_id uuid not null references public.companies on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  position int not null,
  probability int not null default 0 check (probability between 0 and 100),
  rotting_days int check (rotting_days is null or rotting_days >= 1),
  required_fields text[] not null default '{}' check (public.valid_required_fields(required_fields)),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (pipeline_id, name)
);

create table public.lost_reasons (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  position int not null default 0,
  active boolean not null default true,
  unique (company_id, name)
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  kind text not null check (kind in ('setup','recurring')),
  default_price numeric(14,2) not null default 0 check (default_price >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, name)
);

create table public.deals (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies on delete cascade,
  owner_id uuid not null references public.profiles,
  created_by uuid references public.profiles default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  custom_fields jsonb not null default '{}' check (jsonb_typeof(custom_fields) = 'object'),
  title text not null check (char_length(title) between 1 and 200),
  pipeline_id uuid not null references public.pipelines on delete restrict,
  stage_id uuid not null references public.stages on delete restrict,
  status text not null default 'open' check (status in ('open','won','lost')),
  lost_reason_id uuid references public.lost_reasons on delete restrict,
  lost_note text check (lost_note is null or char_length(lost_note) <= 1000),
  person_id uuid references public.persons on delete set null,
  organization_id uuid references public.organizations on delete set null,
  lead_id uuid references public.leads on delete set null,
  estimated_value numeric(14,2) check (estimated_value >= 0),
  expected_close_date date,
  stage_entered_at timestamptz not null default now(),
  won_at timestamptz,
  lost_at timestamptz,
  position numeric not null default 0,
  setup_total numeric(14,2) not null default 0 check (setup_total >= 0),
  setup_installments int not null default 1 check (setup_installments between 1 and 60),
  setup_first_due date,
  mrr numeric(14,2) not null default 0 check (mrr >= 0),
  mrr_start date,
  contract_months int check (contract_months between 1 and 120),
  contract_value numeric(16,2) generated always as (setup_total + mrr * coalesce(contract_months, 0)) stored,
  check (mrr = 0 or (mrr_start is not null and contract_months is not null)),
  check (setup_total = 0 or setup_first_due is not null),
  check (setup_first_due is null or extract(day from setup_first_due) = 1),
  check (mrr_start is null or extract(day from mrr_start) = 1),
  check (status <> 'lost' or lost_reason_id is not null)
);

create table public.deal_items (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.deals on delete cascade,
  company_id uuid not null references public.companies on delete cascade,
  product_id uuid not null references public.products on delete restrict,
  kind text not null check (kind in ('setup','recurring')),
  quantity numeric(10,2) not null check (quantity > 0),
  unit_price numeric(14,2) not null check (unit_price >= 0),
  discount numeric(14,2) not null default 0 check (discount >= 0),
  total numeric(16,2) generated always as (quantity * unit_price - discount) stored,
  position int not null default 0,
  created_at timestamptz not null default now(),
  check (quantity * unit_price - discount >= 0)
);

create table public.deal_stage_history (
  id bigint generated always as identity primary key,
  deal_id uuid not null references public.deals on delete cascade,
  company_id uuid not null references public.companies on delete cascade,
  from_stage_id uuid,
  to_stage_id uuid not null,
  moved_by uuid,
  moved_at timestamptz not null default now(),
  seconds_in_previous int
);

create table public.deal_revenue_schedule (
  deal_id uuid not null references public.deals on delete cascade,
  company_id uuid not null references public.companies on delete cascade,
  month date not null check (extract(day from month) = 1),
  setup numeric(14,2) not null default 0,
  mrr numeric(14,2) not null default 0,
  primary key (deal_id, month)
);

alter table public.leads
  add constraint leads_converted_deal_id_fkey foreign key (converted_deal_id) references public.deals on delete set null;

-- Checks polimórficos ampliados para aceitar deals
alter table public.record_labels drop constraint record_labels_entity_check;
alter table public.record_labels add constraint record_labels_entity_check
  check (entity in ('leads','persons','organizations','deals'));
alter table public.notes drop constraint notes_entity_check;
alter table public.notes add constraint notes_entity_check
  check (entity in ('leads','persons','organizations','deals'));
alter table public.timeline_events drop constraint timeline_events_kind_check;
alter table public.timeline_events add constraint timeline_events_kind_check
  check (kind in ('created','updated','owner_changed','status_changed','note_added',
    'label_added','label_removed','trashed','restored','stage_changed','converted'));

-- Índices
create index stages_pipeline_idx on public.stages (pipeline_id, position);
create index deals_board_idx on public.deals (company_id, pipeline_id, stage_id, position) where deleted_at is null;
create index deals_owner_idx on public.deals (company_id, owner_id);
create index deals_close_idx on public.deals (company_id, expected_close_date);
create index deals_title_trgm on public.deals using gin (lower(title) extensions.gin_trgm_ops);
create index deal_items_deal_idx on public.deal_items (deal_id);
create index deal_stage_history_deal_idx on public.deal_stage_history (deal_id, moved_at);
create index deal_revenue_schedule_month_idx on public.deal_revenue_schedule (company_id, month);

-- updated_at
create trigger set_updated_at before update on public.pipelines
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.stages
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.products
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.deals
  for each row execute function public.set_updated_at();

-- Referências precisam ser da mesma empresa (função completa, com os ramos da fase 2 intactos)
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

create trigger guard_same_company before insert or update on public.deals
  for each row execute function public.guard_same_company();
create trigger guard_same_company before insert or update on public.stages
  for each row execute function public.guard_same_company();
create trigger guard_same_company before insert or update on public.deal_items
  for each row execute function public.guard_same_company();

-- O tipo do item vem do produto no insert e não muda depois
create function public.deal_item_kind() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    select kind into new.kind from public.products where id = new.product_id;
  elsif new.kind is distinct from old.kind then
    raise exception 'OXYN_FORBIDDEN_FIELD';
  end if;
  return new;
end $$;

create trigger deal_item_kind before insert or update on public.deal_items
  for each row execute function public.deal_item_kind();

-- Seeds: funil padrão e motivos de perda (idempotente)
create function public.seed_company_pipeline(p_company uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_pipeline uuid;
begin
  insert into public.pipelines (company_id, name)
  values (p_company, 'Funil de vendas')
  on conflict (company_id, name) do nothing
  returning id into v_pipeline;
  if v_pipeline is not null then
    insert into public.stages (pipeline_id, company_id, name, position, probability)
    select v_pipeline, p_company, n, o - 1, p
    from unnest(array['Qualificação','Reunião','Proposta','Negociação','Fechamento'], array[10,25,50,75,90])
      with ordinality as t(n, p, o)
    on conflict (pipeline_id, name) do nothing;
  end if;
  insert into public.lost_reasons (company_id, name, position)
  select p_company, n, o - 1
  from unnest(array['Preço','Concorrente','Sem orçamento','Sem resposta','Timing','Outro']) with ordinality as t(n, o)
  on conflict (company_id, name) do nothing;
end $$;

create function public.seed_company_pipeline_trigger() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.seed_company_pipeline(new.id);
  return new;
end $$;

create trigger seed_company_pipeline after insert on public.companies
  for each row execute function public.seed_company_pipeline_trigger();

select public.seed_company_pipeline(id) from public.companies;

revoke execute on function public.valid_required_fields(text[]), public.deal_item_kind(),
  public.seed_company_pipeline(uuid), public.seed_company_pipeline_trigger(),
  public.guard_same_company() from public, anon, authenticated;

-- RLS ligado, sem policies (deny-all); anon nunca toca nestas tabelas.
alter table public.pipelines enable row level security;
alter table public.stages enable row level security;
alter table public.lost_reasons enable row level security;
alter table public.products enable row level security;
alter table public.deals enable row level security;
alter table public.deal_items enable row level security;
alter table public.deal_stage_history enable row level security;
alter table public.deal_revenue_schedule enable row level security;

revoke all on public.pipelines, public.stages, public.lost_reasons, public.products, public.deals,
  public.deal_items, public.deal_stage_history, public.deal_revenue_schedule from anon;
revoke truncate, references, trigger on public.pipelines, public.stages, public.lost_reasons,
  public.products, public.deals, public.deal_items, public.deal_stage_history,
  public.deal_revenue_schedule from authenticated;
