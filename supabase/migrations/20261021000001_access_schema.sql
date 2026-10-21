-- Schema de acesso multiempresa. RLS habilitado sem policies (deny-all); policies na Task 4.

create or replace function public.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

create or replace function public.is_valid_permissions(p jsonb) returns boolean
language plpgsql immutable as $$
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

create table public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique not null
    check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and slug <> 'todas'),
  legal_name text,
  cnpj text check (cnpj is null or cnpj ~ '^\d{14}$'),
  logo_url text,
  currency char(3) not null default 'BRL',
  settings jsonb not null default '{}',
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  full_name text not null default '',
  email text unique not null,
  avatar_url text,
  is_super_admin boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.roles (
  id uuid primary key default gen_random_uuid(),
  name text unique not null,
  description text,
  permissions jsonb not null check (public.is_valid_permissions(permissions)),
  is_system boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.teams (
  id uuid primary key default gen_random_uuid(),
  name text unique not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.team_members (
  team_id uuid not null references public.teams on delete cascade,
  user_id uuid not null references public.profiles on delete cascade,
  primary key (team_id, user_id)
);

create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles on delete cascade,
  company_id uuid not null references public.companies on delete cascade,
  role_id uuid not null references public.roles on delete restrict,
  created_at timestamptz not null default now(),
  unique (user_id, company_id)
);

create table public.audit_log (
  id bigint generated always as identity primary key,
  table_name text not null,
  record_id uuid,
  action text check (action in ('insert','update','delete')),
  actor_id uuid,
  old_data jsonb,
  new_data jsonb,
  created_at timestamptz not null default now()
);
create index audit_log_table_record_idx on public.audit_log (table_name, record_id);

create trigger set_updated_at before update on public.companies
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.roles
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.teams
  for each row execute function public.set_updated_at();

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', ''));
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

alter table public.companies enable row level security;
alter table public.profiles enable row level security;
alter table public.roles enable row level security;
alter table public.teams enable row level security;
alter table public.team_members enable row level security;
alter table public.memberships enable row level security;
alter table public.audit_log enable row level security;

insert into public.roles (name, description, permissions, is_system) values (
  'Usuário padrão',
  'Papel padrão do sistema: vê apenas os próprios registros.',
  '{"visibility":{"leads":"own","deals":"own","persons":"own","organizations":"own","activities":"own"},"actions":{"create":true,"edit":true,"delete":false,"export":false,"reassign_owner":false},"settings":{"manage_pipelines":false,"manage_custom_fields":false,"manage_products":false,"view_reports":true,"create_dashboards":true,"share_dashboards":false}}'::jsonb,
  true);
