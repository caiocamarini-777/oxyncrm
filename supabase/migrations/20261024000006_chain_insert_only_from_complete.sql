-- chain_insert_activity é exposta via RPC (complete_activity é invoker e precisa chamá-la):
-- sem esta trava, quem edita uma atividade poderia criar reunião com crédito de agendamento
-- sem concluir a origem. Agora só funciona dentro de complete_activity.

create or replace function public.chain_insert_activity(p_source uuid, p_kind text, p_data jsonb) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  a public.activities;
  v_owner uuid;
  v_type uuid;
  v_channel uuid;
  v_id uuid;
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
      a.lead_id, a.deal_id, a.person_id, a.organization_id,
      case when p_kind = 'meeting' then a.id end, case when p_kind = 'meeting' then a.channel_id end)
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
    v_meeting_id := public.chain_insert_activity(a.id, 'meeting', p_meeting);
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
