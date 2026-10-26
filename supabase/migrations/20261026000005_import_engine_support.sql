-- Fase 3.5, task 4: apoio ao motor de importação (só service_role).
-- * import_upsert devolve created/updated/skipped/unchanged mas não os soma no job: import_count soma de forma
--   atômica, sem sobrescrever errors/warnings que o banco já contou.
-- * import_log_error é interno: import_log_items registra em lote os erros e avisos ("aviso:") dos mapeadores.

create function public.import_count(p_job uuid, p_entity text, p_counts jsonb) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_entity is null or p_entity = '' or p_counts is null or jsonb_typeof(p_counts) <> 'object' then
    raise exception 'OXYN_IMPORT_INVALID_ROWS';
  end if;
  update public.import_jobs j
     set counters = jsonb_set(j.counters, array[p_entity],
           (case when jsonb_typeof(j.counters->p_entity) = 'object' then j.counters->p_entity else '{}'::jsonb end)
           || coalesce((
             select jsonb_object_agg(k, coalesce((j.counters->p_entity->>k)::int, 0) + (p_counts->>k)::int)
               from unnest(array['created', 'updated', 'skipped', 'unchanged']) k
              where p_counts ? k), '{}'::jsonb))
   where j.id = p_job;
end $$;

-- p_items: [{entity, external_id, reason}]; motivo com prefixo "aviso:" vai para warnings.
create function public.import_log_items(p_job uuid, p_items jsonb) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v jsonb;
  n int := 0;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'OXYN_IMPORT_INVALID_ROWS';
  end if;
  for v in select e from jsonb_array_elements(p_items) e loop
    if jsonb_typeof(v) = 'object' then
      perform public.import_log_error(p_job, v->>'entity', v->>'external_id', coalesce(v->>'reason', 'sem motivo'));
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;

revoke execute on function public.import_count(uuid, text, jsonb), public.import_log_items(uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.import_count(uuid, text, jsonb), public.import_log_items(uuid, jsonb)
  to service_role;
