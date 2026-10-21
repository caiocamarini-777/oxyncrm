-- Funções de permissão. can_access é a base das políticas RLS das fases 2 a 6.

create function public.current_user_active() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select p.active from public.profiles p where p.id = auth.uid()),
    false);
$$;

create function public.is_super_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select p.active and p.is_super_admin from public.profiles p where p.id = auth.uid()),
    false);
$$;

create function public.has_company_access(p_company uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.current_user_active() and (
    public.is_super_admin()
    or exists (
      select 1
      from public.memberships m
      join public.companies c on c.id = m.company_id
      where m.user_id = auth.uid()
        and m.company_id = p_company
        and c.archived_at is null)
  );
$$;

create function public.role_permissions(p_company uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select r.permissions
  from public.memberships m
  join public.roles r on r.id = m.role_id
  join public.companies c on c.id = m.company_id
  where m.user_id = auth.uid()
    and m.company_id = p_company
    and c.archived_at is null;
$$;

create function public.shares_team(p_other uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.team_members a
    join public.team_members b on b.team_id = a.team_id
    where a.user_id = auth.uid() and b.user_id = p_other);
$$;

create function public.can_access(p_company uuid, p_entity text, p_owner uuid, p_action text)
returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  perms jsonb;
  vis text;
begin
  if p_action not in ('read','create','edit','delete','export','reassign_owner') then
    raise exception 'OXYN_UNKNOWN_ACTION';
  end if;
  if me is null or not public.current_user_active() then return false; end if;
  if public.is_super_admin() then return true; end if;
  perms := public.role_permissions(p_company);
  if perms is null then return false; end if;
  if p_action <> 'read'
     and not coalesce((perms->'actions'->>p_action)::boolean, false) then
    return false;
  end if;
  if p_action = 'create' then return true; end if;
  vis := perms->'visibility'->>p_entity;
  return coalesce(case vis
    when 'company' then true
    when 'team' then p_owner = me or public.shares_team(p_owner)
    when 'own' then p_owner = me
    else false
  end, false);
end;
$$;

revoke execute on function
  public.current_user_active(), public.is_super_admin(),
  public.has_company_access(uuid), public.role_permissions(uuid),
  public.shares_team(uuid), public.can_access(uuid, text, uuid, text)
  from public, anon;
grant execute on function
  public.current_user_active(), public.is_super_admin(),
  public.has_company_access(uuid), public.role_permissions(uuid),
  public.shares_team(uuid), public.can_access(uuid, text, uuid, text)
  to authenticated;
