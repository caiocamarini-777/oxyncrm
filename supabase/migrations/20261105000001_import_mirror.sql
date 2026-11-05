-- Modo espelho da sincronização com o Pipedrive (até o desligamento do Pipedrive).
--
-- * import_jobs.mirror: o job roda como espelho. import_upsert liga oxyn.import_mirror (local à transação) e
--   import_state deixa de proteger registros editados no CRM: o Pipedrive sobrescreve, e o que estava na lixeira
--   do CRM volta.
-- * import_mirror_prune(job, limite, aplicar): depois de um job espelho concluído, manda para a lixeira o que o job
--   não viu (criado só no CRM, apagado no Pipedrive ou que saiu daquela empresa), nas empresas que o job tocou.
--   "Visto" = external_ids.job_id = job (created, updated e unchanged gravam o job). Se algum tipo passar do
--   limite (fração dos registros vivos), nada é apagado. Sem aplicar, só conta.

alter table public.import_jobs add column mirror boolean not null default false;

-- import_state (corpo de 20261026000003 + espelho)
create or replace function public.import_state(p_entity text, p_ext text, p_company uuid, out o_id uuid, out o_stale boolean)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_rua timestamptz;
  v_cur timestamptz;
  v_deleted timestamptz;
  v_mirror boolean := coalesce(current_setting('oxyn.import_mirror', true), '') = 'on';
begin
  o_stale := false;
  select record_id, record_updated_at into o_id, v_rua from public.external_ids
   where source = 'pipedrive' and entity = p_entity and external_id = p_ext and company_id = p_company;
  if o_id is null then
    return;
  end if;
  execute format('select updated_at from public.%I where id = $1 and company_id = $2', p_entity)
    into v_cur using o_id, p_company;
  if v_cur is null then
    delete from public.external_ids
     where source = 'pipedrive' and entity = p_entity and external_id = p_ext and company_id = p_company;
    o_id := null;
    return;
  end if;
  if v_mirror then
    -- espelho: o Pipedrive manda; o que foi para a lixeira no CRM volta
    if p_entity in ('organizations', 'persons', 'leads', 'deals', 'activities', 'notes') then
      execute format('select deleted_at from public.%I where id = $1', p_entity) into v_deleted using o_id;
      if v_deleted is not null then
        execute format('update public.%I set deleted_at = null where id = $1', p_entity) using o_id;
      end if;
    end if;
    return;
  end if;
  o_stale := v_cur is distinct from v_rua;
end $$;

-- import_upsert (corpo de 20261026000003 + espelho)
create or replace function public.import_upsert(p_job uuid, p_entity text, p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_row jsonb;
  v_res text;
  v_counts jsonb := '{"created": 0, "updated": 0, "skipped": 0, "unchanged": 0, "errors": 0}';
  v_detail text;
  v_mirror boolean;
begin
  select mirror into v_mirror from public.import_jobs where id = p_job and status = 'running';
  if not found then
    raise exception 'OXYN_IMPORT_NOT_RUNNING';
  end if;
  if p_entity is null or p_entity not in ('organizations', 'persons', 'leads', 'deals', 'activities', 'notes', 'products') then
    raise exception 'OXYN_IMPORT_INVALID_ENTITY';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'OXYN_IMPORT_INVALID_ROWS';
  end if;

  perform set_config('oxyn.importing', p_job::text, true);
  perform set_config('oxyn.import_mirror', case when v_mirror then 'on' else '' end, true);
  for v_row in select e from jsonb_array_elements(p_rows) e loop
    begin
      if jsonb_typeof(v_row) <> 'object' then
        raise exception 'OXYN_IMPORT_INVALID_ROW';
      end if;
      execute format('select public.%I($1, $2)', 'import_upsert_' || p_entity) into v_res using p_job, v_row;
      v_counts := jsonb_set(v_counts, array[v_res], to_jsonb((v_counts->>v_res)::int + 1));
    exception when others then
      get stacked diagnostics v_detail = pg_exception_detail;
      perform public.import_log_error(p_job, p_entity,
        case when jsonb_typeof(v_row) = 'object' then v_row->>'external_id' end,
        left(sqlerrm || coalesce(': ' || nullif(v_detail, ''), ''), 300));
      v_counts := jsonb_set(v_counts, '{errors}', to_jsonb((v_counts->>'errors')::int + 1));
    end;
  end loop;
  perform set_config('oxyn.import_mirror', '', true);
  perform set_config('oxyn.importing', '', true);
  return v_counts;
end $$;

-- Limpeza do espelho ------------------------------------------------------------------------------------------------
-- Devolve {counts: {entidade: {apagar, total}}, blocked: [entidades acima do limite], applied}.
-- Só aceita o job espelho concluído mais recente. p_max_ratio nulo = sem limite.
create function public.import_mirror_prune(p_job uuid, p_max_ratio numeric, p_apply boolean) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_created timestamptz;
  v_ent text;
  v_n int;
  v_live int;
  v_counts jsonb := '{}';
  v_blocked text[] := '{}';
  v_apply boolean;
begin
  select created_at into v_created from public.import_jobs
   where id = p_job and source = 'pipedrive' and status = 'done' and mirror;
  if not found then
    raise exception 'OXYN_IMPORT_NOT_MIRROR';
  end if;
  if exists (select 1 from public.import_jobs
              where source = 'pipedrive' and status in ('running', 'done') and created_at > v_created) then
    raise exception 'OXYN_IMPORT_STALE_JOB';
  end if;

  create temp table import_prune (entity text, id uuid) on commit drop;
  create temp table import_prune_companies on commit drop as
    select distinct company_id from public.external_ids where source = 'pipedrive' and job_id = p_job;

  -- filhos antes dos pais: a lixeira do pai leva junto as atividades abertas que só dependiam dele
  foreach v_ent in array array['notes', 'activities', 'deals', 'leads', 'persons', 'organizations'] loop
    execute format(
      'insert into import_prune
       select %L, t.id from public.%I t
        where t.deleted_at is null
          and t.company_id in (select company_id from import_prune_companies)
          and not exists (select 1 from public.external_ids x
                           where x.source = ''pipedrive'' and x.entity = %L and x.record_id = t.id and x.job_id = $1)',
      v_ent, v_ent, v_ent) using p_job;
    get diagnostics v_n = row_count;
    execute format('select count(*) from public.%I t
                     where t.deleted_at is null and t.company_id in (select company_id from import_prune_companies)', v_ent)
      into v_live;
    v_counts := v_counts || jsonb_build_object(v_ent, jsonb_build_object('apagar', v_n, 'total', v_live));
    if p_max_ratio is not null and v_n > p_max_ratio * v_live then
      v_blocked := v_blocked || v_ent;
    end if;
  end loop;

  v_apply := coalesce(p_apply, false) and cardinality(v_blocked) = 0;
  if v_apply then
    perform set_config('oxyn.importing', p_job::text, true);
    foreach v_ent in array array['notes', 'activities', 'deals', 'leads', 'persons', 'organizations'] loop
      execute format('update public.%I set deleted_at = now()
                       where deleted_at is null and id in (select id from import_prune where entity = %L)', v_ent, v_ent);
    end loop;
    perform set_config('oxyn.importing', '', true);
  end if;

  return jsonb_build_object('counts', v_counts, 'blocked', to_jsonb(v_blocked), 'applied', v_apply);
end $$;

revoke execute on function public.import_mirror_prune(uuid, numeric, boolean) from public, anon, authenticated;
grant execute on function public.import_mirror_prune(uuid, numeric, boolean) to service_role;
