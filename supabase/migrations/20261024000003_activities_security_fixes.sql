-- Correções da revisão de segurança de atividades.

-- 1. Purga de registros que são o único vínculo de atividades --------------------
-- Os FKs de vínculo são on delete set null, mas o CHECK exige ao menos um vínculo:
-- atividades que ficariam sem vínculo são purgadas junto com o registro.
create or replace function public.purge_records_internal(p_entity text, p_ids uuid[]) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare n int; orphan uuid[];
begin
  if p_entity not in ('leads', 'persons', 'organizations', 'deals', 'activities') then
    raise exception 'OXYN_INVALID_ENTITY';
  end if;
  if cardinality(p_ids) = 0 then return 0; end if;
  if p_entity <> 'activities' then
    select coalesce(array_agg(a.id), '{}') into orphan from public.activities a
    where case p_entity
            when 'leads' then a.lead_id = any (p_ids)
            when 'deals' then a.deal_id = any (p_ids)
            when 'persons' then a.person_id = any (p_ids)
            else a.organization_id = any (p_ids) end
      and (p_entity = 'leads' or a.lead_id is null)
      and (p_entity = 'deals' or a.deal_id is null)
      and (p_entity = 'persons' or a.person_id is null)
      and (p_entity = 'organizations' or a.organization_id is null);
    if cardinality(orphan) > 0 then
      perform public.purge_records_internal('activities', orphan);
    end if;
  end if;
  delete from public.record_labels where entity = p_entity and record_id = any (p_ids);
  delete from public.notes where entity = p_entity and record_id = any (p_ids);
  execute format('delete from public.%I where id = any ($1)', p_entity) using p_ids;
  get diagnostics n = row_count;
  delete from public.timeline_events where entity = p_entity and record_id = any (p_ids);
  return n;
end $$;

-- 2. booked_by_activity_id também precisa ser legível; 3. guarda de notificações ----
create or replace function public.guard_activity_links() returns trigger
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
    if new.booked_by_activity_id is not null
       and (tg_op = 'INSERT' or new.booked_by_activity_id is distinct from old.booked_by_activity_id)
       and not public.can_read_record('activities', new.booked_by_activity_id) then
      raise exception 'OXYN_LINK_FORBIDDEN';
    end if;
  end if;
  return new;
end $$;

create or replace function public.guard_notification_update() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if auth.uid() is not null and (to_jsonb(new) - 'read_at') is distinct from (to_jsonb(old) - 'read_at') then
    raise exception 'OXYN_FORBIDDEN_FIELD';
  end if;
  return new;
end $$;

-- 4. Usuário desativado não vê notificações ----------------------------------------
drop policy notifications_select on public.notifications;
drop policy notifications_update on public.notifications;
create policy notifications_select on public.notifications for select to authenticated
  using (user_id = auth.uid() and public.current_user_active());
create policy notifications_update on public.notifications for update to authenticated
  using (user_id = auth.uid() and public.current_user_active())
  with check (user_id = auth.uid() and public.current_user_active());
