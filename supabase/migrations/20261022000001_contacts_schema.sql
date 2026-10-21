-- Schema de organizações, pessoas e leads. RLS ligado sem policies (deny-all); policies na Task 2.

create extension if not exists pg_trgm with schema extensions;

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies on delete cascade,
  owner_id uuid not null references public.profiles,
  created_by uuid references public.profiles default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  custom_fields jsonb not null default '{}' check (jsonb_typeof(custom_fields) = 'object'),
  name text not null check (char_length(name) between 1 and 200),
  legal_name text,
  cnpj text check (cnpj is null or cnpj ~ '^[0-9]{14}$'),
  domain text check (domain is null or domain ~ '^[a-z0-9.-]+\.[a-z]{2,}$'),
  segment text,
  address jsonb not null default '{}'
);

create table public.persons (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies on delete cascade,
  owner_id uuid not null references public.profiles,
  created_by uuid references public.profiles default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  custom_fields jsonb not null default '{}' check (jsonb_typeof(custom_fields) = 'object'),
  full_name text not null check (char_length(full_name) between 1 and 200),
  job_title text,
  organization_id uuid references public.organizations on delete set null,
  emails jsonb not null default '[]' check (jsonb_typeof(emails) = 'array'),
  phones jsonb not null default '[]' check (jsonb_typeof(phones) = 'array'),
  linkedin_url text
);

create table public.lead_sources (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  position int not null default 0,
  active boolean not null default true,
  unique (company_id, name)
);

create table public.disqualification_reasons (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  position int not null default 0,
  active boolean not null default true,
  unique (company_id, name)
);

create table public.leads (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies on delete cascade,
  owner_id uuid not null references public.profiles,
  created_by uuid references public.profiles default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  custom_fields jsonb not null default '{}' check (jsonb_typeof(custom_fields) = 'object'),
  title text not null check (char_length(title) between 1 and 200),
  source_id uuid references public.lead_sources on delete set null,
  person_id uuid references public.persons on delete set null,
  organization_id uuid references public.organizations on delete set null,
  estimated_value numeric(14,2) check (estimated_value >= 0),
  status text not null default 'open' check (status in ('open','converted','disqualified','archived')),
  disqualification_reason_id uuid references public.disqualification_reasons on delete restrict,
  disqualification_note text,
  converted_deal_id uuid,
  converted_at timestamptz,
  check (status <> 'disqualified' or disqualification_reason_id is not null)
);

create table public.labels (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  color text not null check (color in ('teal','blue','green','red','gray','purple')),
  unique (company_id, name)
);

create table public.record_labels (
  label_id uuid not null references public.labels on delete cascade,
  entity text not null check (entity in ('leads','persons','organizations')),
  record_id uuid not null,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  primary key (label_id, entity, record_id)
);

create table public.custom_field_defs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies on delete cascade,
  entity text not null check (entity in ('leads','persons','organizations','deals','activities')),
  key text not null check (key ~ '^[a-z][a-z0-9_]{0,39}$'),
  label text not null check (char_length(label) between 1 and 60),
  type text not null check (type in ('text','number','money','date','select','multiselect','user')),
  options jsonb not null default '[]' check (jsonb_typeof(options) = 'array'),
  position int not null default 0,
  archived_at timestamptz,
  unique (company_id, entity, key),
  check (type not in ('select','multiselect') or jsonb_array_length(options) > 0)
);

create table public.notes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies on delete cascade,
  entity text not null check (entity in ('leads','persons','organizations')),
  record_id uuid not null,
  body text not null check (char_length(body) between 1 and 10000),
  created_by uuid not null default auth.uid() references public.profiles,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table public.timeline_events (
  id bigint generated always as identity primary key,
  company_id uuid not null references public.companies on delete cascade,
  entity text not null,
  record_id uuid not null,
  kind text not null check (kind in ('created','updated','owner_changed','status_changed','note_added',
    'label_added','label_removed','trashed','restored')),
  actor_id uuid,
  data jsonb not null default '{}',
  created_at timestamptz not null default now()
);

-- Índices
create index organizations_owner_idx on public.organizations (company_id, owner_id);
create index organizations_deleted_idx on public.organizations (company_id, deleted_at);
create index persons_owner_idx on public.persons (company_id, owner_id);
create index persons_deleted_idx on public.persons (company_id, deleted_at);
create index leads_owner_idx on public.leads (company_id, owner_id);
create index leads_deleted_idx on public.leads (company_id, deleted_at);
create index organizations_name_trgm on public.organizations using gin (lower(name) extensions.gin_trgm_ops);
create index persons_name_trgm on public.persons using gin (lower(full_name) extensions.gin_trgm_ops);
create index leads_title_trgm on public.leads using gin (lower(title) extensions.gin_trgm_ops);
create index persons_emails_gin on public.persons using gin (emails jsonb_path_ops);
create index persons_phones_gin on public.persons using gin (phones jsonb_path_ops);
create unique index organizations_cnpj_uniq on public.organizations (company_id, cnpj)
  where cnpj is not null and deleted_at is null;
create unique index organizations_domain_uniq on public.organizations (company_id, domain)
  where domain is not null and deleted_at is null;
create index notes_record_idx on public.notes (entity, record_id);
create index timeline_events_record_idx on public.timeline_events (entity, record_id, created_at desc);
create index record_labels_record_idx on public.record_labels (entity, record_id);

-- updated_at
create trigger set_updated_at before update on public.organizations
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.persons
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.leads
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.notes
  for each row execute function public.set_updated_at();

-- Normalização de contatos da pessoa
create function public.normalize_person_contacts() returns trigger
language plpgsql set search_path = public as $$
begin
  new.emails = coalesce((
    select jsonb_agg(jsonb_set(e, '{value}', to_jsonb(lower(regexp_replace(e->>'value', '\s', '', 'g')))) order by o)
    from jsonb_array_elements(new.emails) with ordinality as t(e, o)
  ), '[]'::jsonb);
  new.phones = coalesce((
    select jsonb_agg(jsonb_set(e, '{value}', to_jsonb(regexp_replace(e->>'value', '\D', '', 'g'))) order by o)
    from jsonb_array_elements(new.phones) with ordinality as t(e, o)
  ), '[]'::jsonb);
  return new;
end $$;

create trigger normalize_person_contacts before insert or update on public.persons
  for each row execute function public.normalize_person_contacts();

-- Referências precisam ser da mesma empresa
create function public.guard_same_company() returns trigger
language plpgsql set search_path = public as $$
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

create trigger guard_same_company before insert or update on public.persons
  for each row execute function public.guard_same_company();
create trigger guard_same_company before insert or update on public.leads
  for each row execute function public.guard_same_company();
create trigger guard_same_company before insert or update on public.notes
  for each row execute function public.guard_same_company();
create trigger guard_same_company before insert or update on public.record_labels
  for each row execute function public.guard_same_company();

-- Seed de origens e motivos padrão
create function public.seed_company_defaults(p_company uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into public.lead_sources (company_id, name, position)
  select p_company, n, o - 1
  from unnest(array['Indicação','Prospecção ativa','Site','Evento','LinkedIn','Outro']) with ordinality as t(n, o)
  on conflict (company_id, name) do nothing;
  insert into public.disqualification_reasons (company_id, name, position)
  select p_company, n, o - 1
  from unnest(array['Sem fit','Sem orçamento','Sem interesse','Contato inválido','Já é cliente','Outro']) with ordinality as t(n, o)
  on conflict (company_id, name) do nothing;
end $$;

create function public.seed_company_defaults_trigger() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.seed_company_defaults(new.id);
  return new;
end $$;

create trigger seed_company_defaults after insert on public.companies
  for each row execute function public.seed_company_defaults_trigger();

select public.seed_company_defaults(id) from public.companies;

revoke execute on function public.seed_company_defaults(uuid), public.seed_company_defaults_trigger(),
  public.normalize_person_contacts(), public.guard_same_company() from public, anon, authenticated;

-- RLS ligado, sem policies (deny-all); anon nunca toca nestas tabelas.
alter table public.organizations enable row level security;
alter table public.persons enable row level security;
alter table public.lead_sources enable row level security;
alter table public.disqualification_reasons enable row level security;
alter table public.leads enable row level security;
alter table public.labels enable row level security;
alter table public.record_labels enable row level security;
alter table public.custom_field_defs enable row level security;
alter table public.notes enable row level security;
alter table public.timeline_events enable row level security;

revoke all on public.organizations, public.persons, public.lead_sources, public.disqualification_reasons,
  public.leads, public.labels, public.record_labels, public.custom_field_defs, public.notes,
  public.timeline_events from anon;
