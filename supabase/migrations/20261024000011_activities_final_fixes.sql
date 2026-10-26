-- Correções da revisão final da fase 4: conversão de lead migra atividades, métricas não forjáveis,
-- remarcação preserva atribuição, lixeira em cascata, reabertura idempotente, lembretes rearmados.

-- 1. guard_activity_links: conversão de lead e reunião remarcada ---------------------------------------
create or replace function public.guard_activity_links() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_src uuid;
  s public.activities;
  inherit boolean := false;
  converting boolean := false;
begin
  if auth.uid() is not null then
    if tg_op = 'INSERT' then
      begin
        v_src := nullif(current_setting('oxyn.chain_source', true), '')::uuid;
      exception when others then v_src := null;
      end;
      if v_src is not null then
        select * into s from public.activities where id = v_src;
        inherit := found;
      end if;
    else
      -- convert_lead move as atividades do lead para o negócio recém-criado
      converting := old.deal_id is null and new.lead_id is not null
        and coalesce(current_setting('oxyn.converting_lead', true), '') = new.lead_id::text;
    end if;
    if new.lead_id is not null and (tg_op = 'INSERT' or new.lead_id is distinct from old.lead_id)
       and not (inherit and new.lead_id is not distinct from s.lead_id)
       and not public.can_read_record('leads', new.lead_id) then
      raise exception 'OXYN_LINK_FORBIDDEN';
    end if;
    if new.deal_id is not null and (tg_op = 'INSERT' or new.deal_id is distinct from old.deal_id)
       and not (inherit and new.deal_id is not distinct from s.deal_id)
       and not converting
       and not public.can_read_record('deals', new.deal_id) then
      raise exception 'OXYN_LINK_FORBIDDEN';
    end if;
    if new.person_id is not null and (tg_op = 'INSERT' or new.person_id is distinct from old.person_id)
       and not (inherit and new.person_id is not distinct from s.person_id)
       and not public.can_read_record('persons', new.person_id) then
      raise exception 'OXYN_LINK_FORBIDDEN';
    end if;
    if new.organization_id is not null and (tg_op = 'INSERT' or new.organization_id is distinct from old.organization_id)
       and not (inherit and new.organization_id is not distinct from s.organization_id)
       and not public.can_read_record('organizations', new.organization_id) then
      raise exception 'OXYN_LINK_FORBIDDEN';
    end if;
    if new.booked_by_activity_id is not null
       and (tg_op = 'INSERT' or new.booked_by_activity_id is distinct from old.booked_by_activity_id)
       and not (inherit and (new.booked_by_activity_id = v_src
                             or new.booked_by_activity_id is not distinct from s.booked_by_activity_id))
       and not public.can_read_record('activities', new.booked_by_activity_id) then
      raise exception 'OXYN_LINK_FORBIDDEN';
    end if;
  end if;
  return new;
end $$;

-- 2/6. Trava de conclusão e campos de métrica ------------------------------------------------------------
create or replace function public.guard_activity_completion() returns trigger
language plpgsql set search_path = public, pg_temp as $$
declare
  allowed boolean := coalesce(current_setting('oxyn.completing', true), '') = new.id::text and pg_trigger_depth() = 1;
  -- só chain_insert_activity / chain_booked_meeting definem esta flag (o PostgREST não consegue)
  v_chain boolean := coalesce(current_setting('oxyn.chain_source', true), '') <> '';
  v_nested boolean := pg_trigger_depth() > 1; -- ação de FK (on delete set null), nunca um UPDATE direto
begin
  if auth.uid() is not null then
    if tg_op = 'INSERT' then
      if not allowed and (new.done or new.completed_at is not null or new.outcome_id is not null
                          or new.meeting_outcome is not null) then
        raise exception 'OXYN_FORBIDDEN_FIELD';
      end if;
      if (not v_chain and (new.booked_by_activity_id is not null or new.origin_channel_id is not null))
         or new.legacy or new.reminder_sent_at is not null then
        raise exception 'OXYN_FORBIDDEN_FIELD';
      end if;
    else
      if not allowed and (new.done is distinct from old.done or new.completed_at is distinct from old.completed_at
         or new.outcome_id is distinct from old.outcome_id or new.meeting_outcome is distinct from old.meeting_outcome) then
        raise exception 'OXYN_FORBIDDEN_FIELD';
      end if;
      if new.legacy is distinct from old.legacy
         or (new.booked_by_activity_id is distinct from old.booked_by_activity_id
             and not v_chain and not (v_nested and new.booked_by_activity_id is null))
         or (new.origin_channel_id is distinct from old.origin_channel_id
             and not v_chain and not (v_nested and new.origin_channel_id is null)) then
        raise exception 'OXYN_FORBIDDEN_FIELD';
      end if;
    end if;
  end if;
  if tg_op = 'UPDATE' then
    if old.done and (new.type_id is distinct from old.type_id or new.channel_id is distinct from old.channel_id) then
      raise exception 'OXYN_FORBIDDEN_FIELD';
    end if;
    if new.due_at is distinct from old.due_at or new.reminder_minutes is distinct from old.reminder_minutes
       or new.owner_id is distinct from old.owner_id or (old.done and not new.done) then
      new.reminder_sent_at := null;
    end if;
  end if;
  return new;
end $$;

-- 3/5. Insert encadeado: reunião remarcada herda a atribuição ------------------------------------------------
create or replace function public.chain_insert_activity(p_source uuid, p_kind text, p_data jsonb) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  a public.activities;
  v_owner uuid;
  v_type uuid;
  v_channel uuid;
  v_id uuid;
  v_src_meeting boolean;
  v_booked uuid;
  v_origin uuid;
begin
  -- Só dentro de complete_activity, que marca oxyn.completing com o id da atividade de origem.
  if coalesce(current_setting('oxyn.completing', true), '') <> p_source::text then
    raise exception 'OXYN_FORBIDDEN';
  end if;
  if not public.can_edit_record('activities', p_source) then
    raise exception 'OXYN_FORBIDDEN';
  end if;
  select * into a from public.activities where id = p_source;
  if not public.has_company_action(a.company_id, 'create') then
    raise exception 'OXYN_FORBIDDEN';
  end if;
  begin
    if p_kind = 'meeting' then
      v_owner := a.owner_id;
      select id into v_type from public.activity_types
        where company_id = a.company_id and is_meeting and active
          and (p_data->>'type_id' is null or id = (p_data->>'type_id')::uuid)
        order by position limit 1;
      if v_type is null then
        raise exception 'OXYN_MEETING_REQUIRED';
      end if;
      v_channel := a.channel_id;
      -- reunião remarcada (origem é reunião) mantém o agendamento original
      select coalesce(t.is_meeting, false) into v_src_meeting from public.activity_types t where t.id = a.type_id;
      if v_src_meeting then
        v_booked := a.booked_by_activity_id;
        v_origin := a.origin_channel_id;
      else
        v_booked := a.id;
        v_origin := a.channel_id;
      end if;
    else
      v_owner := coalesce((p_data->>'owner_id')::uuid, a.owner_id);
      if p_data->>'owner_id' is not null and v_owner is distinct from auth.uid()
         and not public.has_company_action(a.company_id, 'reassign_owner') then
        raise exception 'OXYN_FORBIDDEN';
      end if;
      if not exists (select 1 from public.activity_types
                     where id = (p_data->>'type_id')::uuid and company_id = a.company_id and active) then
        raise exception 'OXYN_INVALID_INPUT';
      end if;
      if not exists (select 1 from public.activity_channels
                     where id = (p_data->>'channel_id')::uuid and company_id = a.company_id and active) then
        raise exception 'OXYN_INVALID_INPUT';
      end if;
      v_type := (p_data->>'type_id')::uuid;
      v_channel := (p_data->>'channel_id')::uuid;
    end if;
    if not public.owner_has_membership(a.company_id, v_owner) then
      raise exception 'OXYN_OWNER_NOT_MEMBER';
    end if;
    perform set_config('oxyn.chain_source', p_source::text, true);
    insert into public.activities (company_id, owner_id, created_by, type_id, channel_id, subject, due_at,
      duration_minutes, reminder_minutes, lead_id, deal_id, person_id, organization_id,
      booked_by_activity_id, origin_channel_id)
    values (a.company_id, v_owner, auth.uid(), v_type, v_channel, p_data->>'subject',
      (p_data->>'due_at')::timestamptz, coalesce((p_data->>'duration_minutes')::int, 30),
      case when p_kind = 'meeting' then null else (p_data->>'reminder_minutes')::int end,
      a.lead_id, a.deal_id, a.person_id, a.organization_id, v_booked, v_origin)
    returning id into v_id;
    perform set_config('oxyn.chain_source', '', true);
  exception
    when invalid_text_representation or datetime_field_overflow or invalid_datetime_format
         or numeric_value_out_of_range or check_violation or string_data_right_truncation then
      perform set_config('oxyn.chain_source', '', true);
      raise exception 'OXYN_INVALID_INPUT';
  end;
  return v_id;
end $$;

-- 5. Reunião já agendada por esta atividade: reutiliza ou libera -------------------------------------------------
create function public.chain_booked_meeting(p_source uuid, p_release boolean default false) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid;
begin
  if coalesce(current_setting('oxyn.completing', true), '') <> p_source::text
     or not public.can_edit_record('activities', p_source) then
    raise exception 'OXYN_FORBIDDEN';
  end if;
  if p_release then
    perform set_config('oxyn.chain_source', p_source::text, true);
    update public.activities set booked_by_activity_id = null
     where booked_by_activity_id = p_source and deleted_at is null;
    perform set_config('oxyn.chain_source', '', true);
    return null;
  end if;
  select id into v_id from public.activities
   where booked_by_activity_id = p_source and deleted_at is null order by created_at, id limit 1;
  return v_id;
end $$;
revoke execute on function public.chain_booked_meeting(uuid, boolean) from public, anon;
grant execute on function public.chain_booked_meeting(uuid, boolean) to authenticated;

create or replace function public.complete_activity(
  p_id uuid,
  p_outcome_id uuid default null,
  p_meeting_outcome text default null,
  p_note text default null,
  p_meeting jsonb default null,
  p_next jsonb default null) returns jsonb
language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  a public.activities;
  v_meeting_type boolean;
  v_out public.activity_outcomes;
  v_outcome uuid;
  v_mo text;
  r record;
  v_meeting_id uuid;
  v_next_id uuid;
begin
  select * into a from public.activities where id = p_id and deleted_at is null for update;
  if not found or not public.can_edit_record('activities', p_id) then
    raise exception 'OXYN_NOT_FOUND';
  end if;
  if a.done then
    raise exception 'OXYN_ALREADY_DONE';
  end if;
  perform set_config('oxyn.completing', a.id::text, true);

  select is_meeting into v_meeting_type from public.activity_types where id = a.type_id;
  if v_meeting_type then
    if p_meeting_outcome is null or p_meeting_outcome not in ('held', 'no_show', 'rescheduled', 'canceled') then
      raise exception 'OXYN_OUTCOME_REQUIRED';
    end if;
    v_mo := p_meeting_outcome;
  else
    if p_meeting_outcome is not null then
      raise exception 'OXYN_OUTCOME_REQUIRED';
    end if;
    select * into v_out from public.activity_outcomes
      where id = p_outcome_id and company_id = a.company_id and active;
    if not found then
      raise exception 'OXYN_OUTCOME_REQUIRED';
    end if;
    v_outcome := v_out.id;
  end if;

  if v_out.books_meeting then
    if p_meeting is null or jsonb_typeof(p_meeting) <> 'object'
       or p_meeting->>'due_at' is null or p_meeting->>'subject' is null then
      raise exception 'OXYN_MEETING_REQUIRED';
    end if;
    -- reabrir e concluir de novo não duplica a reunião
    v_meeting_id := public.chain_booked_meeting(a.id);
    if v_meeting_id is null then
      v_meeting_id := public.chain_insert_activity(a.id, 'meeting', p_meeting);
    end if;
  else
    perform public.chain_booked_meeting(a.id, true);
    -- reunião remarcada: a nova reunião é opcional e herda a atribuição
    if v_meeting_type and v_mo = 'rescheduled' and p_meeting is not null then
      if jsonb_typeof(p_meeting) <> 'object' or p_meeting->>'due_at' is null or p_meeting->>'subject' is null then
        raise exception 'OXYN_MEETING_REQUIRED';
      end if;
      v_meeting_id := public.chain_insert_activity(a.id, 'meeting', p_meeting);
    end if;
  end if;

  if p_next is not null and (jsonb_typeof(p_next) <> 'object' or p_next->>'type_id' is null
     or p_next->>'channel_id' is null or p_next->>'subject' is null or p_next->>'due_at' is null) then
    raise exception 'OXYN_NEXT_ACTIVITY_REQUIRED';
  end if;
  select * into r from public.activity_next_rule(a.id);
  if p_next is null and r.rule = 'require' and r.ref_open and not r.has_open then
    raise exception 'OXYN_NEXT_ACTIVITY_REQUIRED';
  end if;
  if p_next is not null then
    v_next_id := public.chain_insert_activity(a.id, 'next', p_next);
  end if;

  update public.activities
     set done = true, completed_at = now(), outcome_id = v_outcome, meeting_outcome = v_mo,
         completion_note = nullif(btrim(p_note), '')
   where id = a.id;
  perform set_config('oxyn.completing', '', true);

  return jsonb_build_object('meeting_id', v_meeting_id, 'next_id', v_next_id, 'rule', r.rule);
end $$;

-- 1. convert_lead: as atividades do lead migram para o negócio ------------------------------------------------------
create or replace function public.convert_lead(p_lead uuid, p_pipeline uuid, p_stage uuid, p_title text default null)
returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  l public.leads%rowtype;
  v_deal uuid;
  v_position numeric;
begin
  if auth.uid() is null then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;
  -- leitura simples antes do lock: quem não pode editar o lead recebe o mesmo erro de "não existe"
  select * into l from public.leads where id = p_lead;
  if not found or not public.can_access(l.company_id, 'leads', l.owner_id, 'edit') then
    raise exception 'OXYN_NOT_FOUND';
  end if;
  if not public.can_access(l.company_id, 'deals', l.owner_id, 'create') then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;
  select * into l from public.leads where id = p_lead for update;
  if exists (select 1 from public.pipelines
             where id = p_pipeline and company_id = l.company_id and archived_at is not null) then
    raise exception 'OXYN_PIPELINE_ARCHIVED';
  end if;
  if l.deleted_at is not null or l.status <> 'open' then
    raise exception 'OXYN_INVALID_TRANSITION';
  end if;
  if not public.owner_has_membership(l.company_id, l.owner_id) then
    raise exception 'OXYN_OWNER_NOT_MEMBER';
  end if;

  -- entra no fim da etapa (negócios na lixeira não contam)
  select coalesce(max(position), 0) + 1024 into v_position
  from public.deals where stage_id = p_stage and company_id = l.company_id and deleted_at is null;

  insert into public.deals (company_id, owner_id, title, pipeline_id, stage_id, person_id, organization_id,
                            estimated_value, lead_id, position)
  values (l.company_id, l.owner_id, coalesce(nullif(btrim(p_title), ''), l.title), p_pipeline, p_stage,
          l.person_id, l.organization_id, l.estimated_value, l.id, v_position)
  returning id into v_deal;

  insert into public.record_labels (label_id, entity, record_id)
  select label_id, 'deals', v_deal from public.record_labels where entity = 'leads' and record_id = l.id;

  perform set_config('oxyn.converting', 'on', true);
  update public.leads set status = 'converted', converted_deal_id = v_deal, converted_at = now() where id = l.id;
  perform set_config('oxyn.converting', 'off', true);

  -- atividades (abertas e concluídas) migram para o negócio; o vínculo com o lead permanece
  perform set_config('oxyn.converting_lead', l.id::text, true);
  update public.activities set deal_id = v_deal where lead_id = l.id and deal_id is null and deleted_at is null;
  perform set_config('oxyn.converting_lead', '', true);

  insert into public.timeline_events (company_id, entity, record_id, kind, actor_id, data)
  values (l.company_id, 'leads', l.id, 'converted', auth.uid(), jsonb_build_object('deal_id', v_deal));
  return v_deal;
end $$;

-- 4. Lixeira do registro leva as atividades abertas junto -------------------------------------------------------------
create or replace function public.guard_record_update() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.company_id is distinct from old.company_id then
    raise exception 'OXYN_COMPANY_IMMUTABLE';
  end if;
  if auth.uid() is not null then
    if new.created_by is distinct from old.created_by or new.created_at is distinct from old.created_at then
      raise exception 'OXYN_FORBIDDEN_FIELD';
    end if;
    if new.owner_id is distinct from old.owner_id
       and not public.has_company_action(new.company_id, 'reassign_owner') then
      raise exception 'OXYN_REASSIGN_FORBIDDEN';
    end if;
    if new.deleted_at is distinct from old.deleted_at
       and not (tg_table_name = 'activities' and pg_trigger_depth() > 1
                and coalesce(current_setting('oxyn.cascade_trash', true), '') = 'on')
       and not public.has_company_action(new.company_id, 'delete') then
      raise exception 'OXYN_TRASH_FORBIDDEN';
    end if;
  end if;
  return new;
end $$;

create function public.cascade_parent_trash() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.deleted_at is not distinct from old.deleted_at then
    return null;
  end if;
  perform set_config('oxyn.cascade_trash', 'on', true);
  if old.deleted_at is null then
    -- só abertas, e só quando não resta outro vínculo vivo (este já aparece como excluído)
    update public.activities a set deleted_at = new.deleted_at
     where not a.done and a.deleted_at is null
       and case tg_table_name when 'leads' then a.lead_id when 'deals' then a.deal_id
                              when 'persons' then a.person_id else a.organization_id end = new.id
       and not (
         (a.lead_id is not null and exists (select 1 from public.leads x where x.id = a.lead_id and x.deleted_at is null))
         or (a.deal_id is not null and exists (select 1 from public.deals x where x.id = a.deal_id and x.deleted_at is null))
         or (a.person_id is not null and exists (select 1 from public.persons x where x.id = a.person_id and x.deleted_at is null))
         or (a.organization_id is not null and exists (select 1 from public.organizations x where x.id = a.organization_id and x.deleted_at is null)));
  elsif new.deleted_at is null then
    update public.activities a set deleted_at = null
     where a.deleted_at = old.deleted_at
       and case tg_table_name when 'leads' then a.lead_id when 'deals' then a.deal_id
                              when 'persons' then a.person_id else a.organization_id end = new.id;
  end if;
  perform set_config('oxyn.cascade_trash', '', true);
  return null;
end $$;
revoke execute on function public.cascade_parent_trash() from public, anon, authenticated;

create trigger cascade_parent_trash after update of deleted_at on public.leads
  for each row execute function public.cascade_parent_trash();
create trigger cascade_parent_trash after update of deleted_at on public.deals
  for each row execute function public.cascade_parent_trash();
create trigger cascade_parent_trash after update of deleted_at on public.persons
  for each row execute function public.cascade_parent_trash();
create trigger cascade_parent_trash after update of deleted_at on public.organizations
  for each row execute function public.cascade_parent_trash();

-- 7. RPCs sem uso ----------------------------------------------------------------------------------------------------
drop function if exists public.record_has_open_activity(text, uuid, uuid);
drop function if exists public.deals_with_overdue_activity(uuid);
