-- Previsão de receita mostra sempre o período salvo no relatório (no Pipedrive, o ano inteiro mês a mês): o
-- filtro rápido de período do painel não se aplica a ela. Usuário e funil do painel continuam valendo.
create or replace function public.insights_apply_overrides(p_company uuid, p_dtype text, p_rt text, p_filters jsonb, p_over jsonb)
returns jsonb
language plpgsql stable set search_path = public, pg_temp as $$
declare
  v_out jsonb := '[]'::jsonb;
  v_owner text := case when p_dtype in ('organizations', 'people') then 'ownerId' else 'userId' end;
  v_p jsonb := p_over->'period';
  v_users jsonb := p_over->'user_ids';
  v_pipe text := p_over->>'pipeline_id';
  f jsonb;
  v_t text;
begin
  for f in select x from jsonb_array_elements(coalesce(p_filters, '[]'::jsonb)) x loop
    if jsonb_typeof(v_users) = 'array' and jsonb_array_length(v_users) > 0 and f->>'filter' = v_owner then
      continue;
    end if;
    if v_pipe is not null and p_dtype = 'deals' and f->>'filter' = 'pipelineId' then
      continue;
    end if;
    if jsonb_typeof(v_p) = 'object' and f->>'period' is not null and p_rt is distinct from 'revenue_forecast' then
      select ftype into v_t from public.insights_field(p_company, p_dtype, p_rt, f->>'filter');
      if public.insights_is_date(v_t) then
        f := f || jsonb_build_object('period', v_p->>'period', 'operands',
          case when v_p->>'period' = 'custom' then jsonb_build_array(
            jsonb_build_object('name', 'isMoreThan', 'defaultValue', v_p->>'from'),
            jsonb_build_object('name', 'isLessThan', 'defaultValue', v_p->>'to')) else '[]'::jsonb end);
      end if;
    end if;
    v_out := v_out || jsonb_build_array(f);
  end loop;
  if jsonb_typeof(v_users) = 'array' and jsonb_array_length(v_users) > 0 then
    v_out := v_out || jsonb_build_array(jsonb_build_object('filter', v_owner, 'type', 'USER',
      'operands', jsonb_build_array(jsonb_build_object('name', 'isAnyOf', 'defaultValue', v_users)), 'period', null));
  end if;
  if v_pipe is not null and p_dtype = 'deals' then
    v_out := v_out || jsonb_build_array(jsonb_build_object('filter', 'pipelineId', 'type', 'ID',
      'operands', jsonb_build_array(jsonb_build_object('name', 'isExactly', 'defaultValue', v_pipe)), 'period', null));
  end if;
  return v_out;
end $$;
