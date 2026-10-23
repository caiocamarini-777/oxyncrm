-- Segurança de atividades: whitelists, guardas e policies RLS.

-- Whitelist de entidades ampliada para activities (corpos anteriores intactos) ---

create or replace function public.record_ref(p_entity text, p_record_id uuid)
returns table (company_id uuid, owner_id uuid, deleted_at timestamptz)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if p_entity not in ('leads','persons','organizations','deals','activities') then return; end if;
  return query execute format(
    'select t.company_id, t.owner_id, t.deleted_at from public.%I t where t.id = $1', p_entity)
    using p_record_id;
end $$;

create or replace function public.purge_records_internal(p_entity text, p_ids uuid[]) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare n int;
begin
  if p_entity not in ('leads', 'persons', 'organizations', 'deals', 'activities') then
    raise exception 'OXYN_INVALID_ENTITY';
  end if;
  if cardinality(p_ids) = 0 then return 0; end if;
  delete from public.record_labels where entity = p_entity and record_id = any (p_ids);
  delete from public.notes where entity = p_entity and record_id = any (p_ids);
  execute format('delete from public.%I where id = any ($1)', p_entity) using p_ids;
  get diagnostics n = row_count;
  delete from public.timeline_events where entity = p_entity and record_id = any (p_ids);
  return n;
end $$;

create or replace function public.purge_trash() returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  cutoff timestamptz := now() - interval '30 days';
  total int := 0;
  n int;
  ent text;
  ids uuid[];
begin
  foreach ent in array array['leads', 'persons', 'organizations', 'deals', 'activities'] loop
    execute format('select coalesce(array_agg(id), ''{}'') from public.%I where deleted_at < $1', ent) into ids using cutoff;
    total := total + public.purge_records_internal(ent, ids);
  end loop;
  delete from public.notes where deleted_at < cutoff;
  get diagnostics n = row_count;
  return total + n;
end $$;

create or replace function public.purge_record(p_entity text, p_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare trashed timestamptz; cnt bigint;
begin
  if not public.is_super_admin() then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;
  if p_entity not in ('leads', 'persons', 'organizations', 'deals', 'activities') then
    raise exception 'OXYN_INVALID_ENTITY';
  end if;
  execute format('select count(*), max(deleted_at) from public.%I where id = $1', p_entity)
    into cnt, trashed using p_id;
  if cnt = 0 then
    raise exception 'OXYN_NOT_FOUND';
  end if;
  if trashed is null then
    raise exception 'OXYN_TRASH_FORBIDDEN';
  end if;
  perform public.purge_records_internal(p_entity, array[p_id]);
end $$;

-- Vínculos: quem cria ou altera precisa conseguir ler cada registro vinculado -----

create function public.guard_activity_links() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is not null then
    if new.lead_id is not null and (tg_op = 'INSERT' or new.lead_id is distinct from old.lead_id)
       and not public.can_read_record('leads', new.lead_id) then
      raise exception 'OXYN_LINK_FORBIDDEN';
    end if;
    if new.deal_id is not null and (tg_op = 'INSERT' or new.deal_id is distinct from old.deal_id)
       and not public.can_read_record('deals', new.deal_id) then
      raise exception 'OXYN_LINK_FORBIDDEN';
    end if;
    if new.person_id is not null and (tg_op = 'INSERT' or new.person_id is distinct from old.person_id)
       and not public.can_read_record('persons', new.person_id) then
      raise exception 'OXYN_LINK_FORBIDDEN';
    end if;
    if new.organization_id is not null and (tg_op = 'INSERT' or new.organization_id is distinct from old.organization_id)
       and not public.can_read_record('organizations', new.organization_id) then
      raise exception 'OXYN_LINK_FORBIDDEN';
    end if;
  end if;
  return new;
end $$;
revoke execute on function public.guard_activity_links() from public, anon, authenticated;

-- Só read_at muda numa notificação (quando o chamador é um usuário).
create function public.guard_notification_update() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if auth.uid() is not null and (
       new.id is distinct from old.id or new.user_id is distinct from old.user_id
       or new.company_id is distinct from old.company_id or new.kind is distinct from old.kind
       or new.activity_id is distinct from old.activity_id or new.title is distinct from old.title
       or new.body is distinct from old.body or new.due_at is distinct from old.due_at
       or new.created_at is distinct from old.created_at
       or new.email_sent_at is distinct from old.email_sent_at) then
    raise exception 'OXYN_FORBIDDEN_FIELD';
  end if;
  return new;
end $$;
revoke execute on function public.guard_notification_update() from public, anon, authenticated;

create trigger guard_record_update before update on public.activities
  for each row execute function public.guard_record_update();
create trigger guard_activity_links before insert or update on public.activities
  for each row execute function public.guard_activity_links();
create trigger guard_notification_update before update on public.notifications
  for each row execute function public.guard_notification_update();
create trigger guard_company_immutable before update on public.activity_types
  for each row execute function public.guard_company_immutable();
create trigger guard_company_immutable before update on public.activity_channels
  for each row execute function public.guard_company_immutable();
create trigger guard_company_immutable before update on public.activity_outcomes
  for each row execute function public.guard_company_immutable();

-- Policies: activities (idênticas às de leads) ---------------------------------

create policy activities_select on public.activities for select to authenticated using (
  (deleted_at is null and public.can_access(company_id, 'activities', owner_id, 'read'))
  or (deleted_at is not null and public.can_access(company_id, 'activities', owner_id, 'delete')));
create policy activities_insert on public.activities for insert to authenticated with check (
  deleted_at is null
  and created_by = auth.uid()
  and public.can_access(company_id, 'activities', owner_id, 'create')
  and public.owner_has_membership(company_id, owner_id)
  and (owner_id = auth.uid() or public.can_access(company_id, 'activities', owner_id, 'reassign_owner')));
create policy activities_update on public.activities for update to authenticated using (
  (deleted_at is null and public.can_access(company_id, 'activities', owner_id, 'edit'))
  or (deleted_at is not null and public.can_access(company_id, 'activities', owner_id, 'delete')))
  with check (public.owner_has_membership(company_id, owner_id));
create policy activities_delete on public.activities for delete to authenticated using (public.is_super_admin());

-- Policies: catálogos por empresa ----------------------------------------------

do $$
declare t text;
begin
  foreach t in array array['activity_types','activity_channels','activity_outcomes'] loop
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

-- Policies: notificações (select e update só nas próprias; escrita por security definer) --

create policy notifications_select on public.notifications for select to authenticated
  using (user_id = auth.uid());
create policy notifications_update on public.notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke insert, delete on public.notifications from authenticated;
