begin;
select plan(20);

create function pg_temp.u(n int) returns uuid language sql immutable as $$
  select ('00000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
create function pg_temp.as_user(n int) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', pg_temp.u(n), 'role', 'authenticated')::text, true);
  select set_config('role', 'authenticated', true);
$$;
create function pg_temp.reset() returns void language sql as $$
  select set_config('role', 'none', true);
  select set_config('request.jwt.claims', '', true);
$$;
create function pg_temp.err(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return 'ok';
exception when others then
  return sqlerrm;
end $$;

insert into companies (id, name, slug) values (pg_temp.u(1), 'Insights', 'tst-ins'), (pg_temp.u(2), 'Outra', 'tst-ins2');
insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data) values
  (pg_temp.u(11), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tst-ins-dono@oxyn.test', '{"full_name":"tst-dono"}'),
  (pg_temp.u(12), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tst-ins-leitor@oxyn.test', '{"full_name":"tst-leitor"}'),
  (pg_temp.u(13), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tst-ins-editor@oxyn.test', '{"full_name":"tst-editor"}'),
  (pg_temp.u(14), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tst-ins-estranho@oxyn.test', '{"full_name":"tst-estranho"}');
insert into roles (id, name, description, permissions) values
  (pg_temp.u(21), 'tst-ins-gestor', 'teste', '{"visibility":{"leads":"company","deals":"company","persons":"company","organizations":"company","activities":"company"},"actions":{"create":true,"edit":true,"delete":true,"export":true,"reassign_owner":true},"settings":{"manage_pipelines":true,"manage_custom_fields":true,"manage_products":true,"view_reports":true,"create_dashboards":true,"share_dashboards":true}}'::jsonb),
  (pg_temp.u(22), 'tst-ins-semrel', 'teste', '{"visibility":{"leads":"own","deals":"own","persons":"own","organizations":"own","activities":"own"},"actions":{"create":true,"edit":true,"delete":false,"export":false,"reassign_owner":false},"settings":{"manage_pipelines":false,"manage_custom_fields":false,"manage_products":false,"view_reports":false,"create_dashboards":false,"share_dashboards":false}}'::jsonb);
insert into memberships (user_id, company_id, role_id) values
  (pg_temp.u(11), pg_temp.u(1), pg_temp.u(21)), (pg_temp.u(12), pg_temp.u(1), pg_temp.u(21)),
  (pg_temp.u(13), pg_temp.u(1), pg_temp.u(21)), (pg_temp.u(14), pg_temp.u(1), pg_temp.u(21)),
  (pg_temp.u(11), pg_temp.u(2), pg_temp.u(21));

-- dono cria relatório e painel
select pg_temp.as_user(11);
select is(pg_temp.err(format($q$insert into insight_reports (id, company_id, owner_id, name, data_type, report_type, chart_type)
  values (%L, %L, %L, 'Leads', 'leads', 'performance', 'column')$q$, pg_temp.u(101), pg_temp.u(1), pg_temp.u(11))), 'ok', 'dono cria relatório');
select is(pg_temp.err(format($q$insert into insight_reports (id, company_id, owner_id, name, data_type, report_type, chart_type)
  values (%L, %L, %L, 'Outra empresa', 'deals', 'stats', 'scorecard')$q$, pg_temp.u(102), pg_temp.u(2), pg_temp.u(11))), 'ok', 'relatório de outra empresa');
select is(pg_temp.err(format($q$insert into insight_dashboards (id, company_id, owner_id, name) values (%L, %L, %L, 'KPIs')$q$,
  pg_temp.u(201), pg_temp.u(1), pg_temp.u(11))), 'ok', 'dono cria painel');
select is(pg_temp.err(format($q$insert into insight_dashboard_reports (dashboard_id, report_id, x, y, w, h) values (%L, %L, 0, 0, 2, 5)$q$,
  pg_temp.u(201), pg_temp.u(101))), 'ok', 'relatório vai para o painel');
select isnt(pg_temp.err(format($q$insert into insight_dashboard_reports (dashboard_id, report_id, x, y, w, h) values (%L, %L, 0, 0, 1, 5)$q$,
  pg_temp.u(201), pg_temp.u(102))), 'ok', 'relatório de outra empresa não entra no painel');
select isnt(pg_temp.err(format($q$update insight_dashboard_reports set x = 3, w = 2 where report_id = %L$q$, pg_temp.u(101))),
  'ok', 'x + w passa de 4: recusado');
select isnt(pg_temp.err(format($q$insert into insight_reports (company_id, owner_id, name, data_type, report_type, chart_type)
  values (%L, %L, 'X', 'leads', 'performance', 'donut')$q$, pg_temp.u(1), pg_temp.u(11))), 'ok', 'tipo de gráfico desconhecido recusado');
select is(pg_temp.err(format($q$insert into insight_dashboard_shares (dashboard_id, user_id) values (%L, %L)$q$,
  pg_temp.u(201), pg_temp.u(12))), 'ok', 'compartilha painel com leitor');
select is(pg_temp.err(format($q$insert into insight_report_shares (report_id, user_id, can_edit) values (%L, %L, true)$q$,
  pg_temp.u(101), pg_temp.u(13))), 'ok', 'compartilha relatório com editor');
select pg_temp.reset();

-- leitor: lê painel e relatório (pelo painel), não edita
select pg_temp.as_user(12);
select is((select count(*)::int from insight_dashboards where id = pg_temp.u(201)), 1, 'leitor vê o painel');
select is((select count(*)::int from insight_reports where id = pg_temp.u(101)), 1, 'leitor vê o relatório do painel');
select is((select count(*)::int from insight_reports where id = pg_temp.u(102)), 0, 'leitor não vê relatório fora do painel');
update insight_reports set name = 'mudou' where id = pg_temp.u(101);
update insight_dashboard_reports set y = 10 where report_id = pg_temp.u(101);
select pg_temp.reset();
select is((select name from insight_reports where id = pg_temp.u(101)), 'Leads', 'leitor não renomeia');
select is((select y from insight_dashboard_reports where report_id = pg_temp.u(101)), 0, 'leitor não move widget');

-- editor do relatório: edita o relatório, não o painel
select pg_temp.as_user(13);
update insight_reports set name = 'Leads 2', colors = '{"open":"#2e9e5b"}' where id = pg_temp.u(101);
select pg_temp.reset();
select is((select name from insight_reports where id = pg_temp.u(101)), 'Leads 2', 'editor renomeia');
select pg_temp.as_user(13);
select isnt(pg_temp.err(format($q$update insight_reports set owner_id = %L where id = %L$q$, pg_temp.u(13), pg_temp.u(101))),
  'ok', 'dono não muda');
select is((select count(*)::int from insight_dashboards), 0, 'editor do relatório não vê o painel');
select pg_temp.reset();

-- estranho e sem permissão
select pg_temp.as_user(14);
select is((select count(*)::int from insight_reports where company_id = pg_temp.u(1)), 0, 'estranho não vê relatórios');
select pg_temp.reset();
update memberships set role_id = pg_temp.u(22) where user_id = pg_temp.u(12);
select pg_temp.as_user(12);
select is((select count(*)::int from insight_dashboards), 0, 'sem view_reports não vê o painel compartilhado');
select pg_temp.reset();

-- link público
select pg_temp.as_user(11);
select ok((public.create_insight_link(pg_temp.u(201))->>'token') is not null, 'dono cria link público');
select pg_temp.reset();

select * from finish();
rollback;
