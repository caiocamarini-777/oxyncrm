-- Segunda rodada da revisão final: lembretes rearmados geram nova notificação, reunião solta perde o
-- crédito de canal, reminder_sent_at protegido.

-- 1. A chave única passa a incluir o destinatário (troca de dono gera nova notificação) -----------------
alter table public.notifications drop constraint notifications_activity_id_kind_due_at_key;
alter table public.notifications add constraint notifications_activity_kind_due_user_key
  unique (activity_id, kind, due_at, user_id);

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
    on conflict (activity_id, kind, due_at, user_id) do nothing
    returning 1
  ), mark as (
    update public.activities set reminder_sent_at = now() where id in (select id from due) returning 1
  )
  select (select count(*) from ins)::int into n from mark right join (select 1) x on true;
  return coalesce(n, 0);
end $$;

-- Reabrir apaga os lembretes antigos da atividade (notificações não são apagáveis pelo usuário) ----------
create function public.clear_activity_reminders(p_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if coalesce(current_setting('oxyn.completing', true), '') <> p_id::text
     or not public.can_edit_record('activities', p_id) then
    raise exception 'OXYN_FORBIDDEN';
  end if;
  delete from public.notifications where activity_id = p_id and kind = 'activity_reminder';
end $$;
revoke execute on function public.clear_activity_reminders(uuid) from public, anon;
grant execute on function public.clear_activity_reminders(uuid) to authenticated;

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
  perform public.clear_activity_reminders(p_id);
  update public.activities
     set done = false, completed_at = null, outcome_id = null, meeting_outcome = null, completion_note = null
   where id = p_id;
  perform set_config('oxyn.completing', '', true);
end $$;

-- 2. Reunião solta perde também o canal de origem ---------------------------------------------------------------
create or replace function public.chain_booked_meeting(p_source uuid, p_release boolean default false) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid;
begin
  if coalesce(current_setting('oxyn.completing', true), '') <> p_source::text
     or not public.can_edit_record('activities', p_source) then
    raise exception 'OXYN_FORBIDDEN';
  end if;
  if p_release then
    perform set_config('oxyn.chain_source', p_source::text, true);
    update public.activities set booked_by_activity_id = null, origin_channel_id = null
     where booked_by_activity_id = p_source and deleted_at is null;
    perform set_config('oxyn.chain_source', '', true);
    return null;
  end if;
  select id into v_id from public.activities
   where booked_by_activity_id = p_source and deleted_at is null order by created_at, id limit 1;
  return v_id;
end $$;

-- 3. reminder_sent_at: só o sistema muda (comparado antes dos resets do próprio gatilho) ----------------------------
create or replace function public.guard_activity_completion() returns trigger
language plpgsql set search_path = public, pg_temp as $$
declare
  allowed boolean := coalesce(current_setting('oxyn.completing', true), '') = new.id::text and pg_trigger_depth() = 1;
  v_chain boolean := coalesce(current_setting('oxyn.chain_source', true), '') <> '';
  v_nested boolean := pg_trigger_depth() > 1;
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
         or new.reminder_sent_at is distinct from old.reminder_sent_at
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
