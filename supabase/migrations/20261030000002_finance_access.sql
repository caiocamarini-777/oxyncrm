-- Financeiro: permissões opcionais por papel e ativação por empresa.

-- Mesmas regras de antes, mas settings aceita as 6 chaves antigas (obrigatórias) mais qualquer
-- subconjunto das 3 chaves de finanças (opcionais), todas booleanas.
create or replace function public.is_valid_permissions(p jsonb) returns boolean
language plpgsql immutable set search_path = public as $$
declare
  k text;
  required_settings constant text[] :=
    array['create_dashboards','manage_custom_fields','manage_pipelines','manage_products','share_dashboards','view_reports'];
  optional_settings constant text[] := array['manage_finance','register_sales','view_finance'];
begin
  if p is null or jsonb_typeof(p) <> 'object' then return false; end if;
  if (select array_agg(x order by x) from jsonb_object_keys(p) x)
     is distinct from array['actions','settings','visibility'] then return false; end if;

  if jsonb_typeof(p->'visibility') <> 'object' or jsonb_typeof(p->'actions') <> 'object'
     or jsonb_typeof(p->'settings') <> 'object' then return false; end if;

  if (select array_agg(x order by x) from jsonb_object_keys(p->'visibility') x)
     is distinct from array['activities','deals','leads','organizations','persons'] then return false; end if;
  for k in select jsonb_object_keys(p->'visibility') loop
    if jsonb_typeof(p->'visibility'->k) <> 'string'
       or (p->'visibility'->>k) not in ('own','team','company') then return false; end if;
  end loop;

  if (select array_agg(x order by x) from jsonb_object_keys(p->'actions') x)
     is distinct from array['create','delete','edit','export','reassign_owner'] then return false; end if;
  for k in select jsonb_object_keys(p->'actions') loop
    if jsonb_typeof(p->'actions'->k) <> 'boolean' then return false; end if;
  end loop;

  -- todas as obrigatórias presentes e nenhuma chave fora de obrigatórias + opcionais
  if exists (select 1 from unnest(required_settings) r where not (p->'settings' ? r)) then return false; end if;
  for k in select jsonb_object_keys(p->'settings') loop
    if not (k = any (required_settings) or k = any (optional_settings)) then return false; end if;
    if jsonb_typeof(p->'settings'->k) <> 'boolean' then return false; end if;
  end loop;

  return true;
end $$;

alter table public.companies add column finance_enabled boolean not null default false;

create function public.can_finance(p_company uuid, p_action text) returns boolean
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  perms jsonb;
begin
  if p_action not in ('view','manage','sell') then
    raise exception 'OXYN_UNKNOWN_ACTION';
  end if;
  if not public.current_user_active() then return false; end if;
  if not coalesce((select c.finance_enabled from public.companies c
                   where c.id = p_company and c.archived_at is null), false) then
    return false;
  end if;
  if public.is_super_admin() then return true; end if;
  perms := public.role_permissions(p_company);
  if perms is null then return false; end if;
  return case p_action
    when 'view' then coalesce((perms->'settings'->>'view_finance')::boolean, false)
                  or coalesce((perms->'settings'->>'manage_finance')::boolean, false)
    when 'manage' then coalesce((perms->'settings'->>'manage_finance')::boolean, false)
    else coalesce((perms->'settings'->>'register_sales')::boolean, false)
         or coalesce((perms->'settings'->>'manage_finance')::boolean, false)
  end;
end $$;

revoke execute on function public.can_finance(uuid, text) from public, anon;
grant execute on function public.can_finance(uuid, text) to authenticated;

-- Stub: a Task 4 substitui (create or replace) pelo semeador real de categorias.
create function public.fin_seed_categories(p_company uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  null;
end $$;
revoke execute on function public.fin_seed_categories(uuid) from public, anon, authenticated;

create function public.companies_finance_enabled_seed() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.finance_enabled and not old.finance_enabled then
    perform public.fin_seed_categories(new.id);
  end if;
  return new;
end $$;
revoke execute on function public.companies_finance_enabled_seed() from public, anon, authenticated;

create trigger companies_finance_enabled_seed after update of finance_enabled on public.companies
  for each row execute function public.companies_finance_enabled_seed();
