-- Segurança de negócios: whitelists, guardas, helpers e policies RLS.

-- Whitelist de entidades ampliada para deals (corpos da fase 2 intactos) -------

create or replace function public.record_ref(p_entity text, p_record_id uuid)
returns table (company_id uuid, owner_id uuid, deleted_at timestamptz)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if p_entity not in ('leads','persons','organizations','deals') then return; end if;
  return query execute format(
    'select t.company_id, t.owner_id, t.deleted_at from public.%I t where t.id = $1', p_entity)
    using p_record_id;
end $$;

create or replace function public.purge_records_internal(p_entity text, p_ids uuid[]) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare n int;
begin
  if p_entity not in ('leads', 'persons', 'organizations', 'deals') then
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
  foreach ent in array array['leads', 'persons', 'organizations', 'deals'] loop
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
  if p_entity not in ('leads', 'persons', 'organizations', 'deals') then
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

-- Helpers de configuração ------------------------------------------------------

create function public.can_manage_pipelines(p_company uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select public.current_user_active() and (
    public.is_super_admin()
    or coalesce(public.role_permissions(p_company)->'settings'->>'manage_pipelines', 'false') = 'true');
$$;

create function public.can_manage_products(p_company uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select public.current_user_active() and (
    public.is_super_admin()
    or coalesce(public.role_permissions(p_company)->'settings'->>'manage_products', 'false') = 'true');
$$;

revoke execute on function public.can_manage_pipelines(uuid), public.can_manage_products(uuid) from public, anon;
grant execute on function public.can_manage_pipelines(uuid), public.can_manage_products(uuid) to authenticated;

-- Triggers -----------------------------------------------------------------

create trigger guard_record_update before update on public.deals
  for each row execute function public.guard_record_update();
create trigger validate_custom_fields_trg before insert or update on public.deals
  for each row execute function public.validate_custom_fields_trg();
create trigger guard_company_immutable before update on public.pipelines
  for each row execute function public.guard_company_immutable();
create trigger guard_company_immutable before update on public.stages
  for each row execute function public.guard_company_immutable();
create trigger guard_company_immutable before update on public.lost_reasons
  for each row execute function public.guard_company_immutable();
create trigger guard_company_immutable before update on public.products
  for each row execute function public.guard_company_immutable();
create trigger guard_company_immutable before update on public.deal_items
  for each row execute function public.guard_company_immutable();

-- Vínculos imutáveis: etapa não muda de funil, item não muda de negócio.
create function public.guard_fk_immutable() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if tg_table_name = 'stages' then
    if new.pipeline_id is distinct from old.pipeline_id then
      raise exception 'OXYN_FORBIDDEN_FIELD';
    end if;
  elsif new.deal_id is distinct from old.deal_id then
    raise exception 'OXYN_FORBIDDEN_FIELD';
  end if;
  return new;
end $$;
revoke execute on function public.guard_fk_immutable() from public, anon, authenticated;
create trigger guard_fk_immutable before update on public.stages
  for each row execute function public.guard_fk_immutable();
create trigger guard_fk_immutable before update on public.deal_items
  for each row execute function public.guard_fk_immutable();

-- Policies: deals (idênticas às de leads) --------------------------------------

create policy deals_select on public.deals for select to authenticated using (
  (deleted_at is null and public.can_access(company_id, 'deals', owner_id, 'read'))
  or (deleted_at is not null and public.can_access(company_id, 'deals', owner_id, 'delete')));
create policy deals_insert on public.deals for insert to authenticated with check (
  deleted_at is null
  and created_by = auth.uid()
  and public.can_access(company_id, 'deals', owner_id, 'create')
  and public.owner_has_membership(company_id, owner_id)
  and (owner_id = auth.uid() or public.can_access(company_id, 'deals', owner_id, 'reassign_owner')));
create policy deals_update on public.deals for update to authenticated using (
  (deleted_at is null and public.can_access(company_id, 'deals', owner_id, 'edit'))
  or (deleted_at is not null and public.can_access(company_id, 'deals', owner_id, 'delete')))
  with check (public.owner_has_membership(company_id, owner_id));
create policy deals_delete on public.deals for delete to authenticated using (public.is_super_admin());

-- Policies: configuração de funis e produtos -----------------------------------

do $$
declare t text;
begin
  foreach t in array array['pipelines','stages','lost_reasons'] loop
    execute format($f$create policy %1$s_select on public.%1$s for select to authenticated
      using (public.has_company_access(company_id))$f$, t);
    execute format($f$create policy %1$s_insert on public.%1$s for insert to authenticated
      with check (public.can_manage_pipelines(company_id))$f$, t);
    execute format($f$create policy %1$s_update on public.%1$s for update to authenticated
      using (public.can_manage_pipelines(company_id))
      with check (public.can_manage_pipelines(company_id))$f$, t);
    execute format($f$create policy %1$s_delete on public.%1$s for delete to authenticated
      using (public.can_manage_pipelines(company_id))$f$, t);
  end loop;
end $$;

create policy products_select on public.products for select to authenticated
  using (public.has_company_access(company_id));
create policy products_insert on public.products for insert to authenticated
  with check (public.can_manage_products(company_id));
create policy products_update on public.products for update to authenticated
  using (public.can_manage_products(company_id))
  with check (public.can_manage_products(company_id));
create policy products_delete on public.products for delete to authenticated
  using (public.can_manage_products(company_id));

-- Policies: itens, cronograma e histórico ------------------------------------------

create policy deal_items_select on public.deal_items for select to authenticated
  using (public.can_read_record('deals', deal_id));
create policy deal_items_insert on public.deal_items for insert to authenticated
  with check (public.can_edit_record('deals', deal_id));
create policy deal_items_update on public.deal_items for update to authenticated
  using (public.can_edit_record('deals', deal_id))
  with check (public.can_edit_record('deals', deal_id));
create policy deal_items_delete on public.deal_items for delete to authenticated
  using (public.can_edit_record('deals', deal_id));

create policy deal_revenue_schedule_select on public.deal_revenue_schedule for select to authenticated
  using (public.can_read_record('deals', deal_id));
create policy deal_stage_history_select on public.deal_stage_history for select to authenticated
  using (public.can_read_record('deals', deal_id));

-- Cronograma e histórico só são escritos por triggers security definer.
revoke insert, update, delete on public.deal_revenue_schedule, public.deal_stage_history from authenticated;

-- Usada no CHECK de stages.required_fields: precisa ser executável por quem escreve etapas (função pura).
grant execute on function public.valid_required_fields(text[]) to authenticated;
