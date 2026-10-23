-- Fase 6: execução de widgets com compartilhamento, links públicos e progresso de metas.
--
-- Regra central do compartilhamento: quem vê um dashboard compartilhado (usuário ou link público) vê os números
-- do dono (viewer = dono), nas empresas em que o dono tem view_reports. A cada visualização o dono precisa estar
-- ativo e ainda ter share_dashboards em alguma empresa. O dono vendo o próprio dashboard (ou o admin geral) usa o
-- próprio alcance e não precisa de share_dashboards.
-- Os filtros do dashboard só restringem (restrict_filters): nada amplia o resultado.

-- Auxiliares com usuário explícito ---------------------------------------------------------------------
-- has_any_report_setting para um usuário explícito (o dono do dashboard), não para auth.uid().
create function public.has_any_report_setting_for(p_user uuid, p_setting text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select public.is_active_user(p_user) and (
    public.is_super_admin_for(p_user)
    or exists (
      select 1
      from public.memberships m
      join public.roles r on r.id = m.role_id
      join public.companies c on c.id = m.company_id
      where m.user_id = p_user
        and c.archived_at is null
        and r.permissions->'settings'->>p_setting = 'true'));
$$;

-- Empresas em que o usuário tem acesso e view_reports (admin geral: todas as não arquivadas). Inativo: nenhuma.
create function public.report_companies_for(p_user uuid) returns uuid[]
language sql stable security definer set search_path = public, pg_temp as $$
  select case
    when not public.is_active_user(p_user) then '{}'::uuid[]
    when public.is_super_admin_for(p_user) then
      array(select c.id from public.companies c where c.archived_at is null order by c.id)
    else array(
      select m.company_id
      from public.memberships m
      join public.roles r on r.id = m.role_id
      join public.companies c on c.id = m.company_id
      where m.user_id = p_user
        and c.archived_at is null
        and r.permissions->'settings'->>'view_reports' = 'true'
      order by m.company_id)
  end;
$$;

-- Filtros do dashboard -----------------------------------------------------------------------------------
-- Valor de filtro de ids: uuid ou lista de uuids (até 500). Devolve sempre um array jsonb.
create function public.restrict_filter_ids(p_value jsonb) returns jsonb
language plpgsql immutable set search_path = public, pg_temp as $$
declare
  v jsonb := case when jsonb_typeof(p_value) = 'string' then jsonb_build_array(p_value) else p_value end;
  e jsonb;
begin
  if jsonb_typeof(v) is distinct from 'array' or jsonb_array_length(v) > 500 then
    raise exception 'OXYN_INVALID_REPORT' using detail = 'filters';
  end if;
  for e in select x from jsonb_array_elements(v) x loop
    if not public.report_valid_scalar('uuid', e) then
      raise exception 'OXYN_INVALID_REPORT' using detail = 'filters';
    end if;
  end loop;
  return v;
end $$;

-- Aplica os filtros do dashboard ({company?, owner?, team?, period?: {from, to}}) a uma spec, sem ampliar nada:
-- - companies = empresas permitidas ∩ filtro company;
-- - owner e team viram filtros "in" adicionais (and) na spec;
-- - o período do filtro é recortado ao período da spec; spec sem período recebe o do filtro (custom: no campo de
--   data padrão da base; preset: {from, to});
-- - lista vazia em company, owner ou team, ou interseção de períodos vazia: companies = '{}' (resultado vazio no
--   formato normal; run_report trata '{}' como nenhuma empresa, nunca como todas).
-- Chave ausente ou null = sem filtro.
create function public.restrict_filters(p_spec jsonb, p_filters jsonb, p_allowed_companies uuid[],
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
        'field', case spec->>'base' when 'activities' then 'completed_at' when 'revenue' then 'month'
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

-- Execução de widgets --------------------------------------------------------------------------------------
-- Roda o widget para um viewer e empresas já autorizados. Spec = reports.spec (report_id) ou widget.spec.
create function public.run_widget_as(p_widget uuid, p_viewer uuid, p_companies uuid[], p_filters jsonb) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_spec jsonb;
  v_r record;
begin
  select coalesce(r.spec, w.spec) into v_spec
  from public.dashboard_widgets w
  left join public.reports r on r.id = w.report_id
  where w.id = p_widget;
  if v_spec is null then
    raise exception 'OXYN_FORBIDDEN';
  end if;
  select * into v_r from public.restrict_filters(v_spec, p_filters, p_companies);
  return public.run_report(v_r.spec, v_r.companies, p_viewer);
end $$;

-- Entrada do cliente. Dono ou admin geral: viewer = auth.uid() e as próprias empresas com view_reports.
-- Destinatário do compartilhamento: viewer = dono (ativo e com share_dashboards), nas empresas do dono.
create function public.run_widget(p_widget uuid, p_filters jsonb) returns jsonb
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
     and public.has_any_report_setting_for(v_owner, 'share_dashboards') then
    return public.run_widget_as(p_widget, v_owner, public.report_companies_for(v_owner), p_filters);
  end if;
  raise exception 'OXYN_FORBIDDEN';
end $$;

-- Links públicos ------------------------------------------------------------------------------------------
-- Dashboard de um token válido: não revogado, não expirado, dono ativo e com share_dashboards. Senão null.
create function public.share_link_dashboard(p_token text) returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select l.dashboard_id
  from public.dashboard_share_links l
  join public.dashboards d on d.id = l.dashboard_id
  where p_token is not null and p_token <> ''
    and l.token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
    and l.revoked_at is null
    and (l.expires_at is null or l.expires_at > now())
    and public.has_any_report_setting_for(d.owner_id, 'share_dashboards');
$$;

-- Cria um link e devolve o token em claro uma única vez (32 bytes aleatórios em base64url). Guarda só o sha256.
create function public.create_share_link(p_dashboard uuid, p_expires_at timestamptz) returns text
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_owner uuid;
  v_token text;
begin
  select d.owner_id into v_owner from public.dashboards d where d.id = p_dashboard;
  if v_owner is null or v_owner is distinct from auth.uid() or not public.current_user_active()
     or not public.has_any_report_setting('share_dashboards') then
    raise exception 'OXYN_FORBIDDEN';
  end if;
  if p_expires_at is not null and p_expires_at <= now() then
    raise exception 'OXYN_INVALID_INPUT';
  end if;
  v_token := rtrim(translate(encode(extensions.gen_random_bytes(32), 'base64'), E'+/\n', '-_'), '=');
  insert into public.dashboard_share_links (dashboard_id, token_hash, created_by, expires_at)
  values (p_dashboard, encode(extensions.digest(v_token, 'sha256'), 'hex'), auth.uid(), p_expires_at);
  return v_token;
end $$;

-- Revoga um link (somente o dono; não exige share_dashboards, para o dono sempre poder revogar).
create function public.revoke_share_link(p_link uuid) returns void
language plpgsql volatile security definer set search_path = public, pg_temp as $$
begin
  update public.dashboard_share_links l
  set revoked_at = coalesce(l.revoked_at, now())
  from public.dashboards d
  where l.id = p_link and d.id = l.dashboard_id and d.owner_id = auth.uid() and public.current_user_active();
  if not found then
    raise exception 'OXYN_FORBIDDEN';
  end if;
end $$;

-- Dashboard do link público: nome, filtros padrão e widgets sem spec (id, título, posição, tamanhos e gráfico).
create function public.dashboard_public(p_token text) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_dash uuid := public.share_link_dashboard(p_token);
begin
  if v_dash is null then
    return null;
  end if;
  return (
    select jsonb_build_object(
      'name', d.name,
      'default_filters', d.default_filters,
      'widgets', coalesce((
        select jsonb_agg(jsonb_build_object('id', w.id, 'title', w.title, 'position', w.position,
            'col_span', w.col_span, 'row_span', w.row_span, 'chart', coalesce(r.spec, w.spec)->>'chart')
          order by w.position, w.id)
        from public.dashboard_widgets w
        left join public.reports r on r.id = w.report_id
        where w.dashboard_id = d.id), '[]'::jsonb))
    from public.dashboards d
    where d.id = v_dash);
end $$;

-- Widget do link público: mesma regra do compartilhamento (viewer = dono); o widget precisa ser do dashboard do token.
create function public.run_widget_public(p_token text, p_widget uuid, p_filters jsonb) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_dash uuid := public.share_link_dashboard(p_token);
  v_owner uuid;
begin
  if v_dash is null
     or not exists (select 1 from public.dashboard_widgets w where w.id = p_widget and w.dashboard_id = v_dash) then
    raise exception 'OXYN_FORBIDDEN';
  end if;
  select d.owner_id into v_owner from public.dashboards d where d.id = v_dash;
  return public.run_widget_as(p_widget, v_owner, public.report_companies_for(v_owner), p_filters);
end $$;

-- Metas ---------------------------------------------------------------------------------------------------
-- O dono do registro pertence ao alvo da meta: empresa = todos; usuário = o próprio; equipe = membros.
create function public.goal_target_has(p_kind text, p_user uuid, p_team uuid, p_owner uuid) returns boolean
language sql stable set search_path = public, pg_temp as $$
  select case p_kind
    when 'company' then true
    when 'user' then p_owner = p_user
    when 'team' then exists (select 1 from public.team_members tm where tm.team_id = p_team and tm.user_id = p_owner)
    else false
  end;
$$;

-- Rótulo da meta: "<métrica> (<alvo>)".
create function public.report_goal_label(p_goal uuid) returns text
language sql stable set search_path = public, pg_temp as $$
  select case g.metric
      when 'meetings_booked' then 'Reuniões agendadas' when 'meetings_held' then 'Reuniões realizadas'
      when 'opportunities_created' then 'Oportunidades criadas' when 'won_value' then 'Valor ganho'
      when 'won_mrr' then 'MRR ganho' when 'activities_done' then 'Atividades concluídas' end
    || ' (' || coalesce(case g.target_kind
      when 'company' then (select c.name from public.companies c where c.id = g.company_id)
      when 'user' then public.report_user_label(g.target_user_id)
      when 'team' then (select t.name from public.teams t where t.id = g.target_team_id) end, '') || ')'
  from public.goals g where g.id = p_goal;
$$;

-- Progresso da meta no período corrente (o que contém hoje em São Paulo; antes do início, o primeiro período).
-- actual conta só os registros visíveis a p_viewer. Reuniões seguem o funil por canal: agendadas = atividades em
-- leads, que não são reunião, com resultado books_meeting; realizadas = meeting_outcome 'held' com canal de origem,
-- ligadas a um lead (direto ou pelo negócio). Sempre só concluídas, sem legadas e sem apagadas, no completed_at.
create function public.goal_progress(p_goal uuid, p_viewer uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  g public.goals%rowtype;
  v_today date := (now() at time zone 'America/Sao_Paulo')::date;
  v_months int;
  v_n int;
  v_start date;
  v_end date;
  v_actual numeric;
begin
  select * into g from public.goals where id = p_goal;
  if not found then
    return null;
  end if;
  v_months := (extract(year from v_today)::int - extract(year from g.starts_on)::int) * 12
    + extract(month from v_today)::int - extract(month from g.starts_on)::int;
  case g.period
    when 'week' then
      v_n := greatest(0, floor((v_today - g.starts_on) / 7.0)::int);
      v_start := g.starts_on + 7 * v_n;
      v_end := v_start + 6;
    when 'month' then
      v_n := greatest(0, v_months);
      v_start := (g.starts_on + make_interval(months => v_n))::date;
      v_end := (v_start + interval '1 month')::date - 1;
    else
      v_n := greatest(0, floor(v_months / 3.0)::int);
      v_start := (g.starts_on + make_interval(months => 3 * v_n))::date;
      v_end := (v_start + interval '3 months')::date - 1;
  end case;

  if g.metric in ('meetings_booked', 'meetings_held', 'activities_done') then
    select count(*) into v_actual
    from public.activities a
    join public.report_preset_scope('activities', array[g.company_id], p_viewer, '[]'::jsonb) vis
      on vis.company_id = a.company_id and vis.owner_id = a.owner_id
    left join public.deals dl on dl.id = a.deal_id
    left join public.activity_types t on t.id = a.type_id
    left join public.activity_outcomes o on o.id = a.outcome_id
    where a.company_id = g.company_id and a.deleted_at is null and not a.legacy and a.done
      and public.report_in_period(a.completed_at, v_start, v_end)
      and public.goal_target_has(g.target_kind, g.target_user_id, g.target_team_id, a.owner_id)
      and case g.metric
        when 'meetings_booked' then a.lead_id is not null and not coalesce(t.is_meeting, false)
          and coalesce(o.books_meeting, false)
        when 'meetings_held' then a.meeting_outcome = 'held' and a.origin_channel_id is not null
          and coalesce(a.lead_id, dl.lead_id) is not null
        else true end;
  else
    select case g.metric
        when 'opportunities_created' then count(*)::numeric
        when 'won_value' then coalesce(sum(d.contract_value), 0)
        else coalesce(sum(d.mrr), 0) end
      into v_actual
    from public.deals d
    join public.report_preset_scope('deals', array[g.company_id], p_viewer, '[]'::jsonb) vis
      on vis.company_id = d.company_id and vis.owner_id = d.owner_id
    where d.company_id = g.company_id and d.deleted_at is null
      and public.goal_target_has(g.target_kind, g.target_user_id, g.target_team_id, d.owner_id)
      and case when g.metric = 'opportunities_created' then public.report_in_period(d.created_at, v_start, v_end)
        else d.status = 'won' and public.report_in_period(d.won_at, v_start, v_end) end;
  end if;

  return jsonb_build_object(
    'target', g.target_value,
    'actual', v_actual,
    'percent', round(100.0 * v_actual / g.target_value, 1),
    'period_start', to_char(v_start, 'YYYY-MM-DD'),
    'period_end', to_char(v_end, 'YYYY-MM-DD'));
end $$;

-- Metas das empresas pedidas com o progresso, viewer = auth.uid(). Exige acesso a todas as empresas.
create function public.goals_progress_self(p_companies uuid[]) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  c uuid;
begin
  if not public.current_user_active() then
    raise exception 'OXYN_FORBIDDEN';
  end if;
  foreach c in array coalesce(p_companies, '{}'::uuid[]) loop
    if c is null or not public.has_company_access(c) then
      raise exception 'OXYN_FORBIDDEN';
    end if;
  end loop;
  return coalesce((
    select jsonb_agg(x.o order by x.label, x.id)
    from (
      select g.id, public.report_goal_label(g.id) as label,
        jsonb_build_object('id', g.id, 'company_id', g.company_id, 'label', public.report_goal_label(g.id),
          'target_kind', g.target_kind, 'target_user_id', g.target_user_id, 'target_team_id', g.target_team_id,
          'metric', g.metric, 'period', g.period, 'starts_on', g.starts_on, 'target_value', g.target_value)
          || public.goal_progress(g.id, auth.uid()) as o
      from public.goals g
      where g.company_id = any (coalesce(p_companies, '{}'::uuid[]))) x), '[]'::jsonb);
end $$;

-- Preset goal_progress: metas das empresas com o progresso do período corrente (ignora o período da spec).
-- Filtro owner: só metas de usuário desses usuários. Filtro team: metas dessas equipes e metas de usuário de
-- membros delas. Metas de empresa saem quando há filtro owner ou team.
create function public.report_preset_goal_progress(p_params jsonb, p_companies uuid[], p_viewer uuid,
  p_from date, p_to date) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  with gl as (
    select g.id, public.report_goal_label(g.id) as label, public.goal_progress(g.id, p_viewer) as p
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
    order by 2, 1
    limit 501
  )
  select jsonb_build_object(
    'columns', jsonb_build_array(
      public.report_col('goal', 'Meta', 'text'),
      public.report_col('target', 'Alvo', 'number'),
      public.report_col('actual', 'Realizado', 'number'),
      public.report_col('percent', 'Progresso', 'percent'),
      public.report_col('period_start', 'Início do período', 'date'),
      public.report_col('period_end', 'Fim do período', 'date')),
    'rows', coalesce((select jsonb_agg(jsonb_build_array(gl.label, gl.p->'target', gl.p->'actual', gl.p->'percent',
        gl.p->'period_start', gl.p->'period_end') order by gl.label, gl.id) from gl), '[]'::jsonb),
    'total', null);
$$;

-- Validação: goal_progress entra na lista de presets (sem params; filtros company, owner e team).
-- create or replace sobre o corpo da 000004.
create or replace function public.report_preset_filters(p_kind text, p_params jsonb) returns text[]
language plpgsql immutable set search_path = public, pg_temp as $$
declare
  v_params jsonb := case when p_params is null or jsonb_typeof(p_params) = 'null' then '{}'::jsonb else p_params end;
begin
  if p_kind is null or p_kind not in ('channel_funnel', 'channel_success', 'conversion_influence', 'stage_conversion',
       'forecast', 'revenue_monthly', 'pipeline_overview', 'aging', 'activities_by_user', 'lost_reasons',
       'goal_progress') then
    return null;
  end if;
  if jsonb_typeof(v_params) <> 'object' then
    raise exception 'OXYN_INVALID_REPORT' using detail = 'params';
  end if;
  if p_kind = 'stage_conversion' then
    if exists (select 1 from jsonb_object_keys(v_params) x where x not in ('pipeline', 'group_by'))
       or not public.report_valid_scalar('uuid', v_params->'pipeline')
       or coalesce(jsonb_typeof(v_params->'group_by'), 'null') not in ('null', 'string')
       or coalesce(v_params->>'group_by', 'owner') not in ('owner', 'month') then
      raise exception 'OXYN_INVALID_REPORT' using detail = 'params';
    end if;
  elsif v_params <> '{}'::jsonb then
    raise exception 'OXYN_INVALID_REPORT' using detail = 'params';
  end if;
  return case when p_kind in ('channel_funnel', 'channel_success', 'conversion_influence', 'activities_by_user',
      'goal_progress')
    then array['company', 'owner', 'team'] else array['company', 'owner', 'team', 'pipeline'] end;
end $$;

-- Despacho: create or replace sobre o corpo da 000005, com goal_progress.
create or replace function public.run_report_preset(p_spec jsonb, p_companies uuid[], p_viewer uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_filters jsonb := case when jsonb_typeof(p_spec->'filters') = 'array' then p_spec->'filters' else '[]'::jsonb end;
  v_params jsonb;
  v_companies uuid[];
  v_from date := (p_spec#>>'{period,from}')::date;
  v_to date := (p_spec#>>'{period,to}')::date;
begin
  v_params := case when jsonb_typeof(p_spec->'params') = 'object' then p_spec->'params' else '{}'::jsonb end
    || jsonb_build_object('filters', v_filters);
  v_companies := array(select distinct c from unnest(coalesce(p_companies, '{}'::uuid[])) c
                       where c is not null and public.report_filter_ok(v_filters, 'company', c));
  case p_spec->>'kind'
    when 'channel_funnel' then
      return public.report_cap_rows(public.report_preset_channel_funnel(v_params, v_companies, p_viewer, v_from, v_to));
    when 'channel_success' then
      return public.report_cap_rows(public.report_preset_channel_success(v_params, v_companies, p_viewer, v_from, v_to));
    when 'conversion_influence' then
      return public.report_cap_rows(public.report_preset_conversion_influence(v_params, v_companies, p_viewer, v_from, v_to));
    when 'stage_conversion' then
      return public.report_cap_rows(public.report_preset_stage_conversion(v_params, v_companies, p_viewer, v_from, v_to));
    when 'forecast' then
      return public.report_cap_rows(public.report_preset_forecast(v_params, v_companies, p_viewer, v_from, v_to));
    when 'revenue_monthly' then
      return public.report_cap_rows(public.report_preset_revenue_monthly(v_params, v_companies, p_viewer, v_from, v_to));
    when 'pipeline_overview' then
      return public.report_cap_rows(public.report_preset_pipeline_overview(v_params, v_companies, p_viewer, v_from, v_to));
    when 'aging' then
      return public.report_cap_rows(public.report_preset_aging(v_params, v_companies, p_viewer, v_from, v_to));
    when 'activities_by_user' then
      return public.report_cap_rows(public.report_preset_activities_by_user(v_params, v_companies, p_viewer, v_from, v_to));
    when 'lost_reasons' then
      return public.report_cap_rows(public.report_preset_lost_reasons(v_params, v_companies, p_viewer, v_from, v_to));
    when 'goal_progress' then
      return public.report_cap_rows(public.report_preset_goal_progress(v_params, v_companies, p_viewer, v_from, v_to));
    else
      raise exception 'OXYN_INVALID_REPORT' using detail = 'kind';
  end case;
end $$;

-- Grants ----------------------------------------------------------------------------------------------------
-- Internas: só o dono das funções (chamadas pelas definer acima).
revoke execute on function public.restrict_filter_ids(jsonb), public.restrict_filters(jsonb, jsonb, uuid[]),
  public.run_widget_as(uuid, uuid, uuid[], jsonb), public.share_link_dashboard(text),
  public.goal_target_has(text, uuid, uuid, uuid), public.report_goal_label(uuid), public.goal_progress(uuid, uuid),
  public.report_preset_goal_progress(jsonb, uuid[], uuid, date, date)
  from public, anon, authenticated, service_role;
-- Variantes _for: como as da Task 1, só o service role além do dono.
revoke execute on function public.has_any_report_setting_for(uuid, text), public.report_companies_for(uuid)
  from public, anon, authenticated;
grant execute on function public.has_any_report_setting_for(uuid, text), public.report_companies_for(uuid)
  to service_role;
-- Cliente autenticado.
revoke execute on function public.run_widget(uuid, jsonb), public.create_share_link(uuid, timestamptz),
  public.revoke_share_link(uuid), public.goals_progress_self(uuid[]) from public, anon;
grant execute on function public.run_widget(uuid, jsonb), public.create_share_link(uuid, timestamptz),
  public.revoke_share_link(uuid), public.goals_progress_self(uuid[]) to authenticated;
-- Link público: só o service role (rota server-only).
revoke execute on function public.dashboard_public(text), public.run_widget_public(text, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.dashboard_public(text), public.run_widget_public(text, uuid, jsonb) to service_role;
