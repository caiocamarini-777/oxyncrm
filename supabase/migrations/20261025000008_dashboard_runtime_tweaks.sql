-- Fase 6, ajustes antes da revisão da Task 5.
-- 1. Widgets devolvem o gráfico efetivo: run_widget_as (corpo da 000007, único ponto por onde passam run_widget e
--    run_widget_public) acrescenta "chart" à saída. Quem recebe um dashboard compartilhado não lê reports, então
--    o gráfico precisa vir no resultado. Preset sem chart na spec devolve null (a tela usa o padrão do preset).
-- 2. create_share_link devolve {id, token} em vez do token solto (o tipo de retorno muda: drop e create).
-- 3. update_widget_layout: reordena e redimensiona vários widgets em um único update, security invoker (RLS manda).

create or replace function public.run_widget_as(p_widget uuid, p_viewer uuid, p_companies uuid[], p_filters jsonb)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_spec jsonb;
  v_r record;
  v_result jsonb;
begin
  select coalesce(r.spec, w.spec) into v_spec
  from public.dashboard_widgets w
  left join public.reports r on r.id = w.report_id
  where w.id = p_widget;
  if v_spec is null then
    raise exception 'OXYN_FORBIDDEN';
  end if;
  -- spec do usuário, com o limite de filtros
  perform public.validate_report_spec(v_spec);
  select * into v_r from public.restrict_filters(v_spec, p_filters, p_companies);
  -- spec restringida (período recortado) com os filtros originais; os acrescentados ficam fora do limite
  perform public.validate_report_spec(jsonb_set(v_r.spec, '{filters}',
    coalesce(nullif(v_spec->'filters', 'null'::jsonb), '[]'::jsonb)));
  if v_r.spec->>'kind' = 'custom' then
    v_result := public.run_report_custom(v_r.spec, v_r.companies, p_viewer);
  else
    v_result := public.run_report_preset(v_r.spec, v_r.companies, p_viewer);
  end if;
  return v_result || jsonb_build_object('chart', v_spec->'chart');
end $$;

drop function public.create_share_link(uuid, timestamptz);
create function public.create_share_link(p_dashboard uuid, p_expires_at timestamptz) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_owner uuid;
  v_token text;
  v_id uuid;
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
  values (p_dashboard, encode(extensions.digest(v_token, 'sha256'), 'hex'), auth.uid(), p_expires_at)
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'token', v_token);
end $$;
revoke execute on function public.create_share_link(uuid, timestamptz) from public, anon;
grant execute on function public.create_share_link(uuid, timestamptz) to authenticated;

create function public.update_widget_layout(p_dashboard uuid, p_items jsonb) returns void
language plpgsql volatile security invoker set search_path = public, pg_temp as $$
declare
  e jsonb;
  v_n int;
begin
  if p_dashboard is null or jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) > 100 then
    raise exception 'OXYN_INVALID_INPUT';
  end if;
  for e in select x from jsonb_array_elements(p_items) x loop
    if jsonb_typeof(e) <> 'object'
       or exists (select 1 from jsonb_object_keys(e) k where k not in ('id', 'position', 'col_span', 'row_span'))
       or jsonb_typeof(e->'id') is distinct from 'string'
       or (e->>'id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       or jsonb_typeof(e->'position') is distinct from 'number' or (e->>'position') !~ '^\d{1,9}$'
       or jsonb_typeof(e->'col_span') is distinct from 'number' or (e->>'col_span') !~ '^[1-4]$'
       or jsonb_typeof(e->'row_span') is distinct from 'number' or (e->>'row_span') !~ '^[1-3]$' then
      raise exception 'OXYN_INVALID_INPUT';
    end if;
  end loop;
  if (select count(distinct x->>'id') from jsonb_array_elements(p_items) x) <> jsonb_array_length(p_items) then
    raise exception 'OXYN_INVALID_INPUT';
  end if;
  update public.dashboard_widgets w
  set position = x."position", col_span = x.col_span, row_span = x.row_span
  from jsonb_to_recordset(p_items) as x(id uuid, "position" int, col_span int, row_span int)
  where w.id = x.id and w.dashboard_id = p_dashboard;
  get diagnostics v_n = row_count;
  -- id de outro dashboard, inexistente ou sem permissão de escrita (RLS): nada é gravado
  if v_n <> jsonb_array_length(p_items) then
    raise exception 'OXYN_INVALID_INPUT';
  end if;
end $$;
revoke execute on function public.update_widget_layout(uuid, jsonb) from public, anon;
grant execute on function public.update_widget_layout(uuid, jsonb) to authenticated;
