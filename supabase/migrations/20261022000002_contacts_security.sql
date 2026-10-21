-- Segurança de contatos e leads: helpers, guardas e policies RLS.

-- Helpers ------------------------------------------------------------------

create function public.record_ref(p_entity text, p_record_id uuid)
returns table (company_id uuid, owner_id uuid, deleted_at timestamptz)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if p_entity not in ('leads','persons','organizations') then return; end if;
  return query execute format(
    'select t.company_id, t.owner_id, t.deleted_at from public.%I t where t.id = $1', p_entity)
    using p_record_id;
end $$;

create function public.can_read_record(p_entity text, p_record_id uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((
    select r.deleted_at is null and public.can_access(r.company_id, p_entity, r.owner_id, 'read')
    from public.record_ref(p_entity, p_record_id) r), false);
$$;

create function public.can_edit_record(p_entity text, p_record_id uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((
    select r.deleted_at is null and public.can_access(r.company_id, p_entity, r.owner_id, 'edit')
    from public.record_ref(p_entity, p_record_id) r), false);
$$;

create function public.owner_has_membership(p_company uuid, p_owner uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select (auth.uid() is null or public.has_company_access(p_company)) and exists (
    select 1 from public.profiles p
    where p.id = p_owner and p.active
      and (p.is_super_admin
           or exists (select 1 from public.memberships m
                      where m.user_id = p.id and m.company_id = p_company)));
$$;

create function public.can_manage_company_lists(p_company uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select public.current_user_active() and (
    public.is_super_admin()
    or coalesce(public.role_permissions(p_company)->'settings'->>'manage_custom_fields', 'false') = 'true');
$$;

-- Permissão de ação independente de visibilidade (usada pelos guards).
create function public.has_company_action(p_company uuid, p_action text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select public.current_user_active() and (
    public.is_super_admin()
    or coalesce(public.role_permissions(p_company)->'actions'->>p_action, 'false') = 'true');
$$;

create function public.validate_custom_fields(p_company uuid, p_entity text, p_values jsonb) returns void
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  k text;
  v jsonb;
  d record;
  ok boolean;
  e jsonb;
begin
  if auth.uid() is not null and not public.has_company_access(p_company) then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;
  if p_values is null or jsonb_typeof(p_values) <> 'object' then
    raise exception 'OXYN_INVALID_CUSTOM_FIELD' using detail = '';
  end if;
  for k, v in select * from jsonb_each(p_values) loop
    select * into d from public.custom_field_defs
      where company_id = p_company and entity = p_entity and key = k;
    if not found then
      raise exception 'OXYN_INVALID_CUSTOM_FIELD' using detail = k;
    end if;
    if jsonb_typeof(v) = 'null' then continue; end if;
    ok := false;
    case d.type
      when 'text' then
        ok := jsonb_typeof(v) = 'string' and char_length(v #>> '{}') <= 2000;
      when 'number', 'money' then
        ok := jsonb_typeof(v) = 'number';
      when 'date' then
        if jsonb_typeof(v) = 'string' and (v #>> '{}') ~ '^\d{4}-\d{2}-\d{2}$' then
          begin
            ok := to_char(((v #>> '{}')::date), 'YYYY-MM-DD') = (v #>> '{}');
          exception when others then ok := false;
          end;
        end if;
      when 'select' then
        ok := jsonb_typeof(v) = 'string' and d.options @> v;
      when 'multiselect' then
        ok := jsonb_typeof(v) = 'array';
        if ok then
          for e in select * from jsonb_array_elements(v) loop
            if jsonb_typeof(e) <> 'string' or not (d.options @> e) then ok := false; exit; end if;
          end loop;
        end if;
      when 'user' then
        if jsonb_typeof(v) = 'string' then
          begin
            ok := public.owner_has_membership(p_company, (v #>> '{}')::uuid);
          exception when others then ok := false;
          end;
        end if;
    end case;
    if not ok then
      raise exception 'OXYN_INVALID_CUSTOM_FIELD' using detail = k;
    end if;
  end loop;
end $$;

create function public.reassign_record(p_entity text, p_id uuid, p_owner uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r record;
begin
  select * into r from public.record_ref(p_entity, p_id);
  if not found or r.deleted_at is not null
     or not public.can_access(r.company_id, p_entity, r.owner_id, 'edit')
     or not public.has_company_action(r.company_id, 'reassign_owner') then
    raise exception 'OXYN_REASSIGN_FORBIDDEN';
  end if;
  if not public.owner_has_membership(r.company_id, p_owner) then
    raise exception 'OXYN_OWNER_NOT_MEMBER';
  end if;
  execute format('update public.%I set owner_id = $1 where id = $2', p_entity) using p_owner, p_id;
end $$;

revoke execute on function public.reassign_record(text, uuid, uuid) from public, anon;
grant execute on function public.reassign_record(text, uuid, uuid) to authenticated;

-- Triggers -----------------------------------------------------------------

create function public.guard_record_update() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.company_id is distinct from old.company_id then
    raise exception 'OXYN_COMPANY_IMMUTABLE';
  end if;
  if auth.uid() is not null then
    if new.owner_id is distinct from old.owner_id
       and not public.has_company_action(new.company_id, 'reassign_owner') then
      raise exception 'OXYN_REASSIGN_FORBIDDEN';
    end if;
    if new.deleted_at is distinct from old.deleted_at
       and not public.has_company_action(new.company_id, 'delete') then
      raise exception 'OXYN_TRASH_FORBIDDEN';
    end if;
  end if;
  return new;
end $$;

create function public.guard_company_immutable() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if new.company_id is distinct from old.company_id then
    raise exception 'OXYN_COMPANY_IMMUTABLE';
  end if;
  return new;
end $$;

create function public.validate_custom_fields_trg() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' or new.custom_fields is distinct from old.custom_fields then
    perform public.validate_custom_fields(new.company_id, tg_table_name, new.custom_fields);
  end if;
  return new;
end $$;

create trigger guard_record_update before update on public.organizations
  for each row execute function public.guard_record_update();
create trigger guard_record_update before update on public.persons
  for each row execute function public.guard_record_update();
create trigger guard_record_update before update on public.leads
  for each row execute function public.guard_record_update();

create trigger validate_custom_fields_trg before insert or update on public.organizations
  for each row execute function public.validate_custom_fields_trg();
create trigger validate_custom_fields_trg before insert or update on public.persons
  for each row execute function public.validate_custom_fields_trg();
create trigger validate_custom_fields_trg before insert or update on public.leads
  for each row execute function public.validate_custom_fields_trg();

create trigger guard_company_immutable before update on public.lead_sources
  for each row execute function public.guard_company_immutable();
create trigger guard_company_immutable before update on public.disqualification_reasons
  for each row execute function public.guard_company_immutable();
create trigger guard_company_immutable before update on public.labels
  for each row execute function public.guard_company_immutable();
create trigger guard_company_immutable before update on public.custom_field_defs
  for each row execute function public.guard_company_immutable();
create trigger guard_company_immutable before update on public.notes
  for each row execute function public.guard_company_immutable();

-- Execute ------------------------------------------------------------------

revoke execute on function public.record_ref(text, uuid) from authenticated;
revoke execute on function
  public.record_ref(text, uuid), public.can_read_record(text, uuid), public.can_edit_record(text, uuid),
  public.owner_has_membership(uuid, uuid), public.can_manage_company_lists(uuid),
  public.has_company_action(uuid, text), public.validate_custom_fields(uuid, text, jsonb)
  from public, anon;
grant execute on function
  public.can_read_record(text, uuid), public.can_edit_record(text, uuid),
  public.owner_has_membership(uuid, uuid), public.can_manage_company_lists(uuid),
  public.has_company_action(uuid, text), public.validate_custom_fields(uuid, text, jsonb)
  to authenticated;
revoke execute on function
  public.guard_record_update(), public.guard_company_immutable(), public.validate_custom_fields_trg()
  from public, anon, authenticated;

-- Policies: organizations, persons, leads ---------------------------------

do $$
declare t text;
begin
  foreach t in array array['organizations','persons','leads'] loop
    execute format($f$
      create policy %1$s_select on public.%1$s for select to authenticated using (
        (deleted_at is null and public.can_access(company_id, %1$L, owner_id, 'read'))
        or (deleted_at is not null and public.can_access(company_id, %1$L, owner_id, 'delete')))$f$, t);
    execute format($f$
      create policy %1$s_insert on public.%1$s for insert to authenticated with check (
        deleted_at is null
        and created_by = auth.uid()
        and public.can_access(company_id, %1$L, owner_id, 'create')
        and public.owner_has_membership(company_id, owner_id)
        and (owner_id = auth.uid() or public.can_access(company_id, %1$L, owner_id, 'reassign_owner')))$f$, t);
    execute format($f$
      create policy %1$s_update on public.%1$s for update to authenticated using (
        (deleted_at is null and public.can_access(company_id, %1$L, owner_id, 'edit'))
        or (deleted_at is not null and public.can_access(company_id, %1$L, owner_id, 'delete')))
        with check (public.owner_has_membership(company_id, owner_id))$f$, t);
    execute format($f$
      create policy %1$s_delete on public.%1$s for delete to authenticated using (public.is_super_admin())$f$, t);
  end loop;
end $$;

-- Policies: tabelas de apoio -----------------------------------------------

do $$
declare t text;
begin
  foreach t in array array['lead_sources','disqualification_reasons','labels','custom_field_defs'] loop
    execute format($f$create policy %1$s_select on public.%1$s for select to authenticated
      using (public.has_company_access(company_id))$f$, t);
    execute format($f$create policy %1$s_insert on public.%1$s for insert to authenticated
      with check (public.can_manage_company_lists(company_id))$f$, t);
    execute format($f$create policy %1$s_update on public.%1$s for update to authenticated
      using (public.can_manage_company_lists(company_id))
      with check (public.can_manage_company_lists(company_id))$f$, t);
    execute format($f$create policy %1$s_delete on public.%1$s for delete to authenticated
      using (public.can_manage_company_lists(company_id))$f$, t);
  end loop;
end $$;

create policy record_labels_select on public.record_labels for select to authenticated
  using (public.can_read_record(entity, record_id));
create policy record_labels_insert on public.record_labels for insert to authenticated
  with check (public.can_edit_record(entity, record_id) and created_by = auth.uid());
create policy record_labels_delete on public.record_labels for delete to authenticated
  using (public.can_edit_record(entity, record_id));

create policy notes_select on public.notes for select to authenticated
  using ((deleted_at is null or created_by = auth.uid() or public.is_super_admin())
    and public.can_read_record(entity, record_id));
create policy notes_insert on public.notes for insert to authenticated
  with check (public.can_read_record(entity, record_id) and created_by = auth.uid());
create policy notes_update on public.notes for update to authenticated
  using (created_by = auth.uid() or public.is_super_admin())
  with check ((created_by = auth.uid() or public.is_super_admin())
    and public.can_read_record(entity, record_id));

create policy timeline_events_select on public.timeline_events for select to authenticated
  using (public.can_read_record(entity, record_id));

-- Timeline só é escrita por triggers security definer.
revoke insert, update, delete on public.timeline_events from authenticated;
