-- Fase 3.5, correções do desvio de importação (revisão da task 1).

-- 1. importing(): o GUC precisa ser o id de um import_jobs em 'running' ------------------------------------
-- Definer para ler import_jobs sem depender do RLS de quem escreve. Continua executável por authenticated,
-- porque deals_stage_entry e deals_status_fields não são definer e a chamam como o usuário (retorna falso).
create or replace function public.importing() returns boolean
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v text := coalesce(current_setting('oxyn.importing', true), '');
begin
  if v = '' or auth.uid() is not null then
    return false;
  end if;
  if v !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  return exists (select 1 from public.import_jobs where id = v::uuid and status = 'running');
end $$;
revoke execute on function public.importing() from public, anon;
grant execute on function public.importing() to authenticated, service_role;

-- 2. import_log_error: entidade nula vira 'unknown' ---------------------------------------------------------
create or replace function public.import_log_error(p_job uuid, p_entity text, p_external_id text, p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_entity text := coalesce(p_entity, 'unknown');
begin
  update public.import_jobs
     set errors = case when jsonb_array_length(errors) < 1000
                       then errors || jsonb_build_array(jsonb_build_object(
                              'entity', v_entity, 'external_id', p_external_id, 'reason', left(p_reason, 1000)))
                       else errors end,
         counters = jsonb_set(counters, array[v_entity],
           (case when jsonb_typeof(counters->v_entity) = 'object' then counters->v_entity else '{}'::jsonb end)
           || jsonb_build_object('errors', coalesce((counters->v_entity->>'errors')::int, 0) + 1))
   where id = p_job;
end $$;

-- 3. deals_stage_history (corpo de 20261023000003 + desvio): a reconstrução da importação grava o histórico --
create or replace function public.deals_stage_history() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if public.importing() then
    return null;
  end if;
  if tg_op = 'INSERT' then
    insert into public.deal_stage_history (deal_id, company_id, from_stage_id, to_stage_id, moved_by)
    values (new.id, new.company_id, null, new.stage_id, auth.uid());
  elsif new.stage_id is distinct from old.stage_id then
    insert into public.deal_stage_history (deal_id, company_id, from_stage_id, to_stage_id, moved_by, seconds_in_previous)
    values (new.id, new.company_id, old.stage_id, new.stage_id, auth.uid(),
      floor(extract(epoch from (new.stage_entered_at - old.stage_entered_at)))::int);
  end if;
  return null;
end $$;

-- 4. deals_required_fields (corpo de 20261023000003 + desvio após as checagens de arquivamento) -------------
create or replace function public.deals_required_fields() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  req text[];
  k text;
  ok boolean;
  missing text[] := '{}';
  v_archived boolean;
begin
  if tg_op = 'UPDATE' and new.stage_id is not distinct from old.stage_id then
    return new;
  end if;
  -- funil arquivado não recebe negócios (criação ou troca de funil)
  if (tg_op = 'INSERT' or new.pipeline_id is distinct from old.pipeline_id)
     and exists (select 1 from public.pipelines
                 where id = new.pipeline_id and company_id = new.company_id and archived_at is not null) then
    raise exception 'OXYN_PIPELINE_ARCHIVED';
  end if;
  -- etapa de outra empresa/funil: não lê os requisitos; guard_same_company levanta OXYN_CROSS_COMPANY
  select required_fields, archived_at is not null into req, v_archived from public.stages
    where id = new.stage_id and company_id = new.company_id and pipeline_id = new.pipeline_id;
  if not found then
    return new;
  end if;
  if v_archived then
    raise exception 'OXYN_STAGE_ARCHIVED';
  end if;
  -- a importação traz o negócio como está na origem; campos obrigatórios da etapa não se aplicam
  if public.importing() then
    return new;
  end if;
  if req is null or cardinality(req) = 0 then
    return new;
  end if;
  foreach k in array req loop
    if k = 'expected_close_date' then
      ok := new.expected_close_date is not null;
    elsif k = 'person_id' then
      ok := new.person_id is not null;
    elsif k = 'organization_id' then
      ok := new.organization_id is not null;
    elsif k = 'estimated_value' then
      ok := new.estimated_value is not null;
    elsif k = 'contract' then
      ok := (new.setup_total > 0 and new.setup_first_due is not null)
         or (new.mrr > 0 and new.mrr_start is not null and new.contract_months is not null);
    elsif k = 'products' then
      ok := tg_op = 'UPDATE' and exists (select 1 from public.deal_items where deal_id = new.id);
    elsif k like 'cf:%' then
      if not exists (select 1 from public.custom_field_defs
                     where company_id = new.company_id and entity = 'deals'
                       and key = substr(k, 4) and archived_at is null) then
        ok := true; -- campo arquivado (ou removido) não bloqueia
      else
        ok := coalesce(btrim(new.custom_fields ->> substr(k, 4)), '') not in ('', '[]');
      end if;
    else
      ok := true;
    end if;
    if not ok then
      missing := missing || k;
    end if;
  end loop;
  if cardinality(missing) > 0 then
    raise exception 'OXYN_REQUIRED_FIELDS' using detail = array_to_string(missing, ',');
  end if;
  return new;
end $$;

-- 5. guard_lead_status (corpo de 20261026000001): a importação também converte no UPDATE ------------------
create or replace function public.guard_lead_status() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  converting boolean := coalesce(current_setting('oxyn.converting', true), '') = 'on';
  v_importing boolean := public.importing();
begin
  if tg_op = 'INSERT' then
    if not converting and not v_importing then
      if new.status = 'converted' then
        raise exception 'OXYN_INVALID_TRANSITION';
      end if;
      if new.converted_deal_id is not null or new.converted_at is not null then
        raise exception 'OXYN_FORBIDDEN_FIELD';
      end if;
    end if;
    return new;
  end if;
  if new.status is distinct from old.status then
    if not ((old.status = 'open' and new.status in ('disqualified', 'archived'))
         or (old.status = 'disqualified' and new.status = 'archived')
         or (old.status in ('disqualified', 'archived') and new.status = 'open')
         or (old.status = 'open' and new.status = 'converted' and converting)
         -- importação: lead aberto ou arquivado na origem que virou negócio
         or (old.status in ('open', 'archived') and new.status = 'converted' and v_importing)) then
      raise exception 'OXYN_INVALID_TRANSITION';
    end if;
  end if;
  if (new.converted_deal_id is distinct from old.converted_deal_id
      or new.converted_at is distinct from old.converted_at) and not converting and not v_importing then
    -- única exceção: o FK zerando o vínculo quando o negócio foi apagado
    if not (new.converted_deal_id is null and old.converted_deal_id is not null
            and new.converted_at is not distinct from old.converted_at
            and not exists (select 1 from public.deals where id = old.converted_deal_id)) then
      raise exception 'OXYN_FORBIDDEN_FIELD';
    end if;
  end if;
  return new;
end $$;

-- 6. deals_stage_entry (corpo de 20261026000001, só comentário novo) -----------------------------------------
create or replace function public.deals_stage_entry() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if public.importing() then
    -- Importação: a data de entrada na etapa vem da origem e é aceita como chega, no INSERT e no UPDATE
    -- (inclusive sem troca de etapa, para a ressincronização corrigir a data). Só sem valor informado
    -- é que o trigger preenche: created_at/now() no INSERT, clock_timestamp() na troca de etapa.
    if tg_op = 'INSERT' then
      new.stage_entered_at := coalesce(new.stage_entered_at, new.created_at, now());
    elsif new.stage_id is distinct from old.stage_id
          and new.stage_entered_at is not distinct from old.stage_entered_at then
      new.stage_entered_at := clock_timestamp();
    end if;
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.stage_entered_at := now();
  elsif new.stage_id is distinct from old.stage_id then
    new.stage_entered_at := clock_timestamp();
  else
    new.stage_entered_at := old.stage_entered_at;
  end if;
  return new;
end $$;
