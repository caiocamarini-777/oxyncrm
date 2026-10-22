-- Configurações de atividades: a empresa mantém ao menos um tipo reunião ativo e um
-- resultado que agenda reunião ativo; canal legado nunca é ativado; regra de leads válida.

create function public.guard_activity_type_meeting() returns trigger
language plpgsql set search_path = public as $$
begin
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

create trigger guard_activity_type_meeting before update or delete on public.activity_types
  for each row execute function public.guard_activity_type_meeting();

create function public.guard_activity_outcome_books() returns trigger
language plpgsql set search_path = public as $$
begin
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

create trigger guard_activity_outcome_books before update or delete on public.activity_outcomes
  for each row execute function public.guard_activity_outcome_books();

create function public.guard_activity_channel_legacy() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.is_legacy and new.active and (tg_op = 'INSERT' or not old.active) then
    raise exception 'OXYN_LEGACY_CHANNEL';
  end if;
  return new;
end $$;

create trigger guard_activity_channel_legacy before insert or update on public.activity_channels
  for each row execute function public.guard_activity_channel_legacy();

create function public.guard_company_settings() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.settings ? 'lead_next_activity_rule'
     and coalesce(new.settings->>'lead_next_activity_rule', '') not in ('off', 'suggest', 'require') then
    raise exception 'OXYN_INVALID_INPUT';
  end if;
  return new;
end $$;

create trigger guard_company_settings before insert or update of settings on public.companies
  for each row execute function public.guard_company_settings();

revoke execute on function public.guard_activity_type_meeting(), public.guard_activity_outcome_books(),
  public.guard_activity_channel_legacy(), public.guard_company_settings()
  from public, anon, authenticated;
