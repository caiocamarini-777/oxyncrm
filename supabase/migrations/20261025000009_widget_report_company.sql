-- Fase 6, correção da Task 7: um widget de relatório salvo respeita a empresa do relatório.
-- run_widget_as (corpo da 000008, só muda o trecho da empresa): quando o relatório tem company_id, as empresas
-- permitidas são cruzadas com [company_id]. Se o viewer não tem essa empresa, o resultado fica vazio.
-- Relatório sem empresa (company_id nulo) e widget com spec própria continuam usando todas as empresas permitidas.

create or replace function public.run_widget_as(p_widget uuid, p_viewer uuid, p_companies uuid[], p_filters jsonb)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_spec jsonb;
  v_report_company uuid;
  v_allowed uuid[] := p_companies;
  v_r record;
  v_result jsonb;
begin
  select coalesce(r.spec, w.spec), r.company_id into v_spec, v_report_company
  from public.dashboard_widgets w
  left join public.reports r on r.id = w.report_id
  where w.id = p_widget;
  if v_spec is null then
    raise exception 'OXYN_FORBIDDEN';
  end if;
  if v_report_company is not null then
    v_allowed := array(select c from unnest(coalesce(p_companies, '{}'::uuid[])) c where c = v_report_company);
  end if;
  -- spec do usuário, com o limite de filtros
  perform public.validate_report_spec(v_spec);
  select * into v_r from public.restrict_filters(v_spec, p_filters, v_allowed);
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
