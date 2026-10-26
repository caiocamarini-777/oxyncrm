begin;
select plan(23);

create function pg_temp.u(n int) returns uuid language sql immutable as $$
  select ('00000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
create function pg_temp.as_user(u uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;
create function pg_temp.as_service() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  perform set_config('role', 'service_role', true);
end $$;
create function pg_temp.as_anon() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  perform set_config('role', 'anon', true);
end $$;
create function pg_temp.as_pg() returns void language plpgsql as $$
begin
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
end $$;
grant execute on function pg_temp.u(int), pg_temp.as_user(uuid), pg_temp.as_service(), pg_temp.as_anon(),
  pg_temp.as_pg() to public;
create temp table tok (n int primary key, token text, link_id uuid);
grant all on tok to public;

insert into companies (id, name, slug) values (pg_temp.u(1), 'Volt Teste', 'tst-volt');
insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data) values
  (pg_temp.u(11), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tst-g@oxyn.test', '{"full_name":"tst-gestor"}'),
  (pg_temp.u(13), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tst-v@oxyn.test', '{"full_name":"tst-vend"}');
insert into roles (id, name, description, permissions) values
  (pg_temp.u(21), 'tst-Gestor', 'teste', '{"visibility":{"leads":"company","deals":"company","persons":"company","organizations":"company","activities":"company"},"actions":{"create":true,"edit":true,"delete":true,"export":true,"reassign_owner":true},"settings":{"manage_pipelines":true,"manage_custom_fields":true,"manage_products":true,"view_reports":true,"create_dashboards":true,"share_dashboards":true}}'::jsonb),
  (pg_temp.u(22), 'tst-Vendedor', 'teste', '{"visibility":{"leads":"own","deals":"own","persons":"own","organizations":"own","activities":"own"},"actions":{"create":true,"edit":true,"delete":false,"export":false,"reassign_owner":false},"settings":{"manage_pipelines":false,"manage_custom_fields":false,"manage_products":false,"view_reports":true,"create_dashboards":true,"share_dashboards":false}}'::jsonb);
insert into memberships (user_id, company_id, role_id) values
  (pg_temp.u(11), pg_temp.u(1), pg_temp.u(21)), (pg_temp.u(13), pg_temp.u(1), pg_temp.u(22));

insert into reports (id, company_id, owner_id, name, spec) values
  (pg_temp.u(801), pg_temp.u(1), pg_temp.u(11), 'tst-rel-pizza',
   '{"kind":"custom","base":"deals","metric":{"op":"count"},"chart":"pie"}');
insert into dashboards (id, owner_id, name) values
  (pg_temp.u(601), pg_temp.u(11), 'tst-painel'), (pg_temp.u(602), pg_temp.u(11), 'tst-painel-2');
insert into dashboard_widgets (id, dashboard_id, report_id, spec, title, position) values
  (pg_temp.u(701), pg_temp.u(601), null, '{"kind":"custom","base":"deals","metric":{"op":"count"},"chart":"bar"}', 'Barras', 0),
  (pg_temp.u(702), pg_temp.u(601), null, '{"kind":"forecast"}', 'Forecast', 1),
  (pg_temp.u(703), pg_temp.u(601), pg_temp.u(801), null, 'Pizza', 2),
  (pg_temp.u(704), pg_temp.u(602), null, '{"kind":"custom","base":"deals","metric":{"op":"count"},"chart":"number"}', 'Outro', 0);
insert into dashboard_shares (dashboard_id, user_id) values (pg_temp.u(601), pg_temp.u(13));

-- 1. chart na saída dos widgets -----------------------------------------------------------------------
select pg_temp.as_user(pg_temp.u(11));
select is(run_widget(pg_temp.u(701), '{}')->'chart', '"bar"'::jsonb, 'run_widget traz o gráfico da spec do widget');
select is(run_widget(pg_temp.u(703), '{}')->'chart', '"pie"'::jsonb, 'run_widget traz o gráfico do relatório salvo');
select is(run_widget(pg_temp.u(702), '{}')->'chart', 'null'::jsonb, 'preset sem chart devolve null');
select ok(run_widget(pg_temp.u(701), '{}') ? 'rows' and run_widget(pg_temp.u(701), '{}') ? 'truncated',
  'o resto da saída continua igual');

select pg_temp.as_user(pg_temp.u(13));
select is((select count(*)::int from reports), 0, 'destinatário não lê reports');
select is(run_widget(pg_temp.u(703), '{}')->'chart', '"pie"'::jsonb, 'destinatário recebe o gráfico pelo resultado');

-- 2. create_share_link devolve {id, token} --------------------------------------------------------------
select pg_temp.as_user(pg_temp.u(11));
insert into tok (n, token, link_id)
  select 1, r->>'token', (r->>'id')::uuid from (select create_share_link(pg_temp.u(601), null) r) x;
select ok((select token ~ '^[A-Za-z0-9_-]{43}$' from tok where n = 1), 'token em base64url de 32 bytes');
select is((select count(*)::int from dashboard_share_links l join tok t on t.link_id = l.id
  where l.dashboard_id = pg_temp.u(601) and l.created_by = pg_temp.u(11)), 1, 'o id devolvido é o do link criado');
select is((select array_agg(k order by k) from jsonb_object_keys(create_share_link(pg_temp.u(601), null)) k),
  array['id','token'], 'só id e token');
select throws_ok($$ select create_share_link(pg_temp.u(601), now() - interval '1 day') $$, 'P0001',
  'OXYN_INVALID_INPUT', 'expiração no passado continua recusada');
select pg_temp.as_user(pg_temp.u(13));
select throws_ok($$ select create_share_link(pg_temp.u(601), null) $$, 'P0001', 'OXYN_FORBIDDEN',
  'destinatário continua sem criar link');
select pg_temp.as_service();
select is(run_widget_public((select token from tok where n = 1), pg_temp.u(701), '{}')->'chart', '"bar"'::jsonb,
  'run_widget_public traz o gráfico');

-- 3. update_widget_layout -----------------------------------------------------------------------------------
select pg_temp.as_user(pg_temp.u(11));
select lives_ok($$ select update_widget_layout(pg_temp.u(601), jsonb_build_array(
  jsonb_build_object('id', pg_temp.u(701), 'position', 2, 'col_span', 4, 'row_span', 3),
  jsonb_build_object('id', pg_temp.u(703), 'position', 0, 'col_span', 2, 'row_span', 1))) $$, 'dono reordena e redimensiona');
select is((select array[position, col_span, row_span] from dashboard_widgets where id = pg_temp.u(701)), array[2, 4, 3],
  'widget 701 atualizado');
select is((select array[position, col_span, row_span] from dashboard_widgets where id = pg_temp.u(703)), array[0, 2, 1],
  'widget 703 atualizado');
select throws_ok($$ select update_widget_layout(pg_temp.u(601), jsonb_build_array(
  jsonb_build_object('id', pg_temp.u(702), 'position', 5, 'col_span', 1, 'row_span', 1),
  jsonb_build_object('id', pg_temp.u(704), 'position', 6, 'col_span', 1, 'row_span', 1))) $$, 'P0001',
  'OXYN_INVALID_INPUT', 'id de outro dashboard é recusado');
select is((select position from dashboard_widgets where id = pg_temp.u(702)), 1, 'nada é gravado quando um item é inválido');
select throws_ok($$ select update_widget_layout(pg_temp.u(601), jsonb_build_array(
  jsonb_build_object('id', pg_temp.u(702), 'position', 1, 'col_span', 5, 'row_span', 1))) $$, 'P0001',
  'OXYN_INVALID_INPUT', 'col_span fora de 1 a 4');
select throws_ok($$ select update_widget_layout(pg_temp.u(601), jsonb_build_array(
  jsonb_build_object('id', pg_temp.u(702), 'position', 1, 'col_span', 1, 'row_span', 4))) $$, 'P0001',
  'OXYN_INVALID_INPUT', 'row_span fora de 1 a 3');
select throws_ok($$ select update_widget_layout(pg_temp.u(601), jsonb_build_array(
  jsonb_build_object('id', pg_temp.u(702), 'position', 1, 'col_span', 1, 'row_span', 1),
  jsonb_build_object('id', pg_temp.u(702), 'position', 2, 'col_span', 1, 'row_span', 1))) $$, 'P0001',
  'OXYN_INVALID_INPUT', 'ids repetidos');
select throws_ok($$ select update_widget_layout(pg_temp.u(601), '{"id":"x"}') $$, 'P0001', 'OXYN_INVALID_INPUT',
  'não é array');

select pg_temp.as_user(pg_temp.u(13));
select throws_ok($$ select update_widget_layout(pg_temp.u(601), jsonb_build_array(
  jsonb_build_object('id', pg_temp.u(702), 'position', 9, 'col_span', 1, 'row_span', 1))) $$, 'P0001',
  'OXYN_INVALID_INPUT', 'destinatário não grava (RLS)');
select pg_temp.as_anon();
select throws_ok($$ select update_widget_layout(pg_temp.u(601), '[]') $$, '42501', null, 'anon não executa');

select * from finish();
rollback;
