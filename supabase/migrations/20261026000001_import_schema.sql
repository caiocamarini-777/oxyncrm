-- Fase 3.5: schema de importação (Pipedrive) e desvio sancionado dos triggers.
-- O desvio vale só para escritas do sistema (auth.uid() nulo) dentro de uma transação com oxyn.importing.

-- Tabelas --------------------------------------------------------------------------------------------
create table public.import_jobs (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('pipedrive')),
  status text not null default 'draft' check (status in ('draft','running','paused','done','failed')),
  mappings jsonb not null default '{}',
  cursor jsonb not null default '{}',
  counters jsonb not null default '{}',
  errors jsonb not null default '[]' check (jsonb_typeof(errors) = 'array'),
  created_by uuid references public.profiles default auth.uid(),
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);

create table public.external_ids (
  source text not null check (source in ('pipedrive')),
  entity text not null,
  external_id text not null,
  company_id uuid not null references public.companies on delete cascade,
  record_id uuid not null,
  job_id uuid references public.import_jobs on delete set null,
  imported_at timestamptz not null default now(),
  record_updated_at timestamptz,
  primary key (source, entity, external_id, company_id)
);
create index external_ids_entity_record_idx on public.external_ids (entity, record_id);
create index external_ids_job_idx on public.external_ids (job_id);

-- RLS ------------------------------------------------------------------------------------------------
alter table public.import_jobs enable row level security;
alter table public.external_ids enable row level security;

revoke all on public.import_jobs, public.external_ids from anon;
revoke truncate, references, trigger on public.import_jobs from authenticated;
-- external_ids: escrita só por funções definer (dono da tabela)
revoke insert, update, delete, truncate, references, trigger on public.external_ids from authenticated, service_role;

create policy import_jobs_select on public.import_jobs for select to authenticated using (public.is_super_admin());
create policy import_jobs_insert on public.import_jobs for insert to authenticated with check (public.is_super_admin());
create policy import_jobs_update on public.import_jobs for update to authenticated
  using (public.is_super_admin()) with check (public.is_super_admin());
create policy import_jobs_delete on public.import_jobs for delete to authenticated using (public.is_super_admin());

create policy external_ids_select on public.external_ids for select to authenticated using (public.is_super_admin());

-- Desvio sancionado ----------------------------------------------------------------------------------
-- Verdadeiro só para o sistema (sem usuário logado) com oxyn.importing preenchido na transação.
create function public.importing() returns boolean
language sql stable set search_path = public, pg_temp as $$
  select coalesce(current_setting('oxyn.importing', true), '') <> '' and auth.uid() is null
$$;
-- Sem revoke: os triggers sem definer (deals_*) rodam como o usuário e precisam chamá-la.

-- Erros do job: no máximo 1000 itens; todos contam em counters.<entidade>.errors ---------------------------
create function public.import_log_error(p_job uuid, p_entity text, p_external_id text, p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.import_jobs
     set errors = case when jsonb_array_length(errors) < 1000
                       then errors || jsonb_build_array(jsonb_build_object(
                              'entity', p_entity, 'external_id', p_external_id, 'reason', left(p_reason, 1000)))
                       else errors end,
         counters = jsonb_set(counters, array[p_entity],
           (case when jsonb_typeof(counters->p_entity) = 'object' then counters->p_entity else '{}'::jsonb end)
           || jsonb_build_object('errors', coalesce((counters->p_entity->>'errors')::int, 0) + 1))
   where id = p_job;
end $$;
revoke execute on function public.import_log_error(uuid, text, text, text) from public, anon, authenticated, service_role;

-- Negócios: etapa (corpo de 20261023000003 + desvio) -------------------------------------------------------
create or replace function public.deals_stage_entry() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if public.importing() then
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

-- Negócios: status (corpo de 20261023000003 + desvio) ------------------------------------------------------
create or replace function public.deals_status_fields() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if public.importing() then
    if new.status = 'won' then
      new.won_at := coalesce(new.won_at, now()); new.lost_at := null; new.lost_reason_id := null; new.lost_note := null;
    elsif new.status = 'lost' then
      new.lost_at := coalesce(new.lost_at, now()); new.won_at := null;
    else
      new.won_at := null; new.lost_at := null; new.lost_reason_id := null; new.lost_note := null;
    end if;
    return new;
  end if;
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then
    new.won_at := old.won_at; new.lost_at := old.lost_at;
    return new;
  end if;
  if new.status = 'won' then
    new.won_at := now(); new.lost_at := null; new.lost_reason_id := null; new.lost_note := null;
  elsif new.status = 'lost' then
    new.lost_at := now(); new.won_at := null;
  else
    new.won_at := null; new.lost_at := null; new.lost_reason_id := null; new.lost_note := null;
  end if;
  return new;
end $$;

-- Leads: importação aceita lead já convertido (corpo de 20261023000003 + desvio) -----------------------------
create or replace function public.guard_lead_status() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  converting boolean := coalesce(current_setting('oxyn.converting', true), '') = 'on';
begin
  if tg_op = 'INSERT' then
    if not converting and not public.importing() then
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
         or (old.status = 'open' and new.status = 'converted' and converting)) then
      raise exception 'OXYN_INVALID_TRANSITION';
    end if;
  end if;
  if (new.converted_deal_id is distinct from old.converted_deal_id
      or new.converted_at is distinct from old.converted_at) and not converting then
    -- única exceção: o FK zerando o vínculo quando o negócio foi apagado
    if not (new.converted_deal_id is null and old.converted_deal_id is not null
            and new.converted_at is not distinct from old.converted_at
            and not exists (select 1 from public.deals where id = old.converted_deal_id)) then
      raise exception 'OXYN_FORBIDDEN_FIELD';
    end if;
  end if;
  return new;
end $$;

-- Linha do tempo: importação não registra eventos ------------------------------------------------------------
-- timeline_record_changes (corpo de 20261023000003 + desvio): leads, negócios, pessoas, organizações
create or replace function public.timeline_record_changes() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  ent text := tg_table_name;
  n jsonb := to_jsonb(new);
  o jsonb;
  changed text[];
  skip text[] := array['updated_at', 'deleted_at', 'owner_id', 'search_text'];
begin
  if public.importing() then
    return new;
  end if;
  if tg_op = 'INSERT' then
    insert into public.timeline_events (company_id, entity, record_id, kind, actor_id)
    values (new.company_id, ent, new.id, 'created', auth.uid());
    return new;
  end if;

  o := to_jsonb(old);
  if new.owner_id is distinct from old.owner_id then
    insert into public.timeline_events (company_id, entity, record_id, kind, actor_id, data)
    values (new.company_id, ent, new.id, 'owner_changed', auth.uid(),
      jsonb_build_object('from', old.owner_id, 'to', new.owner_id));
  end if;
  if ent = 'leads' then
    skip := skip || array['converted_deal_id', 'converted_at'];
    if n->>'status' is distinct from o->>'status' then
      -- a conversão grava o próprio evento 'converted' em convert_lead
      if n->>'status' <> 'converted' then
        insert into public.timeline_events (company_id, entity, record_id, kind, actor_id, data)
        values (new.company_id, ent, new.id, 'status_changed', auth.uid(),
          jsonb_build_object('from', o->>'status', 'to', n->>'status', 'reason_id', n->'disqualification_reason_id'));
      end if;
      skip := skip || array['status', 'disqualification_reason_id'];
    end if;
  elsif ent = 'deals' then
    skip := skip || array['position', 'stage_entered_at', 'contract_value', 'won_at', 'lost_at'];
    if n->>'stage_id' is distinct from o->>'stage_id' then
      insert into public.timeline_events (company_id, entity, record_id, kind, actor_id, data)
      values (new.company_id, ent, new.id, 'stage_changed', auth.uid(),
        jsonb_build_object('from', o->>'stage_id', 'to', n->>'stage_id'));
      skip := skip || array['stage_id'];
    end if;
    if n->>'status' is distinct from o->>'status' then
      insert into public.timeline_events (company_id, entity, record_id, kind, actor_id, data)
      values (new.company_id, ent, new.id, 'status_changed', auth.uid(),
        jsonb_build_object('from', o->>'status', 'to', n->>'status', 'reason_id', n->'lost_reason_id'));
      skip := skip || array['status', 'lost_reason_id', 'lost_note'];
    end if;
    if coalesce(current_setting('oxyn.items_recalc', true), '') = 'on' then
      skip := skip || array['setup_total', 'mrr'];
    end if;
  end if;
  if new.deleted_at is distinct from old.deleted_at then
    insert into public.timeline_events (company_id, entity, record_id, kind, actor_id)
    values (new.company_id, ent, new.id, case when new.deleted_at is null then 'restored' else 'trashed' end, auth.uid());
  end if;

  select array_agg(k order by k) into changed
  from jsonb_object_keys(n) k
  where n->k is distinct from o->k and not (k = any (skip));
  if changed is not null then
    insert into public.timeline_events (company_id, entity, record_id, kind, actor_id, data)
    values (new.company_id, ent, new.id, 'updated', auth.uid(), jsonb_build_object('fields', to_jsonb(changed)));
  end if;
  return new;
end $$;

-- timeline_note_added (corpo de 20261022000003 + desvio)
create or replace function public.timeline_note_added() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if public.importing() then
    return new;
  end if;
  insert into public.timeline_events (company_id, entity, record_id, kind, actor_id, data)
  values (new.company_id, new.entity, new.record_id, 'note_added', auth.uid(), jsonb_build_object('note_id', new.id));
  return new;
end $$;

-- timeline_label_changed (corpo de 20261022000003 + desvio)
create or replace function public.timeline_label_changed() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r public.record_labels := case when tg_op = 'DELETE' then old else new end;
  l record;
begin
  if public.importing() then
    return r;
  end if;
  select company_id, name into l from public.labels where id = r.label_id;
  if l.company_id is null then
    return r; -- etiqueta removida em cascata
  end if;
  insert into public.timeline_events (company_id, entity, record_id, kind, actor_id, data)
  values (l.company_id, r.entity, r.record_id,
    case when tg_op = 'DELETE' then 'label_removed' else 'label_added' end, auth.uid(),
    jsonb_build_object('label_id', r.label_id, 'name', l.name));
  return r;
end $$;

-- timeline_activity_event (corpo de 20261024000004 + desvio): helper único de activities_timeline_*
create or replace function public.timeline_activity_event(p_kind text, p_act public.activities, p_data jsonb) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if public.importing() then
    return;
  end if;
  insert into public.timeline_events (company_id, entity, record_id, kind, actor_id, data)
  select p_act.company_id, l.entity, l.record_id, p_kind, auth.uid(), p_data
  from (values ('leads', p_act.lead_id), ('deals', p_act.deal_id),
               ('persons', p_act.person_id), ('organizations', p_act.organization_id)) as l(entity, record_id)
  where l.record_id is not null;
end $$;

-- generate_activity_reminders (20261024000012) já filtra "not a.legacy": sem mudança.
