-- Conclusão, cadeia de reunião, próxima atividade, linha do tempo, lembretes e consultas por registro.

-- Linha do tempo -----------------------------------------------------------------

create function public.timeline_activity_event(p_kind text, p_act public.activities, p_data jsonb) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.timeline_events (company_id, entity, record_id, kind, actor_id, data)
  select p_act.company_id, l.entity, l.record_id, p_kind, auth.uid(), p_data
  from (values ('leads', p_act.lead_id), ('deals', p_act.deal_id),
               ('persons', p_act.person_id), ('organizations', p_act.organization_id)) as l(entity, record_id)
  where l.record_id is not null;
end $$;

create function public.timeline_activity_scheduled() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.timeline_activity_event('activity_scheduled', new, jsonb_build_object(
    'activity_id', new.id,
    'type', (select name from public.activity_types where id = new.type_id),
    'due_at', new.due_at));
  return new;
end $$;

create function public.timeline_activity_completed() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare o record;
begin
  select name, classification into o from public.activity_outcomes where id = new.outcome_id;
  perform public.timeline_activity_event('activity_completed', new, jsonb_build_object(
    'activity_id', new.id,
    'outcome', o.name,
    'classification', o.classification,
    'meeting_outcome', new.meeting_outcome));
  return new;
end $$;

create trigger activities_timeline_scheduled after insert on public.activities
  for each row execute function public.timeline_activity_scheduled();
create trigger activities_timeline_completed after update on public.activities
  for each row when (new.done and not old.done) execute function public.timeline_activity_completed();

-- Trava de conclusão direta e reinício do lembrete ------------------------------------
-- Só complete_activity / reopen_activity (flag oxyn.completing) mudam a conclusão de uma atividade.

create function public.guard_activity_completion() returns trigger
language plpgsql set search_path = public, pg_temp as $$
declare
  allowed boolean := coalesce(current_setting('oxyn.completing', true), '') = 'on' and pg_trigger_depth() >= 1;
begin
  if auth.uid() is not null and not allowed then
    if tg_op = 'INSERT' then
      if new.done or new.completed_at is not null or new.outcome_id is not null or new.meeting_outcome is not null then
        raise exception 'OXYN_FORBIDDEN_FIELD';
      end if;
    elsif new.done is distinct from old.done or new.completed_at is distinct from old.completed_at
       or new.outcome_id is distinct from old.outcome_id or new.meeting_outcome is distinct from old.meeting_outcome then
      raise exception 'OXYN_FORBIDDEN_FIELD';
    end if;
  end if;
  if tg_op = 'UPDATE' then
    if old.done and new.type_id is distinct from old.type_id then
      raise exception 'OXYN_FORBIDDEN_FIELD';
    end if;
    if new.due_at is distinct from old.due_at or new.reminder_minutes is distinct from old.reminder_minutes then
      new.reminder_sent_at := null;
    end if;
  end if;
  return new;
end $$;
create trigger guard_activity_completion before insert or update on public.activities
  for each row execute function public.guard_activity_completion();
revoke execute on function public.guard_activity_completion(), public.timeline_activity_event(text, public.activities, jsonb),
  public.timeline_activity_scheduled(), public.timeline_activity_completed() from public, anon, authenticated;

-- Existe outra atividade aberta para o registro? (conta as que o chamador não enxerga) -----

create function public.record_has_open_activity(p_entity text, p_id uuid, p_except uuid default null) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select public.can_read_record(p_entity, p_id) and exists (
    select 1 from public.activities a
    where a.deleted_at is null and not a.done and a.id is distinct from p_except
      and case p_entity when 'leads' then a.lead_id when 'deals' then a.deal_id end = p_id);
$$;
revoke execute on function public.record_has_open_activity(text, uuid, uuid) from public, anon;
grant execute on function public.record_has_open_activity(text, uuid, uuid) to authenticated;

-- Concluir ----------------------------------------------------------------------------

create function public.complete_activity(
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
  v_rule text := 'off';
  v_ref_entity text;
  v_ref_id uuid;
  v_ref_open boolean := false;
  v_meeting_id uuid;
  v_next_id uuid;
  v_mtype uuid;
begin
  select * into a from public.activities where id = p_id and deleted_at is null for update;
  if not found or not public.can_edit_record('activities', p_id) then
    raise exception 'OXYN_NOT_FOUND';
  end if;
  if a.done then
    raise exception 'OXYN_ALREADY_DONE';
  end if;

  -- 1. resultado
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

  -- 2. cadeia: o resultado agenda uma reunião
  if v_out.books_meeting then
    if p_meeting is null or p_meeting->>'due_at' is null or p_meeting->>'subject' is null
       or coalesce(p_meeting->>'duration_minutes', '30') !~ '^[0-9]+$' then
      raise exception 'OXYN_MEETING_REQUIRED';
    end if;
    select id into v_mtype from public.activity_types
      where company_id = a.company_id and is_meeting and active
        and (p_meeting->>'type_id' is null or id = (p_meeting->>'type_id')::uuid)
      order by position limit 1;
    if v_mtype is null then
      raise exception 'OXYN_MEETING_REQUIRED';
    end if;
    insert into public.activities (company_id, owner_id, type_id, channel_id, subject, due_at, duration_minutes,
      lead_id, deal_id, person_id, organization_id, booked_by_activity_id, origin_channel_id)
    values (a.company_id, a.owner_id, v_mtype, a.channel_id, p_meeting->>'subject', (p_meeting->>'due_at')::timestamptz,
      coalesce((p_meeting->>'duration_minutes')::int, 30),
      a.lead_id, a.deal_id, a.person_id, a.organization_id, a.id, a.channel_id)
    returning id into v_meeting_id;
  end if;

  -- 3. regra de próxima atividade
  if a.deal_id is not null then
    v_ref_entity := 'deals'; v_ref_id := a.deal_id;
    select coalesce(p.next_activity_rule, 'off'), d.status = 'open' and d.deleted_at is null
      into v_rule, v_ref_open
    from public.deals d join public.pipelines p on p.id = d.pipeline_id where d.id = a.deal_id;
  elsif a.lead_id is not null then
    v_ref_entity := 'leads'; v_ref_id := a.lead_id;
    select coalesce((select c.settings->>'lead_next_activity_rule' from public.companies c where c.id = l.company_id), 'off'),
           l.status = 'open' and l.deleted_at is null
      into v_rule, v_ref_open
    from public.leads l where l.id = a.lead_id;
  end if;
  v_rule := coalesce(v_rule, 'off');
  if v_rule not in ('off', 'suggest', 'require') then v_rule := 'off'; end if;
  v_ref_open := coalesce(v_ref_open, false);

  if p_next is not null and (p_next->>'type_id' is null or p_next->>'channel_id' is null
     or p_next->>'subject' is null or p_next->>'due_at' is null) then
    raise exception 'OXYN_NEXT_ACTIVITY_REQUIRED';
  end if;
  if p_next is null and v_rule = 'require' and v_ref_open
     and not public.record_has_open_activity(v_ref_entity, v_ref_id, a.id) then
    raise exception 'OXYN_NEXT_ACTIVITY_REQUIRED';
  end if;
  if p_next is not null then
    insert into public.activities (company_id, owner_id, type_id, channel_id, subject, due_at, duration_minutes,
      reminder_minutes, lead_id, deal_id, person_id, organization_id)
    values (a.company_id, a.owner_id, (p_next->>'type_id')::uuid, (p_next->>'channel_id')::uuid,
      p_next->>'subject', (p_next->>'due_at')::timestamptz, coalesce((p_next->>'duration_minutes')::int, 30),
      (p_next->>'reminder_minutes')::int, a.lead_id, a.deal_id, a.person_id, a.organization_id)
    returning id into v_next_id;
  end if;

  -- 4. conclui
  perform set_config('oxyn.completing', 'on', true);
  update public.activities
     set done = true, completed_at = now(), outcome_id = v_outcome, meeting_outcome = v_mo,
         completion_note = nullif(btrim(p_note), '')
   where id = a.id;
  perform set_config('oxyn.completing', 'off', true);

  return jsonb_build_object('meeting_id', v_meeting_id, 'next_id', v_next_id, 'rule', v_rule);
end $$;
revoke execute on function public.complete_activity(uuid, uuid, text, text, jsonb, jsonb) from public, anon;
grant execute on function public.complete_activity(uuid, uuid, text, text, jsonb, jsonb) to authenticated;

-- Reabrir -----------------------------------------------------------------------------------

create function public.reopen_activity(p_id uuid) returns void
language plpgsql security invoker set search_path = public, pg_temp as $$
declare a public.activities;
begin
  select * into a from public.activities where id = p_id and deleted_at is null for update;
  if not found or not public.can_edit_record('activities', p_id) then
    raise exception 'OXYN_NOT_FOUND';
  end if;
  if not a.done then
    raise exception 'OXYN_NOT_DONE';
  end if;
  perform set_config('oxyn.completing', 'on', true);
  update public.activities
     set done = false, completed_at = null, outcome_id = null, meeting_outcome = null, completion_note = null
   where id = p_id;
  perform set_config('oxyn.completing', 'off', true);
end $$;
revoke execute on function public.reopen_activity(uuid) from public, anon;
grant execute on function public.reopen_activity(uuid) to authenticated;

-- Lembretes -----------------------------------------------------------------------------------

create function public.generate_activity_reminders() returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare n int;
begin
  with due as (
    select a.id, a.owner_id, a.company_id, a.subject, a.due_at from public.activities a
    where not a.done and a.deleted_at is null and a.reminder_minutes is not null and a.reminder_sent_at is null
      and a.due_at - make_interval(mins => a.reminder_minutes) <= now()
    for update of a skip locked
  ), ins as (
    insert into public.notifications (user_id, company_id, kind, activity_id, title, due_at)
    select owner_id, company_id, 'activity_reminder', id, 'Lembrete: ' || subject, due_at from due
    on conflict (activity_id, kind, due_at) do nothing
    returning 1
  ), mark as (
    update public.activities set reminder_sent_at = now() where id in (select id from due) returning 1
  )
  select (select count(*) from ins)::int into n from mark right join (select 1) x on true;
  return coalesce(n, 0);
end $$;
revoke execute on function public.generate_activity_reminders() from public, anon, authenticated, service_role;

do $$
begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'oxyn-activity-reminders';
  perform cron.schedule('oxyn-activity-reminders', '* * * * *', 'select public.generate_activity_reminders()');
end $$;

-- Consultas por registro --------------------------------------------------------------------------

create function public.next_activity_for(p_entity text, p_ids uuid[])
returns table (record_id uuid, activity_id uuid, due_at timestamptz, subject text, overdue boolean)
language sql stable security invoker set search_path = public, pg_temp as $$
  select distinct on (r.rid) r.rid, a.id, a.due_at, a.subject, a.due_at < now()
  from unnest(p_ids) as r(rid)
  join public.activities a
    on (p_entity = 'leads' and a.lead_id = r.rid) or (p_entity = 'deals' and a.deal_id = r.rid)
  where a.deleted_at is null and not a.done
  order by r.rid, a.due_at, a.id;
$$;
revoke execute on function public.next_activity_for(text, uuid[]) from public, anon;
grant execute on function public.next_activity_for(text, uuid[]) to authenticated;

create function public.deals_with_overdue_activity(p_company uuid) returns setof uuid
language sql stable security invoker set search_path = public, pg_temp as $$
  select distinct a.deal_id from public.activities a
  where a.company_id = p_company and a.deal_id is not null
    and a.deleted_at is null and not a.done and a.due_at < now();
$$;
revoke execute on function public.deals_with_overdue_activity(uuid) from public, anon;
grant execute on function public.deals_with_overdue_activity(uuid) to authenticated;
