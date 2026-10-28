-- Insights (relatórios e painéis no modelo do Pipedrive): esquema e RLS.
-- * Relatório no formato do Pipedrive: data_type, report_type, chart_type, parameters (group_by, measure_by,
--   segment_by, filter_by, stages, is_cumulative, chart_size_amount), columns e colors.
-- * Painel só referencia relatórios salvos, em grade de 4 colunas (x, y, w, h).
-- * Acesso: dono e compartilhado com can_edit editam; compartilhado lê; quem lê um painel lê os relatórios dele.
-- * Substitui reports/dashboards/dashboard_widgets/dashboard_shares/dashboard_share_links (dados só de dev).
--   As funções do motor antigo que não dependem dessas tabelas ficam: as metas ainda usam os presets.

-- 1. Remove o módulo antigo ---------------------------------------------------------------------------------
drop table if exists public.dashboard_share_links, public.dashboard_shares, public.dashboard_widgets,
  public.dashboards, public.reports cascade;
drop function if exists public.run_widget_public(text, uuid, jsonb);
drop function if exists public.run_widget(uuid, jsonb);
drop function if exists public.run_widget_as(uuid, uuid, uuid[], jsonb);
drop function if exists public.dashboard_public(text);
drop function if exists public.share_link_dashboard(text);
drop function if exists public.create_share_link(uuid, timestamptz);
drop function if exists public.revoke_share_link(uuid);
drop function if exists public.update_widget_layout(uuid, jsonb);
drop function if exists public.report_owned_by_dashboard_owner(uuid, uuid);
drop function if exists public.can_share_dashboard_with(uuid, uuid);
drop function if exists public.can_read_dashboard_widgets(uuid);
drop function if exists public.can_read_dashboard(uuid);
drop function if exists public.owns_dashboard(uuid);

-- 2. Tabelas ----------------------------------------------------------------------------------------------
create table public.insight_reports (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies on delete cascade,
  owner_id uuid not null references public.profiles on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  data_type text not null check (data_type in ('deals', 'activities', 'leads', 'organizations', 'people')),
  report_type text not null,
  chart_type text not null check (chart_type in ('column', 'bar', 'pie', 'scorecard', 'table', 'funnel')),
  parameters jsonb not null default '{}'::jsonb check (jsonb_typeof(parameters) = 'object'),
  columns jsonb not null default '[]'::jsonb check (jsonb_typeof(columns) = 'array'),
  colors jsonb not null default '{}'::jsonb check (jsonb_typeof(colors) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index insight_reports_company_idx on public.insight_reports (company_id);
create index insight_reports_owner_idx on public.insight_reports (owner_id);

create table public.insight_report_shares (
  report_id uuid not null references public.insight_reports on delete cascade,
  user_id uuid not null references public.profiles on delete cascade,
  can_edit boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (report_id, user_id)
);
create index insight_report_shares_user_idx on public.insight_report_shares (user_id);

create table public.insight_dashboards (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies on delete cascade,
  owner_id uuid not null references public.profiles on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index insight_dashboards_company_idx on public.insight_dashboards (company_id);
create index insight_dashboards_owner_idx on public.insight_dashboards (owner_id);

-- Grade de 4 colunas; altura na unidade do Pipedrive (5 = cartão padrão).
create table public.insight_dashboard_reports (
  dashboard_id uuid not null references public.insight_dashboards on delete cascade,
  report_id uuid not null references public.insight_reports on delete cascade,
  x int not null check (x between 0 and 3),
  y int not null check (y between 0 and 10000),
  w int not null check (w between 1 and 4),
  h int not null check (h between 2 and 20),
  primary key (dashboard_id, report_id),
  check (x + w <= 4)
);
create index insight_dashboard_reports_report_idx on public.insight_dashboard_reports (report_id);

create table public.insight_dashboard_shares (
  dashboard_id uuid not null references public.insight_dashboards on delete cascade,
  user_id uuid not null references public.profiles on delete cascade,
  can_edit boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (dashboard_id, user_id)
);
create index insight_dashboard_shares_user_idx on public.insight_dashboard_shares (user_id);

create table public.insight_dashboard_links (
  id uuid primary key default gen_random_uuid(),
  dashboard_id uuid not null references public.insight_dashboards on delete cascade,
  token_hash text not null unique,
  created_by uuid not null references public.profiles on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  revoked_at timestamptz
);
create index insight_dashboard_links_dashboard_idx on public.insight_dashboard_links (dashboard_id);

-- Filtros rápidos do painel, por usuário (como o quick_filters do Pipedrive).
create table public.insight_quick_filters (
  dashboard_id uuid not null references public.insight_dashboards on delete cascade,
  user_id uuid not null references public.profiles on delete cascade,
  period jsonb check (period is null or jsonb_typeof(period) = 'object'),
  user_ids uuid[] not null default '{}',
  pipeline_id uuid references public.pipelines on delete set null,
  updated_at timestamptz not null default now(),
  primary key (dashboard_id, user_id)
);

-- Cor padrão da empresa por campo e valor (ex.: status/won, channel/<id do canal>).
create table public.insight_colors (
  company_id uuid not null references public.companies on delete cascade,
  field text not null check (char_length(field) between 1 and 80),
  value text not null check (char_length(value) between 1 and 200),
  color text not null check (color ~ '^#[0-9a-f]{6}$'),
  updated_at timestamptz not null default now(),
  primary key (company_id, field, value)
);

-- "Minhas cores salvas" do diálogo de cores.
create table public.insight_saved_colors (
  user_id uuid primary key references public.profiles on delete cascade,
  colors text[] not null default '{}' check (cardinality(colors) <= 28),
  updated_at timestamptz not null default now()
);

create trigger set_updated_at before update on public.insight_reports
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.insight_dashboards
  for each row execute function public.set_updated_at();

-- Dono e empresa não mudam depois de criados.
create function public.guard_insight_owner() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if new.owner_id is distinct from old.owner_id or new.company_id is distinct from old.company_id then
    raise exception 'OXYN_FORBIDDEN';
  end if;
  return new;
end $$;
create trigger guard_owner before update on public.insight_reports
  for each row execute function public.guard_insight_owner();
create trigger guard_owner before update on public.insight_dashboards
  for each row execute function public.guard_insight_owner();

-- 3. Acesso ------------------------------------------------------------------------------------------------
-- Nível de acesso do usuário a um painel: 'edit', 'read' ou null.
create function public.insight_dashboard_access_for(p_user uuid, p_dashboard uuid) returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select case
    when not public.is_active_user(p_user) then null
    when public.is_super_admin_for(p_user) then 'edit'
    when not coalesce((public.role_permissions_for(p_user, d.company_id)->'settings'->>'view_reports') = 'true', false)
      then null
    when d.owner_id = p_user then 'edit'
    when s.can_edit then 'edit'
    when s.user_id is not null then 'read'
  end
  from public.insight_dashboards d
  left join public.insight_dashboard_shares s on s.dashboard_id = d.id and s.user_id = p_user
  where d.id = p_dashboard;
$$;

-- Nível de acesso a um relatório: dono/compartilhado com edição editam; compartilhado ou presente num painel
-- que o usuário lê, lê.
create function public.insight_report_access_for(p_user uuid, p_report uuid) returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select case
    when not public.is_active_user(p_user) then null
    when public.is_super_admin_for(p_user) then 'edit'
    when not coalesce((public.role_permissions_for(p_user, r.company_id)->'settings'->>'view_reports') = 'true', false)
      then null
    when r.owner_id = p_user then 'edit'
    when s.can_edit then 'edit'
    when s.user_id is not null then 'read'
    when exists (select 1 from public.insight_dashboard_reports dr
                 where dr.report_id = r.id
                   and public.insight_dashboard_access_for(p_user, dr.dashboard_id) is not null) then 'read'
  end
  from public.insight_reports r
  left join public.insight_report_shares s on s.report_id = r.id and s.user_id = p_user
  where r.id = p_report;
$$;

create function public.can_read_insight_report(p_report uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select public.insight_report_access_for(auth.uid(), p_report) is not null;
$$;
create function public.can_edit_insight_report(p_report uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select public.insight_report_access_for(auth.uid(), p_report) = 'edit';
$$;
create function public.owns_insight_report(p_report uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select public.current_user_active() and (public.is_super_admin() or exists (
    select 1 from public.insight_reports r where r.id = p_report and r.owner_id = auth.uid()));
$$;
create function public.can_read_insight_dashboard(p_dashboard uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select public.insight_dashboard_access_for(auth.uid(), p_dashboard) is not null;
$$;
create function public.can_edit_insight_dashboard(p_dashboard uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select public.insight_dashboard_access_for(auth.uid(), p_dashboard) = 'edit';
$$;
create function public.owns_insight_dashboard(p_dashboard uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select public.current_user_active() and (public.is_super_admin() or exists (
    select 1 from public.insight_dashboards d where d.id = p_dashboard and d.owner_id = auth.uid()));
$$;
-- Pode criar relatório/painel na empresa: vê relatórios nela e tem create_dashboards.
create function public.can_create_insights(p_company uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select public.current_user_active() and (public.is_super_admin() or (
    public.has_report_setting(p_company, 'view_reports') and public.has_report_setting(p_company, 'create_dashboards')));
$$;

revoke execute on function public.insight_dashboard_access_for(uuid, uuid), public.insight_report_access_for(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.insight_dashboard_access_for(uuid, uuid), public.insight_report_access_for(uuid, uuid)
  to service_role;
revoke execute on function public.can_read_insight_report(uuid), public.can_edit_insight_report(uuid),
  public.owns_insight_report(uuid), public.can_read_insight_dashboard(uuid), public.can_edit_insight_dashboard(uuid),
  public.owns_insight_dashboard(uuid), public.can_create_insights(uuid) from public, anon;
grant execute on function public.can_read_insight_report(uuid), public.can_edit_insight_report(uuid),
  public.owns_insight_report(uuid), public.can_read_insight_dashboard(uuid), public.can_edit_insight_dashboard(uuid),
  public.owns_insight_dashboard(uuid), public.can_create_insights(uuid) to authenticated;

-- 4. RLS ---------------------------------------------------------------------------------------------------
alter table public.insight_reports enable row level security;
alter table public.insight_report_shares enable row level security;
alter table public.insight_dashboards enable row level security;
alter table public.insight_dashboard_reports enable row level security;
alter table public.insight_dashboard_shares enable row level security;
alter table public.insight_dashboard_links enable row level security;
alter table public.insight_quick_filters enable row level security;
alter table public.insight_colors enable row level security;
alter table public.insight_saved_colors enable row level security;

revoke all on public.insight_reports, public.insight_report_shares, public.insight_dashboards,
  public.insight_dashboard_reports, public.insight_dashboard_shares, public.insight_dashboard_links,
  public.insight_quick_filters, public.insight_colors, public.insight_saved_colors from anon;
revoke truncate, references, trigger on public.insight_reports, public.insight_report_shares,
  public.insight_dashboards, public.insight_dashboard_reports, public.insight_dashboard_shares,
  public.insight_dashboard_links, public.insight_quick_filters, public.insight_colors,
  public.insight_saved_colors from authenticated;

create policy insight_reports_select on public.insight_reports for select to authenticated
  using (public.can_read_insight_report(id));
create policy insight_reports_insert on public.insight_reports for insert to authenticated
  with check (owner_id = auth.uid() and public.can_create_insights(company_id));
create policy insight_reports_update on public.insight_reports for update to authenticated
  using (public.can_edit_insight_report(id)) with check (public.can_edit_insight_report(id));
create policy insight_reports_delete on public.insight_reports for delete to authenticated
  using (public.owns_insight_report(id));

create policy insight_report_shares_select on public.insight_report_shares for select to authenticated
  using (user_id = auth.uid() or public.owns_insight_report(report_id));
create policy insight_report_shares_insert on public.insight_report_shares for insert to authenticated
  with check (public.owns_insight_report(report_id) and public.has_any_report_setting('share_dashboards')
    and public.is_active_user(user_id));
create policy insight_report_shares_update on public.insight_report_shares for update to authenticated
  using (public.owns_insight_report(report_id))
  with check (public.owns_insight_report(report_id) and public.has_any_report_setting('share_dashboards'));
create policy insight_report_shares_delete on public.insight_report_shares for delete to authenticated
  using (public.owns_insight_report(report_id));

create policy insight_dashboards_select on public.insight_dashboards for select to authenticated
  using (public.can_read_insight_dashboard(id));
create policy insight_dashboards_insert on public.insight_dashboards for insert to authenticated
  with check (owner_id = auth.uid() and public.can_create_insights(company_id));
create policy insight_dashboards_update on public.insight_dashboards for update to authenticated
  using (public.can_edit_insight_dashboard(id)) with check (public.can_edit_insight_dashboard(id));
create policy insight_dashboards_delete on public.insight_dashboards for delete to authenticated
  using (public.owns_insight_dashboard(id));

-- Itens do painel: lê quem lê o painel; escreve quem edita o painel, com relatório da mesma empresa que ele lê.
create function public.insight_item_ok(p_dashboard uuid, p_report uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select public.can_edit_insight_dashboard(p_dashboard) and public.can_read_insight_report(p_report)
    and exists (select 1 from public.insight_dashboards d join public.insight_reports r on r.company_id = d.company_id
                where d.id = p_dashboard and r.id = p_report);
$$;
revoke execute on function public.insight_item_ok(uuid, uuid) from public, anon;
grant execute on function public.insight_item_ok(uuid, uuid) to authenticated;

create policy insight_items_select on public.insight_dashboard_reports for select to authenticated
  using (public.can_read_insight_dashboard(dashboard_id));
create policy insight_items_insert on public.insight_dashboard_reports for insert to authenticated
  with check (public.insight_item_ok(dashboard_id, report_id));
create policy insight_items_update on public.insight_dashboard_reports for update to authenticated
  using (public.can_edit_insight_dashboard(dashboard_id)) with check (public.insight_item_ok(dashboard_id, report_id));
create policy insight_items_delete on public.insight_dashboard_reports for delete to authenticated
  using (public.can_edit_insight_dashboard(dashboard_id));

create policy insight_dashboard_shares_select on public.insight_dashboard_shares for select to authenticated
  using (user_id = auth.uid() or public.owns_insight_dashboard(dashboard_id));
create policy insight_dashboard_shares_insert on public.insight_dashboard_shares for insert to authenticated
  with check (public.owns_insight_dashboard(dashboard_id) and public.has_any_report_setting('share_dashboards')
    and public.is_active_user(user_id));
create policy insight_dashboard_shares_update on public.insight_dashboard_shares for update to authenticated
  using (public.owns_insight_dashboard(dashboard_id))
  with check (public.owns_insight_dashboard(dashboard_id) and public.has_any_report_setting('share_dashboards'));
create policy insight_dashboard_shares_delete on public.insight_dashboard_shares for delete to authenticated
  using (public.owns_insight_dashboard(dashboard_id));

-- Links: o token só existe no retorno de create_insight_link; o hash nunca é legível pelo cliente.
create policy insight_links_select on public.insight_dashboard_links for select to authenticated
  using (public.owns_insight_dashboard(dashboard_id));
create policy insight_links_update on public.insight_dashboard_links for update to authenticated
  using (public.owns_insight_dashboard(dashboard_id)) with check (public.owns_insight_dashboard(dashboard_id));
revoke insert, delete on public.insight_dashboard_links from authenticated;
revoke select, update on public.insight_dashboard_links from authenticated;
grant select (id, dashboard_id, created_by, created_at, expires_at, revoked_at) on public.insight_dashboard_links to authenticated;
grant update (revoked_at) on public.insight_dashboard_links to authenticated;

create policy insight_quick_filters_all on public.insight_quick_filters for all to authenticated
  using (user_id = auth.uid() and public.can_read_insight_dashboard(dashboard_id))
  with check (user_id = auth.uid() and public.can_read_insight_dashboard(dashboard_id));

create policy insight_colors_select on public.insight_colors for select to authenticated
  using (public.has_company_access(company_id));
create policy insight_colors_write on public.insight_colors for all to authenticated
  using (public.can_create_insights(company_id)) with check (public.can_create_insights(company_id));

create policy insight_saved_colors_all on public.insight_saved_colors for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid() and public.current_user_active());

-- 5. Link público ---------------------------------------------------------------------------------------------
create function public.create_insight_link(p_dashboard uuid, p_expires_at timestamptz default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_token text;
  v_id uuid;
begin
  if not public.owns_insight_dashboard(p_dashboard) or not public.has_any_report_setting('share_dashboards') then
    raise exception 'OXYN_FORBIDDEN';
  end if;
  if p_expires_at is not null and p_expires_at <= now() then
    raise exception 'OXYN_INVALID_INPUT';
  end if;
  v_token := rtrim(translate(encode(extensions.gen_random_bytes(32), 'base64'), E'+/\n', '-_'), '=');
  insert into public.insight_dashboard_links (dashboard_id, token_hash, created_by, expires_at)
  values (p_dashboard, encode(extensions.digest(v_token, 'sha256'), 'hex'), auth.uid(), p_expires_at)
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'token', v_token);
end $$;
revoke execute on function public.create_insight_link(uuid, timestamptz) from public, anon;
grant execute on function public.create_insight_link(uuid, timestamptz) to authenticated;

-- Painel de um token válido (o dono ainda pode compartilhar e ver relatórios na empresa).
create function public.insight_link_dashboard(p_token text) returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select l.dashboard_id
  from public.insight_dashboard_links l
  join public.insight_dashboards d on d.id = l.dashboard_id
  where p_token is not null and p_token <> ''
    and l.token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
    and l.revoked_at is null
    and (l.expires_at is null or l.expires_at > now())
    and public.has_any_report_setting_for(d.owner_id, 'share_dashboards')
    and public.insight_dashboard_access_for(d.owner_id, d.id) is not null;
$$;
revoke execute on function public.insight_link_dashboard(text) from public, anon, authenticated;
grant execute on function public.insight_link_dashboard(text) to service_role;
