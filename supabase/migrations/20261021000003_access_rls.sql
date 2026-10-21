-- RLS, guardas e auditoria das tabelas de acesso. Toda policy e `to authenticated`.

create function public.shares_company(p_other uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.current_user_active() and exists (
    select 1
    from public.memberships m1
    join public.memberships m2 on m2.company_id = m1.company_id
    where m1.user_id = auth.uid() and m2.user_id = p_other);
$$;
revoke execute on function public.shares_company(uuid) from public, anon;
grant execute on function public.shares_company(uuid) to authenticated;

-- Defesa em profundidade: anon nunca toca nestas tabelas.
revoke all on public.companies, public.profiles, public.roles, public.teams,
  public.team_members, public.memberships, public.audit_log from anon;
-- TRUNCATE ignora RLS e triggers de linha: authenticated nao pode.
revoke truncate, references, trigger on public.companies, public.profiles, public.roles,
  public.teams, public.team_members, public.memberships, public.audit_log from authenticated;

-- companies
create policy companies_select on public.companies for select to authenticated
  using (public.has_company_access(id));
create policy companies_insert on public.companies for insert to authenticated
  with check (public.is_super_admin());
create policy companies_update on public.companies for update to authenticated
  using (public.is_super_admin()) with check (public.is_super_admin());
create policy companies_delete on public.companies for delete to authenticated
  using (public.is_super_admin());

-- profiles (insert e delete: ninguem; trigger de auth e cascade cuidam)
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_super_admin() or public.shares_company(id));
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid() or public.is_super_admin())
  with check (id = auth.uid() or public.is_super_admin());

-- roles, teams, team_members
create policy roles_select on public.roles for select to authenticated
  using (public.current_user_active());
create policy roles_insert on public.roles for insert to authenticated
  with check (public.is_super_admin());
create policy roles_update on public.roles for update to authenticated
  using (public.is_super_admin()) with check (public.is_super_admin());
create policy roles_delete on public.roles for delete to authenticated
  using (public.is_super_admin());

create policy teams_select on public.teams for select to authenticated
  using (public.current_user_active());
create policy teams_insert on public.teams for insert to authenticated
  with check (public.is_super_admin());
create policy teams_update on public.teams for update to authenticated
  using (public.is_super_admin()) with check (public.is_super_admin());
create policy teams_delete on public.teams for delete to authenticated
  using (public.is_super_admin());

create policy team_members_select on public.team_members for select to authenticated
  using (public.current_user_active());
create policy team_members_insert on public.team_members for insert to authenticated
  with check (public.is_super_admin());
create policy team_members_update on public.team_members for update to authenticated
  using (public.is_super_admin()) with check (public.is_super_admin());
create policy team_members_delete on public.team_members for delete to authenticated
  using (public.is_super_admin());

-- memberships
create policy memberships_select on public.memberships for select to authenticated
  using (user_id = auth.uid() or public.has_company_access(company_id));
create policy memberships_insert on public.memberships for insert to authenticated
  with check (public.is_super_admin());
create policy memberships_update on public.memberships for update to authenticated
  using (public.is_super_admin()) with check (public.is_super_admin());
create policy memberships_delete on public.memberships for delete to authenticated
  using (public.is_super_admin());

-- audit_log: leitura so para admin geral; escrita so via triggers security definer
create policy audit_log_select on public.audit_log for select to authenticated
  using (public.is_super_admin());

-- Guarda de profiles
create function public.guard_profile_changes() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
begin
  if me is not null and not public.is_super_admin() then
    if new.is_super_admin is distinct from old.is_super_admin
       or new.active is distinct from old.active
       or new.email is distinct from old.email then
      raise exception 'OXYN_FORBIDDEN_FIELD';
    end if;
  end if;

  if me is not null and me = old.id then
    if (old.active and not new.active)
       or (old.is_super_admin and not new.is_super_admin) then
      raise exception 'OXYN_SELF_LOCKOUT';
    end if;
  end if;

  if old.is_super_admin and old.active
     and not (new.is_super_admin and new.active)
     and not exists (
       select 1 from public.profiles p
       where p.id <> old.id and p.is_super_admin and p.active) then
    raise exception 'OXYN_LAST_SUPER_ADMIN';
  end if;

  return new;
end $$;

create trigger guard_profile_changes before update on public.profiles
  for each row execute function public.guard_profile_changes();

create function public.guard_profile_delete() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.is_super_admin and old.active
     and not exists (
       select 1 from public.profiles p
       where p.id <> old.id and p.is_super_admin and p.active) then
    raise exception 'OXYN_LAST_SUPER_ADMIN';
  end if;
  return old;
end $$;

create trigger guard_profile_delete before delete on public.profiles
  for each row execute function public.guard_profile_delete();

-- Guarda do papel de sistema
create function public.guard_system_role() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.is_system then
    if tg_op = 'DELETE'
       or new.name is distinct from old.name
       or new.is_system is distinct from old.is_system then
      raise exception 'OXYN_SYSTEM_ROLE';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

create trigger guard_system_role before update or delete on public.roles
  for each row execute function public.guard_system_role();

-- Auditoria
create function public.audit_row() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  rec jsonb := to_jsonb(case when tg_op = 'DELETE' then old else new end);
  rid uuid;
begin
  rid := case when tg_table_name = 'team_members'
              then (rec->>'team_id')::uuid
              else (rec->>'id')::uuid end;
  insert into public.audit_log (table_name, record_id, action, actor_id, old_data, new_data)
  values (tg_table_name, rid, lower(tg_op), auth.uid(),
          case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end,
          case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end);
  return null;
end $$;

revoke execute on function public.guard_profile_changes(), public.guard_profile_delete(), public.guard_system_role(),
  public.audit_row() from public, anon, authenticated;

create trigger audit_row after insert or update or delete on public.companies
  for each row execute function public.audit_row();
create trigger audit_row after insert or update or delete on public.roles
  for each row execute function public.audit_row();
create trigger audit_row after insert or update or delete on public.teams
  for each row execute function public.audit_row();
create trigger audit_row after insert or update or delete on public.team_members
  for each row execute function public.audit_row();
create trigger audit_row after insert or update or delete on public.memberships
  for each row execute function public.audit_row();
create trigger audit_row after update on public.profiles
  for each row execute function public.audit_row();

-- Storage: bucket publico de avatares; escrita so na propria pasta
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

create policy avatars_select on storage.objects for select to authenticated
  using (bucket_id = 'avatars');
create policy avatars_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy avatars_update on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy avatars_delete on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
