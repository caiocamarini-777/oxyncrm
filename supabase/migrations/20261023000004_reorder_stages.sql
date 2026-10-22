-- Reordena as etapas de um funil em um único UPDATE (atômico). Security invoker: RLS vale.
create function public.reorder_stages(p_pipeline uuid, p_stage_ids uuid[]) returns void
language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  v_company uuid;
  v_current uuid[];
begin
  select company_id into v_company from public.pipelines where id = p_pipeline;
  if v_company is null then
    raise exception 'OXYN_NOT_FOUND';
  end if;
  if not public.can_manage_pipelines(v_company) then
    raise exception 'OXYN_FORBIDDEN' using errcode = '42501';
  end if;
  select coalesce(array_agg(id order by id), '{}') into v_current
    from public.stages where pipeline_id = p_pipeline and archived_at is null;
  if cardinality(p_stage_ids) is distinct from cardinality(v_current)
     or (select coalesce(array_agg(x order by x), '{}') from unnest(p_stage_ids) x) is distinct from v_current then
    raise exception 'OXYN_STAGES_MISMATCH' using errcode = '22023';
  end if;
  update public.stages s set position = o.ord - 1
    from unnest(p_stage_ids) with ordinality o(id, ord)
    where s.id = o.id and s.pipeline_id = p_pipeline;
end $$;
revoke execute on function public.reorder_stages(uuid, uuid[]) from public, anon;
grant execute on function public.reorder_stages(uuid, uuid[]) to authenticated;
