-- Insights: a leitura de relatório e painel passa a usar as colunas da própria linha. Antes a política relia a
-- tabela, e no insert ... returning a linha nova ainda não aparecia para a função (permissão negada ao salvar).

create function public.insight_dashboard_row_access(p_user uuid, p_id uuid, p_company uuid, p_owner uuid) returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select case
    when not public.is_active_user(p_user) then null
    when public.is_super_admin_for(p_user) then 'edit'
    when not coalesce((public.role_permissions_for(p_user, p_company)->'settings'->>'view_reports') = 'true', false) then null
    when p_owner = p_user then 'edit'
    else (select case when s.can_edit then 'edit' else 'read' end
          from public.insight_dashboard_shares s where s.dashboard_id = p_id and s.user_id = p_user)
  end;
$$;

create function public.insight_report_row_access(p_user uuid, p_id uuid, p_company uuid, p_owner uuid) returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select case
    when not public.is_active_user(p_user) then null
    when public.is_super_admin_for(p_user) then 'edit'
    when not coalesce((public.role_permissions_for(p_user, p_company)->'settings'->>'view_reports') = 'true', false) then null
    when p_owner = p_user then 'edit'
    else coalesce(
      (select case when s.can_edit then 'edit' else 'read' end
       from public.insight_report_shares s where s.report_id = p_id and s.user_id = p_user),
      (select 'read' from public.insight_dashboard_reports dr
       where dr.report_id = p_id and public.insight_dashboard_access_for(p_user, dr.dashboard_id) is not null limit 1))
  end;
$$;

revoke execute on function public.insight_dashboard_row_access(uuid, uuid, uuid, uuid),
  public.insight_report_row_access(uuid, uuid, uuid, uuid) from public, anon;
grant execute on function public.insight_dashboard_row_access(uuid, uuid, uuid, uuid),
  public.insight_report_row_access(uuid, uuid, uuid, uuid) to authenticated, service_role;

drop policy insight_reports_select on public.insight_reports;
create policy insight_reports_select on public.insight_reports for select to authenticated
  using (public.insight_report_row_access(auth.uid(), id, company_id, owner_id) is not null);
drop policy insight_reports_update on public.insight_reports;
create policy insight_reports_update on public.insight_reports for update to authenticated
  using (public.insight_report_row_access(auth.uid(), id, company_id, owner_id) = 'edit')
  with check (public.insight_report_row_access(auth.uid(), id, company_id, owner_id) = 'edit');

drop policy insight_dashboards_select on public.insight_dashboards;
create policy insight_dashboards_select on public.insight_dashboards for select to authenticated
  using (public.insight_dashboard_row_access(auth.uid(), id, company_id, owner_id) is not null);
drop policy insight_dashboards_update on public.insight_dashboards;
create policy insight_dashboards_update on public.insight_dashboards for update to authenticated
  using (public.insight_dashboard_row_access(auth.uid(), id, company_id, owner_id) = 'edit')
  with check (public.insight_dashboard_row_access(auth.uid(), id, company_id, owner_id) = 'edit');
