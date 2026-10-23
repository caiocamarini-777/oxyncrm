-- Fase 6, correções da revisão final.
-- 1. Compartilhamento respeita a sobreposição de empresas a cada leitura: o destinatário que deixou de dividir
--    empresa com o dono perde o dashboard (can_read_dashboard, corpo da 000001) e os widgets (run_widget, corpo da
--    000006), com can_share_dashboard_with (000002).
-- 2. widgets_select para destinatários exige também que o dono ainda tenha share_dashboards
--    (can_read_dashboard_widgets).
-- 3. restrict_filters (corpo da 000006): atividades sem período usam due_at, o mesmo campo padrão de
--    run_report_custom (000005), para o período do dashboard não mudar o eixo nem descartar linhas.
-- 4. report_preset_goal_progress (corpo da 000010): ordena por rótulo e id (order by 2, 1 passou a ser a métrica).

create or replace function public.can_read_dashboard(p_dashboard uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select public.current_user_active() and (
    public.is_super_admin()
    or exists (select 1 from public.dashboards d where d.id = p_dashboard and d.owner_id = auth.uid())
    or (exists (select 1 from public.dashboard_shares s
                where s.dashboard_id = p_dashboard and s.user_id = auth.uid())
        and public.can_share_dashboard_with(p_dashboard, auth.uid())));
$$;

-- Widgets de um dashboard: dono e admin geral; destinatário só enquanto divide empresa com o dono e o dono
-- (ativo) ainda tem share_dashboards.
create function public.can_read_dashboard_widgets(p_dashboard uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select public.current_user_active() and (
    public.is_super_admin()
    or exists (select 1 from public.dashboards d where d.id = p_dashboard and d.owner_id = auth.uid())
    or exists (
      select 1
      from public.dashboard_shares s
      join public.dashboards d on d.id = s.dashboard_id
      where s.dashboard_id = p_dashboard and s.user_id = auth.uid()
        and public.can_share_dashboard_with(p_dashboard, auth.uid())
        and public.has_any_report_setting_for(d.owner_id, 'share_dashboards')));
$$;
revoke execute on function public.can_read_dashboard_widgets(uuid) from public, anon;
grant execute on function public.can_read_dashboard_widgets(uuid) to authenticated;

drop policy widgets_select on public.dashboard_widgets;
create policy widgets_select on public.dashboard_widgets for select to authenticated
  using (public.can_read_dashboard_widgets(dashboard_id));

create or replace function public.run_widget(p_widget uuid, p_filters jsonb) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  me uuid := auth.uid();
  v_dash uuid;
  v_owner uuid;
begin
  if me is null or not public.current_user_active() then
    raise exception 'OXYN_FORBIDDEN';
  end if;
  select d.id, d.owner_id into v_dash, v_owner
  from public.dashboard_widgets w
  join public.dashboards d on d.id = w.dashboard_id
  where w.id = p_widget;
  if v_dash is null then
    raise exception 'OXYN_FORBIDDEN';
  end if;
  if v_owner = me or public.is_super_admin() then
    return public.run_widget_as(p_widget, me, public.report_companies_for(me), p_filters);
  end if;
  if exists (select 1 from public.dashboard_shares s where s.dashboard_id = v_dash and s.user_id = me)
     and public.can_share_dashboard_with(v_dash, me)
     and public.has_any_report_setting_for(v_owner, 'share_dashboards') then
    return public.run_widget_as(p_widget, v_owner, public.report_companies_for(v_owner), p_filters);
  end if;
  raise exception 'OXYN_FORBIDDEN';
end $$;


create or replace function public.restrict_filters(p_spec jsonb, p_filters jsonb, p_allowed_companies uuid[],
  out spec jsonb, out companies uuid[])
language plpgsql stable set search_path = public, pg_temp as $$
declare
  v_f jsonb := case when p_filters is null or jsonb_typeof(p_filters) = 'null' then '{}'::jsonb else p_filters end;
  v_p jsonb;
  v_ids jsonb;
  v_extra jsonb := '[]'::jsonb;
  v_empty boolean := false;
  v_from date;
  v_to date;
  k text;
begin
  if jsonb_typeof(v_f) <> 'object'
     or exists (select 1 from jsonb_object_keys(v_f) x where x not in ('company', 'owner', 'team', 'period')) then
    raise exception 'OXYN_INVALID_REPORT' using detail = 'filters';
  end if;
  if p_spec is null or jsonb_typeof(p_spec) <> 'object' then
    raise exception 'OXYN_INVALID_REPORT' using detail = 'spec';
  end if;
  if coalesce(jsonb_typeof(p_spec->'filters'), 'null') not in ('null', 'array') then
    raise exception 'OXYN_INVALID_REPORT' using detail = 'filters';
  end if;
  spec := p_spec;

  -- empresas
  companies := array(select distinct c from unnest(coalesce(p_allowed_companies, '{}'::uuid[])) c where c is not null);
  if coalesce(jsonb_typeof(v_f->'company'), 'null') <> 'null' then
    v_ids := public.restrict_filter_ids(v_f->'company');
    companies := array(select c from unnest(companies) c
                       where c = any (array(select x::uuid from jsonb_array_elements_text(v_ids) x)));
  end if;

  -- responsável e equipe
  foreach k in array array['owner', 'team'] loop
    if coalesce(jsonb_typeof(v_f->k), 'null') <> 'null' then
      v_ids := public.restrict_filter_ids(v_f->k);
      if jsonb_array_length(v_ids) = 0 then
        v_empty := true;
      else
        v_extra := v_extra || jsonb_build_array(jsonb_build_object('field', k, 'op', 'in', 'value', v_ids));
      end if;
    end if;
  end loop;
  if jsonb_array_length(v_extra) > 0 then
    spec := jsonb_set(spec, '{filters}',
      coalesce(nullif(spec->'filters', 'null'::jsonb), '[]'::jsonb) || v_extra);
  end if;

  -- período
  if coalesce(jsonb_typeof(v_f->'period'), 'null') <> 'null' then
    v_p := v_f->'period';
    if jsonb_typeof(v_p) <> 'object'
       or exists (select 1 from jsonb_object_keys(v_p) x where x not in ('from', 'to'))
       or not public.report_valid_date(v_p->'from') or not public.report_valid_date(v_p->'to')
       or (v_p->>'from')::date > (v_p->>'to')::date then
      raise exception 'OXYN_INVALID_REPORT' using detail = 'filters';
    end if;
    v_from := (v_p->>'from')::date;
    v_to := (v_p->>'to')::date;
    if jsonb_typeof(spec->'period') = 'object' then
      if not public.report_valid_date(spec->'period'->'from') or not public.report_valid_date(spec->'period'->'to') then
        raise exception 'OXYN_INVALID_REPORT' using detail = 'period';
      end if;
      v_from := greatest(v_from, (spec#>>'{period,from}')::date);
      v_to := least(v_to, (spec#>>'{period,to}')::date);
      if v_from > v_to then
        v_empty := true;
      else
        spec := jsonb_set(jsonb_set(spec, '{period,from}', to_jsonb(to_char(v_from, 'YYYY-MM-DD'))),
          '{period,to}', to_jsonb(to_char(v_to, 'YYYY-MM-DD')));
      end if;
    elsif spec->'kind' = '"custom"'::jsonb then
      spec := spec || jsonb_build_object('period', jsonb_build_object(
        'field', case spec->>'base' when 'activities' then 'due_at' when 'revenue' then 'month'
                   when 'stage_history' then 'moved_at' else 'created_at' end,
        'from', to_char(v_from, 'YYYY-MM-DD'), 'to', to_char(v_to, 'YYYY-MM-DD')));
    else
      spec := spec || jsonb_build_object('period', jsonb_build_object(
        'from', to_char(v_from, 'YYYY-MM-DD'), 'to', to_char(v_to, 'YYYY-MM-DD')));
    end if;
  end if;

  if v_empty then
    companies := '{}'::uuid[];
  end if;
end $$;

create or replace function public.report_preset_goal_progress(p_params jsonb, p_companies uuid[], p_viewer uuid,
  p_from date, p_to date) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  with gl as (
    select g.id, g.metric, public.report_goal_label(g.id) as label, public.goal_progress(g.id, p_viewer) as p
    from public.goals g
    where g.company_id = any (p_companies)
      and public.report_filter_ok(p_params->'filters', 'owner',
        case when g.target_kind = 'user' then g.target_user_id end)
      and not exists (
        select 1 from jsonb_array_elements(coalesce(p_params->'filters', '[]'::jsonb)) f
        where f->>'field' = 'team' and not (
          (g.target_kind = 'team' and g.target_team_id = any (public.report_filter_uuids(f)))
          or (g.target_kind = 'user' and exists (
            select 1 from public.team_members tm
            where tm.user_id = g.target_user_id and tm.team_id = any (public.report_filter_uuids(f))))))
    order by label, id
    limit 501
  )
  select jsonb_build_object(
    'columns', jsonb_build_array(
      public.report_col('goal', 'Meta', 'text'),
      public.report_col('target', 'Alvo', 'number'),
      public.report_col('actual', 'Realizado', 'number'),
      public.report_col('percent', 'Progresso', 'percent'),
      public.report_col('period_start', 'Início do período', 'date'),
      public.report_col('period_end', 'Fim do período', 'date'),
      public.report_col('metric', 'Métrica', 'text')),
    'rows', coalesce((select jsonb_agg(jsonb_build_array(gl.label, gl.p->'target', gl.p->'actual', gl.p->'percent',
        gl.p->'period_start', gl.p->'period_end', gl.metric) order by gl.label, gl.id) from gl), '[]'::jsonb),
    'total', null);
$$;
