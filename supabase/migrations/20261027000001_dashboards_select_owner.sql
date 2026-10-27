-- O dono lê o próprio dashboard direto pela coluna. can_read_dashboard consulta a tabela e não enxerga a linha
-- que está sendo inserida, então o insert ... returning de um usuário comum falhava por RLS.
drop policy dashboards_select on public.dashboards;
create policy dashboards_select on public.dashboards for select to authenticated
  using ((owner_id = auth.uid() and public.current_user_active()) or public.can_read_dashboard(id));
