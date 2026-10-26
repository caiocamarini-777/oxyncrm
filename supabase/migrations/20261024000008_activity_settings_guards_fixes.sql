-- Correções dos guardas de configuração de atividades.

create or replace function public.guard_activity_type_meeting() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform pg_advisory_xact_lock(hashtext(old.company_id::text));
  -- Exclusão em cascata da empresa: a empresa já não existe.
  if not exists (select 1 from public.companies where id = old.company_id) then
    return coalesce(new, old);
  end if;
  if old.is_meeting and old.active
     and (tg_op = 'DELETE' or not new.active or not new.is_meeting)
     and not exists (
       select 1 from public.activity_types t
       where t.company_id = old.company_id and t.id <> old.id and t.is_meeting and t.active
     ) then
    raise exception 'OXYN_LAST_MEETING_TYPE';
  end if;
  return coalesce(new, old);
end $$;

create or replace function public.guard_activity_outcome_books() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform pg_advisory_xact_lock(hashtext(old.company_id::text));
  if not exists (select 1 from public.companies where id = old.company_id) then
    return coalesce(new, old);
  end if;
  if old.books_meeting and old.active
     and (tg_op = 'DELETE' or not new.active or not new.books_meeting)
     and not exists (
       select 1 from public.activity_outcomes o
       where o.company_id = old.company_id and o.id <> old.id and o.books_meeting and o.active
     ) then
    raise exception 'OXYN_LAST_BOOKING_OUTCOME';
  end if;
  return coalesce(new, old);
end $$;

create or replace function public.guard_activity_channel_legacy() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    if new.is_legacy and new.active then raise exception 'OXYN_LEGACY_CHANNEL'; end if;
    return new;
  end if;
  -- Linha legada nasce pelo seed (sem usuário); pessoas não a criam, renomeiam nem ativam.
  if auth.uid() is not null and (
       new.is_legacy is distinct from old.is_legacy
       or (old.is_legacy and new.name is distinct from old.name)
     ) then
    raise exception 'OXYN_LEGACY_CHANNEL';
  end if;
  if new.is_legacy and new.active and not (old.is_legacy and old.active) then
    raise exception 'OXYN_LEGACY_CHANNEL';
  end if;
  return new;
end $$;

create function public.set_lead_next_activity_rule(p_company uuid, p_rule text) returns void
language plpgsql set search_path = public, pg_temp as $$
declare n int;
begin
  if p_rule is null or p_rule not in ('off', 'suggest', 'require') then
    raise exception 'OXYN_INVALID_INPUT';
  end if;
  update public.companies
     set settings = coalesce(settings, '{}'::jsonb) || jsonb_build_object('lead_next_activity_rule', p_rule)
   where id = p_company;
  get diagnostics n = row_count;
  if n = 0 then raise exception 'OXYN_NOT_FOUND'; end if;
end $$;

revoke execute on function public.guard_activity_type_meeting(), public.guard_activity_outcome_books(),
  public.guard_activity_channel_legacy() from public, anon, authenticated;
revoke execute on function public.set_lead_next_activity_rule(uuid, text) from public, anon;
grant execute on function public.set_lead_next_activity_rule(uuid, text) to authenticated;
