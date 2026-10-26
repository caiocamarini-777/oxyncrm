-- Preset goal_progress devolve também a métrica da meta (coluna metric), para o front formatar moeda sem inferir pelo rótulo.
-- create or replace sobre o corpo da 000006; nada mais muda.
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
      public.report_col('period_end', 'Fim do período', 'date'),
      public.report_col('metric', 'Métrica', 'text')),
    'rows', coalesce((select jsonb_agg(jsonb_build_array(gl.label, gl.p->'target', gl.p->'actual', gl.p->'percent',
        gl.p->'period_start', gl.p->'period_end', gl.metric) order by gl.label, gl.id) from gl), '[]'::jsonb),
    'total', null);
$$;
