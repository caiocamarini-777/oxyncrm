-- Fase 6, rodada 1 de correções do schema de relatórios.

-- Widget só pode apontar para relatório do dono do dashboard.
create function public.report_owned_by_dashboard_owner(p_dashboard uuid, p_report uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select p_report is null or exists (
    select 1
    from public.dashboards d
    join public.reports r on r.owner_id = d.owner_id
    where d.id = p_dashboard and r.id = p_report);
$$;

-- Destinatário precisa dividir empresa com o dono do dashboard, ou ser admin geral.
create function public.can_share_dashboard_with(p_dashboard uuid, p_user uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select public.is_active_user(p_user) and (
    public.is_super_admin_for(p_user)
    or exists (
      select 1
      from public.dashboards d
      join public.memberships a on a.user_id = d.owner_id
      join public.memberships b on b.company_id = a.company_id and b.user_id = p_user
      join public.companies c on c.id = a.company_id
      where d.id = p_dashboard and c.archived_at is null));
$$;

revoke execute on function public.report_owned_by_dashboard_owner(uuid, uuid),
  public.can_share_dashboard_with(uuid, uuid) from public, anon;
grant execute on function public.report_owned_by_dashboard_owner(uuid, uuid),
  public.can_share_dashboard_with(uuid, uuid) to authenticated;

drop policy widgets_insert on public.dashboard_widgets;
drop policy widgets_update on public.dashboard_widgets;
create policy widgets_insert on public.dashboard_widgets for insert to authenticated
  with check (public.owns_dashboard(dashboard_id) and public.report_owned_by_dashboard_owner(dashboard_id, report_id));
create policy widgets_update on public.dashboard_widgets for update to authenticated
  using (public.owns_dashboard(dashboard_id))
  with check (public.owns_dashboard(dashboard_id) and public.report_owned_by_dashboard_owner(dashboard_id, report_id));

drop policy shares_insert on public.dashboard_shares;
create policy shares_insert on public.dashboard_shares for insert to authenticated
  with check (public.owns_dashboard(dashboard_id) and public.has_any_report_setting('share_dashboards')
    and public.can_share_dashboard_with(dashboard_id, user_id));

-- owner_id = auth.uid() também para o admin geral
drop policy dashboards_insert on public.dashboards;
create policy dashboards_insert on public.dashboards for insert to authenticated
  with check (public.can_create_dashboards() and owner_id = auth.uid());
drop policy reports_insert on public.reports;
create policy reports_insert on public.reports for insert to authenticated
  with check (owner_id = auth.uid() and public.current_user_active()
    and (company_id is null or public.has_report_setting(company_id, 'view_reports')));

-- token_hash só é gravado por insert ou pela RPC; o cliente não o atualiza
revoke update on public.dashboard_share_links from authenticated;
grant update (expires_at, revoked_at) on public.dashboard_share_links to authenticated;
