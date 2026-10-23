begin;
select plan(16);

create function pg_temp.u(n int) returns uuid language sql immutable as $$
  select ('00000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
create function pg_temp.as_user(u uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;
create function pg_temp.as_pg() returns void language plpgsql as $$
begin
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
end $$;
grant execute on function pg_temp.u(int), pg_temp.as_user(uuid), pg_temp.as_pg() to public;

insert into companies (id, name, slug) values (pg_temp.u(1), 'Volt Teste', 'tst-volt'), (pg_temp.u(2), 'Naia Teste', 'tst-naia');
insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data) values
  (pg_temp.u(11), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tst-g@oxyn.test', '{"full_name":"tst-gestor"}'),
  (pg_temp.u(13), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tst-v@oxyn.test', '{"full_name":"tst-vend"}');
insert into roles (id, name, description, permissions) values
  (pg_temp.u(21), 'tst-Gestor', 'teste', '{"visibility":{"leads":"company","deals":"company","persons":"company","organizations":"company","activities":"company"},"actions":{"create":true,"edit":true,"delete":true,"export":true,"reassign_owner":true},"settings":{"manage_pipelines":true,"manage_custom_fields":true,"manage_products":true,"view_reports":true,"create_dashboards":true,"share_dashboards":true}}'::jsonb),
  (pg_temp.u(22), 'tst-SemRelatorio', 'teste', '{"visibility":{"leads":"own","deals":"own","persons":"own","organizations":"own","activities":"own"},"actions":{"create":true,"edit":true,"delete":false,"export":false,"reassign_owner":false},"settings":{"manage_pipelines":false,"manage_custom_fields":false,"manage_products":false,"view_reports":false,"create_dashboards":false,"share_dashboards":false}}'::jsonb);
-- dono nas duas empresas; destinatário só na Volt
insert into memberships (user_id, company_id, role_id) values
  (pg_temp.u(11), pg_temp.u(1), pg_temp.u(21)), (pg_temp.u(11), pg_temp.u(2), pg_temp.u(21)),
  (pg_temp.u(13), pg_temp.u(1), pg_temp.u(22));

insert into pipelines (id, company_id, name) values (pg_temp.u(401), pg_temp.u(1), 'tst-funil');
insert into stages (id, pipeline_id, company_id, name, position) values (pg_temp.u(501), pg_temp.u(401), pg_temp.u(1), 'tst-e1', 0);
insert into deals (id, company_id, owner_id, title, pipeline_id, stage_id) values
  (pg_temp.u(201), pg_temp.u(1), pg_temp.u(11), 'tst-d1', pg_temp.u(401), pg_temp.u(501)),
  (pg_temp.u(202), pg_temp.u(1), pg_temp.u(11), 'tst-d2', pg_temp.u(401), pg_temp.u(501));
insert into leads (id, company_id, owner_id, title) values (pg_temp.u(101), pg_temp.u(1), pg_temp.u(11), 'tst-l1');

-- Atividade prevista em março e concluída em abril
insert into activities (id, company_id, owner_id, created_by, type_id, channel_id, subject, due_at, done, completed_at, lead_id)
values (pg_temp.u(301), pg_temp.u(1), pg_temp.u(11), pg_temp.u(11),
  (select id from activity_types where company_id = pg_temp.u(1) and name = 'Mensagem'),
  (select id from activity_channels where company_id = pg_temp.u(1) and name = 'LinkedIn'),
  'tst-ativ', '2026-03-15 10:00-03', true, '2026-04-05 10:00-03', pg_temp.u(101));

insert into dashboards (id, owner_id, name) values (pg_temp.u(601), pg_temp.u(11), 'tst-painel');
insert into dashboard_widgets (id, dashboard_id, report_id, spec, title, position) values
  (pg_temp.u(701), pg_temp.u(601), null, '{"kind":"custom","base":"deals","metric":{"op":"count"},"chart":"number"}', 'Negócios', 0),
  (pg_temp.u(702), pg_temp.u(601), null, '{"kind":"custom","base":"activities","metric":{"op":"count"},"chart":"number"}', 'Atividades', 1);
insert into dashboard_shares (dashboard_id, user_id) values (pg_temp.u(601), pg_temp.u(13));

-- 1. destinatário com sobreposição de empresas ----------------------------------------------------------
select pg_temp.as_user(pg_temp.u(13));
select is((run_widget(pg_temp.u(701), '{}')->>'total')::int, 2, 'destinatário roda o widget com o alcance do dono');
select is((select count(*)::int from dashboards where id = pg_temp.u(601)), 1, 'destinatário vê o dashboard');
select is((select count(*)::int from dashboard_widgets where dashboard_id = pg_temp.u(601)), 2, 'destinatário vê os widgets');

-- 2. dono sem share_dashboards: widgets somem para o destinatário (M4) ------------------------------------
select pg_temp.as_pg();
update roles set permissions = jsonb_set(permissions, '{settings,share_dashboards}', 'false') where id = pg_temp.u(21);
select pg_temp.as_user(pg_temp.u(13));
select is((select count(*)::int from dashboard_widgets where dashboard_id = pg_temp.u(601)), 0,
  'dono sem share_dashboards: destinatário não lê os widgets');
select pg_temp.as_user(pg_temp.u(11));
select is((select count(*)::int from dashboard_widgets where dashboard_id = pg_temp.u(601)), 2,
  'dono sem share_dashboards ainda lê os próprios widgets');
select pg_temp.as_pg();
update roles set permissions = jsonb_set(permissions, '{settings,share_dashboards}', 'true') where id = pg_temp.u(21);

-- 3. destinatário perde a última empresa em comum com o dono ----------------------------------------------
delete from memberships where user_id = pg_temp.u(13) and company_id = pg_temp.u(1);
select pg_temp.as_user(pg_temp.u(13));
select throws_ok($$ select run_widget(pg_temp.u(701), '{}') $$, 'P0001', 'OXYN_FORBIDDEN',
  'sem empresa em comum: run_widget é negado');
select is((select count(*)::int from dashboards where id = pg_temp.u(601)), 0, 'sem empresa em comum: o dashboard some');
select is((select count(*)::int from dashboard_widgets where dashboard_id = pg_temp.u(601)), 0,
  'sem empresa em comum: os widgets somem');
select is((select count(*)::int from dashboard_shares where dashboard_id = pg_temp.u(601)), 1,
  'o compartilhamento continua gravado (volta se a empresa voltar)');
select pg_temp.as_pg();
insert into memberships (user_id, company_id, role_id) values (pg_temp.u(13), pg_temp.u(2), pg_temp.u(22));
select pg_temp.as_user(pg_temp.u(13));
select is((run_widget(pg_temp.u(701), '{}')->>'total')::int, 2, 'outra empresa em comum devolve o acesso');
select pg_temp.as_pg();
update companies set archived_at = now() where id = pg_temp.u(2);
select pg_temp.as_user(pg_temp.u(13));
select throws_ok($$ select run_widget(pg_temp.u(701), '{}') $$, 'P0001', 'OXYN_FORBIDDEN',
  'empresa em comum arquivada não conta');
select pg_temp.as_pg();
update companies set archived_at = null where id = pg_temp.u(2);

-- 4. período do dashboard em atividades sem período usa due_at, como run_report_custom (M3) ---------------
select pg_temp.as_user(pg_temp.u(11));
select is((run_widget(pg_temp.u(702), '{"period":{"from":"2026-03-01","to":"2026-03-31"}}')->>'total')::int, 1,
  'atividades sem período: o período do dashboard cai no due_at');
select is((run_widget(pg_temp.u(702), '{"period":{"from":"2026-04-01","to":"2026-04-30"}}')->>'total')::int, 0,
  'atividades sem período: completed_at fora do critério');
select is(
  run_widget(pg_temp.u(702), '{"period":{"from":"2026-03-01","to":"2026-03-31"}}')->'total',
  run_report_self('{"kind":"custom","base":"activities","metric":{"op":"count"},"chart":"number","period":{"field":"due_at","from":"2026-03-01","to":"2026-03-31"}}',
    array[pg_temp.u(1)])->'total',
  'widget filtrado bate com o relatório no due_at');

-- 5. goal_progress ordena por rótulo e id antes do corte (M1) ---------------------------------------------
-- 501 metas "Reuniões agendadas" e uma "Oportunidades criadas": por métrica, a última ficaria fora do corte.
select pg_temp.as_pg();
insert into goals (company_id, target_kind, metric, period, starts_on, target_value, created_by)
select pg_temp.u(2), 'company', 'meetings_booked', 'month', '2026-01-01', 1, pg_temp.u(11) from generate_series(1, 501);
insert into goals (company_id, target_kind, metric, period, starts_on, target_value, created_by)
values (pg_temp.u(2), 'company', 'opportunities_created', 'month', '2026-01-01', 1, pg_temp.u(11));
select pg_temp.as_user(pg_temp.u(11));
select is(run_report_self('{"kind":"goal_progress","chart":"table"}', array[pg_temp.u(2)])->'rows'->0->>0,
  'Oportunidades criadas (Naia Teste)', 'o corte de 501 metas segue a ordem do rótulo');
select ok((run_report_self('{"kind":"goal_progress","chart":"table"}', array[pg_temp.u(2)])->>'truncated')::boolean,
  'mais de 500 metas: resultado truncado');

select * from finish();
rollback;
