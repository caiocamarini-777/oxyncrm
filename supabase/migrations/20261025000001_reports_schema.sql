-- Fase 6: relatórios, dashboards e metas, e visibilidade com usuário explícito.

-- Funções _for: espelham as de permissão, mas com o usuário explícito (motor de relatórios,
-- link público e cron). Só o dono e o service role executam; nunca o cliente.
create function public.is_super_admin_for(p_user uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(
    (select p.active and p.is_super_admin from public.profiles p where p.id = p_user),
    false);
$$;

create function public.role_permissions_for(p_user uuid, p_company uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select r.permissions
  from public.memberships m
  join public.roles r on r.id = m.role_id
  join public.companies c on c.id = m.company_id
  where m.user_id = p_user
    and m.company_id = p_company
    and c.archived_at is null;
$$;

create function public.shares_team_for(p_user uuid, p_other uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1
    from public.team_members a
    join public.team_members b on b.team_id = a.team_id
    where a.user_id = p_user and b.user_id = p_other);
$$;

create function public.can_access_for(p_user uuid, p_company uuid, p_entity text, p_owner uuid, p_action text)
returns boolean
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  perms jsonb;
  vis text;
begin
  if p_action not in ('read','create','edit','delete','export','reassign_owner') then
    raise exception 'OXYN_UNKNOWN_ACTION';
  end if;
  if p_user is null
     or not coalesce((select p.active from public.profiles p where p.id = p_user), false) then
    return false;
  end if;
  if public.is_super_admin_for(p_user) then return true; end if;
  perms := public.role_permissions_for(p_user, p_company);
  if perms is null then return false; end if;
  if p_action <> 'read'
     and not coalesce((perms->'actions'->>p_action)::boolean, false) then
    return false;
  end if;
  if p_action = 'create' then return true; end if;
  vis := perms->'visibility'->>p_entity;
  return coalesce(case vis
    when 'company' then true
    when 'team' then p_owner = p_user or public.shares_team_for(p_user, p_owner)
    when 'own' then p_owner = p_user
    else false
  end, false);
end;
$$;

revoke execute on function public.is_super_admin_for(uuid), public.role_permissions_for(uuid, uuid),
  public.shares_team_for(uuid, uuid), public.can_access_for(uuid, uuid, text, uuid, text)
  from public, anon, authenticated;
grant execute on function public.is_super_admin_for(uuid), public.role_permissions_for(uuid, uuid),
  public.shares_team_for(uuid, uuid), public.can_access_for(uuid, uuid, text, uuid, text)
  to service_role;

-- Tabelas -------------------------------------------------------------------------------------------
create table public.reports (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies on delete cascade,
  owner_id uuid not null references public.profiles on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  spec jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index reports_owner_idx on public.reports (owner_id);
create index reports_company_idx on public.reports (company_id);

create table public.dashboards (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  default_filters jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index dashboards_owner_idx on public.dashboards (owner_id);

create table public.dashboard_widgets (
  id uuid primary key default gen_random_uuid(),
  dashboard_id uuid not null references public.dashboards on delete cascade,
  report_id uuid references public.reports on delete cascade,
  spec jsonb,
  title text not null default '' check (char_length(title) <= 120),
  position int not null default 0,
  col_span int not null default 1 check (col_span between 1 and 4),
  row_span int not null default 1 check (row_span between 1 and 3),
  check ((report_id is not null) <> (spec is not null))
);
create index dashboard_widgets_dashboard_idx on public.dashboard_widgets (dashboard_id, position);
create index dashboard_widgets_report_idx on public.dashboard_widgets (report_id) where report_id is not null;

create table public.dashboard_shares (
  dashboard_id uuid not null references public.dashboards on delete cascade,
  user_id uuid not null references public.profiles on delete cascade,
  primary key (dashboard_id, user_id)
);
create index dashboard_shares_user_idx on public.dashboard_shares (user_id);

create table public.dashboard_share_links (
  id uuid primary key default gen_random_uuid(),
  dashboard_id uuid not null references public.dashboards on delete cascade,
  token_hash text not null unique,
  created_by uuid not null references public.profiles on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  revoked_at timestamptz
);
create index dashboard_share_links_dashboard_idx on public.dashboard_share_links (dashboard_id);

create table public.goals (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies on delete cascade,
  target_kind text not null check (target_kind in ('company','user','team')),
  target_user_id uuid references public.profiles on delete cascade,
  target_team_id uuid references public.teams on delete cascade,
  metric text not null check (metric in
    ('meetings_booked','meetings_held','opportunities_created','won_value','won_mrr','activities_done')),
  period text not null check (period in ('week','month','quarter')),
  starts_on date not null,
  target_value numeric not null check (target_value > 0),
  created_by uuid not null references public.profiles on delete cascade,
  created_at timestamptz not null default now(),
  check (
    (target_kind = 'company' and target_user_id is null and target_team_id is null)
    or (target_kind = 'user' and target_user_id is not null and target_team_id is null)
    or (target_kind = 'team' and target_team_id is not null and target_user_id is null)),
  check (
    (period = 'week' and extract(isodow from starts_on) = 1)
    or (period = 'month' and extract(day from starts_on) = 1)
    or (period = 'quarter' and extract(day from starts_on) = 1
        and extract(month from starts_on) in (1, 4, 7, 10)))
);
create index goals_company_period_idx on public.goals (company_id, period, starts_on);

create trigger set_updated_at before update on public.reports
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.dashboards
  for each row execute function public.set_updated_at();

-- Helpers de RLS (security definer evita recursão entre dashboards e dashboard_shares) --------------
create function public.has_report_setting(p_company uuid, p_setting text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select public.current_user_active() and (
    public.is_super_admin()
    or coalesce(public.role_permissions(p_company)->'settings'->>p_setting = 'true', false));
$$;

-- Verdadeiro se o chamador tem a configuração em alguma empresa acessível (ou é admin geral).
create function public.has_any_report_setting(p_setting text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select public.current_user_active() and (
    public.is_super_admin()
    or exists (
      select 1
      from public.memberships m
      join public.roles r on r.id = m.role_id
      join public.companies c on c.id = m.company_id
      where m.user_id = auth.uid()
        and c.archived_at is null
        and r.permissions->'settings'->>p_setting = 'true'));
$$;

create function public.can_create_dashboards() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select public.has_any_report_setting('create_dashboards');
$$;

create function public.owns_dashboard(p_dashboard uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select public.current_user_active() and exists (
    select 1 from public.dashboards d where d.id = p_dashboard and d.owner_id = auth.uid());
$$;

create function public.can_read_dashboard(p_dashboard uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select public.current_user_active() and (
    public.is_super_admin()
    or exists (select 1 from public.dashboards d where d.id = p_dashboard and d.owner_id = auth.uid())
    or exists (select 1 from public.dashboard_shares s
               where s.dashboard_id = p_dashboard and s.user_id = auth.uid()));
$$;

create function public.is_active_user(p_user uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select p.active from public.profiles p where p.id = p_user), false);
$$;

revoke execute on function public.has_report_setting(uuid, text), public.has_any_report_setting(text),
  public.can_create_dashboards(), public.owns_dashboard(uuid), public.can_read_dashboard(uuid),
  public.is_active_user(uuid) from public, anon;
grant execute on function public.has_report_setting(uuid, text), public.has_any_report_setting(text),
  public.can_create_dashboards(), public.owns_dashboard(uuid), public.can_read_dashboard(uuid),
  public.is_active_user(uuid) to authenticated;

-- RLS ---------------------------------------------------------------------------------------------------
alter table public.reports enable row level security;
alter table public.dashboards enable row level security;
alter table public.dashboard_widgets enable row level security;
alter table public.dashboard_shares enable row level security;
alter table public.dashboard_share_links enable row level security;
alter table public.goals enable row level security;

revoke all on public.reports, public.dashboards, public.dashboard_widgets, public.dashboard_shares,
  public.dashboard_share_links, public.goals from anon;
revoke truncate, references, trigger on public.reports, public.dashboards, public.dashboard_widgets,
  public.dashboard_shares, public.dashboard_share_links, public.goals from authenticated;

-- reports
create policy reports_select on public.reports for select to authenticated
  using (public.is_super_admin() or (owner_id = auth.uid() and public.current_user_active()
    and (company_id is null or public.has_report_setting(company_id, 'view_reports'))));
create policy reports_insert on public.reports for insert to authenticated
  with check (public.is_super_admin() or (owner_id = auth.uid() and public.current_user_active()
    and (company_id is null or public.has_report_setting(company_id, 'view_reports'))));
create policy reports_update on public.reports for update to authenticated
  using (public.is_super_admin() or (owner_id = auth.uid() and public.current_user_active()
    and (company_id is null or public.has_report_setting(company_id, 'view_reports'))))
  with check (public.is_super_admin() or (owner_id = auth.uid() and public.current_user_active()
    and (company_id is null or public.has_report_setting(company_id, 'view_reports'))));
create policy reports_delete on public.reports for delete to authenticated
  using (public.is_super_admin() or (owner_id = auth.uid() and public.current_user_active()));

-- dashboards
create policy dashboards_select on public.dashboards for select to authenticated
  using (public.can_read_dashboard(id));
create policy dashboards_insert on public.dashboards for insert to authenticated
  with check (public.can_create_dashboards() and (owner_id = auth.uid() or public.is_super_admin()));
create policy dashboards_update on public.dashboards for update to authenticated
  using (public.is_super_admin() or (owner_id = auth.uid() and public.current_user_active()))
  with check (public.is_super_admin() or (owner_id = auth.uid() and public.current_user_active()));
create policy dashboards_delete on public.dashboards for delete to authenticated
  using (public.is_super_admin() or (owner_id = auth.uid() and public.current_user_active()));

-- dashboard_widgets: lê quem lê o dashboard, escreve só o dono
create policy widgets_select on public.dashboard_widgets for select to authenticated
  using (public.can_read_dashboard(dashboard_id));
create policy widgets_insert on public.dashboard_widgets for insert to authenticated
  with check (public.owns_dashboard(dashboard_id));
create policy widgets_update on public.dashboard_widgets for update to authenticated
  using (public.owns_dashboard(dashboard_id)) with check (public.owns_dashboard(dashboard_id));
create policy widgets_delete on public.dashboard_widgets for delete to authenticated
  using (public.owns_dashboard(dashboard_id));

-- dashboard_shares: dono escreve (com share_dashboards, para usuário ativo); dono e destinatário leem.
-- Remover compartilhamento não exige share_dashboards, para o dono sempre poder revogar.
create policy shares_select on public.dashboard_shares for select to authenticated
  using (user_id = auth.uid() or public.owns_dashboard(dashboard_id));
create policy shares_insert on public.dashboard_shares for insert to authenticated
  with check (public.owns_dashboard(dashboard_id) and public.has_any_report_setting('share_dashboards')
    and public.is_active_user(user_id));
create policy shares_delete on public.dashboard_shares for delete to authenticated
  using (public.owns_dashboard(dashboard_id));

-- dashboard_share_links: só o dono, com share_dashboards; token_hash nunca é legível pelo cliente
create policy links_select on public.dashboard_share_links for select to authenticated
  using (public.owns_dashboard(dashboard_id));
create policy links_insert on public.dashboard_share_links for insert to authenticated
  with check (public.owns_dashboard(dashboard_id) and public.has_any_report_setting('share_dashboards')
    and created_by = auth.uid());
create policy links_update on public.dashboard_share_links for update to authenticated
  using (public.owns_dashboard(dashboard_id) and public.has_any_report_setting('share_dashboards'))
  with check (public.owns_dashboard(dashboard_id) and public.has_any_report_setting('share_dashboards'));
create policy links_delete on public.dashboard_share_links for delete to authenticated
  using (public.owns_dashboard(dashboard_id));
revoke select on public.dashboard_share_links from authenticated;
grant select (id, dashboard_id, created_by, created_at, expires_at, revoked_at)
  on public.dashboard_share_links to authenticated;

-- goals: lê quem tem acesso à empresa; escreve só o admin geral
create policy goals_select on public.goals for select to authenticated
  using (public.has_company_access(company_id));
create policy goals_insert on public.goals for insert to authenticated
  with check (public.is_super_admin());
create policy goals_update on public.goals for update to authenticated
  using (public.is_super_admin()) with check (public.is_super_admin());
create policy goals_delete on public.goals for delete to authenticated
  using (public.is_super_admin());
