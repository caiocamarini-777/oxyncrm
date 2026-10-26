-- Correções da revisão da Task 3: regra de próxima atividade sem falha aberta, inserts encadeados,
-- flag de conclusão presa ao id, consultas inlináveis, validação de entrada e lembretes.

-- guard_activity_links: vínculos herdados da atividade de origem da cadeia não são rechecados --------
create or replace function public.guard_activity_links() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_src uuid;
  s public.activities;
  inherit boolean := false;
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
    end if;
    if new.lead_id is not null and (tg_op = 'INSERT' or new.lead_id is distinct from old.lead_id)
       and not (inherit and new.lead_id is not distinct from s.lead_id)
       and not public.can_read_record('leads', new.lead_id) then
      raise exception 'OXYN_LINK_FORBIDDEN';
    end if;
    if new.deal_id is not null and (tg_op = 'INSERT' or new.deal_id is distinct from old.deal_id)
       and not (inherit and new.deal_id is not distinct from s.deal_id)
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
       and not (inherit and new.booked_by_activity_id = v_src)
       and not public.can_read_record('activities', new.booked_by_activity_id) then
      raise exception 'OXYN_LINK_FORBIDDEN';
    end if;
  end if;
  return new;
end $$;

-- Trava de conclusão: a flag guarda o id da atividade e vale só no nível 1 ------------------------------
create or replace function public.guard_activity_completion() returns trigger
language plpgsql set search_path = public, pg_temp as $$
declare
  allowed boolean := coalesce(current_setting('oxyn.completing', true), '') = new.id::text and pg_trigger_depth() = 1;
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

-- Regra de próxima atividade (definer: a leitura do negócio/funil/empresa não depende da visibilidade) ----
create function public.activity_next_rule(p_activity uuid)
returns table (rule text, ref_entity text, ref_id uuid, ref_open boolean, has_open boolean)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  a public.activities;
  v_rule text := 'off';
  v_open boolean := false;
  v_entity text;
  v_id uuid;
begin
  if not public.can_edit_record('activities', p_activity) then
    raise exception 'OXYN_FORBIDDEN';
  end if;
  select * into a from public.activities where id = p_activity;
  if a.deal_id is not null then
    v_entity := 'deals'; v_id := a.deal_id;
    select coalesce(p.next_activity_rule, 'off'), d.status = 'open' and d.deleted_at is null
      into v_rule, v_open
    from public.deals d join public.pipelines p on p.id = d.pipeline_id where d.id = a.deal_id;
  elsif a.lead_id is not null then
    v_entity := 'leads'; v_id := a.lead_id;
    select coalesce((select c.settings->>'lead_next_activity_rule' from public.companies c where c.id = l.company_id), 'off'),
           l.status = 'open' and l.deleted_at is null
      into v_rule, v_open
    from public.leads l where l.id = a.lead_id;
  end if;
  v_rule := coalesce(v_rule, 'off');
  if v_rule not in ('off', 'suggest', 'require') then v_rule := 'off'; end if;
  return query select v_rule, v_entity, v_id, coalesce(v_open, false),
    case when v_id is null then false else exists (
      select 1 from public.activities o
      where o.deleted_at is null and not o.done and o.id <> p_activity
        and case v_entity when 'leads' then o.lead_id else o.deal_id end = v_id) end;
end $$;
revoke execute on function public.activity_next_rule(uuid) from public, anon;
grant execute on function public.activity_next_rule(uuid) to authenticated;

-- Insert encadeado (reunião ou próxima atividade) ---------------------------------------------------------
create function public.chain_insert_activity(p_source uuid, p_kind text, p_data jsonb) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  a public.activities;
  v_owner uuid;
  v_type uuid;
  v_channel uuid;
  v_id uuid;
begin
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
revoke execute on function public.chain_insert_activity(uuid, text, jsonb) from public, anon;
grant execute on function public.chain_insert_activity(uuid, text, jsonb) to authenticated;

-- complete_activity ------------------------------------------------------------------------------------
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

  perform set_config('oxyn.completing', a.id::text, true);
  update public.activities
     set done = true, completed_at = now(), outcome_id = v_outcome, meeting_outcome = v_mo,
         completion_note = nullif(btrim(p_note), '')
   where id = a.id;
  perform set_config('oxyn.completing', '', true);

  return jsonb_build_object('meeting_id', v_meeting_id, 'next_id', v_next_id, 'rule', r.rule);
end $$;

create or replace function public.reopen_activity(p_id uuid) returns void
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
  perform set_config('oxyn.completing', p_id::text, true);
  update public.activities
     set done = false, completed_at = null, outcome_id = null, meeting_outcome = null, completion_note = null
   where id = p_id;
  perform set_config('oxyn.completing', '', true);
end $$;

-- Lembretes: sem legado e só para donos ainda membros ----------------------------------------------------------
create or replace function public.generate_activity_reminders() returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare n int;
begin
  with due as (
    select a.id, a.owner_id, a.company_id, a.subject, a.due_at from public.activities a
    where not a.done and a.deleted_at is null and not a.legacy
      and a.reminder_minutes is not null and a.reminder_sent_at is null
      and a.due_at - make_interval(mins => a.reminder_minutes) <= now()
      and public.owner_has_membership(a.company_id, a.owner_id)
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

-- Consultas inlináveis (sem set search_path, nomes qualificados, um ramo por entidade) -------------------------------
create or replace function public.next_activity_for(p_entity text, p_ids uuid[])
returns table (record_id uuid, activity_id uuid, due_at timestamptz, subject text, overdue boolean)
language sql stable security invoker as $$
  select distinct on (x.rid) x.rid, x.aid, x.due, x.subj, x.due < pg_catalog.now()
  from (
    select r.rid, a.id as aid, a.due_at as due, a.subject as subj
    from pg_catalog.unnest(p_ids) as r(rid)
    join public.activities a on a.lead_id = r.rid
    where p_entity = 'leads' and a.deleted_at is null and not a.done
    union all
    select r.rid, a.id, a.due_at, a.subject
    from pg_catalog.unnest(p_ids) as r(rid)
    join public.activities a on a.deal_id = r.rid
    where p_entity = 'deals' and a.deleted_at is null and not a.done
  ) x
  order by x.rid, x.due, x.aid;
$$;

create or replace function public.deals_with_overdue_activity(p_company uuid) returns setof uuid
language sql stable security invoker as $$
  select distinct a.deal_id from public.activities a
  where a.company_id = p_company and a.deal_id is not null
    and a.deleted_at is null and not a.done and a.due_at < pg_catalog.now();
$$;
