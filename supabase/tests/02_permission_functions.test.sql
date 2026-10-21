begin;
select plan(19);

insert into companies (id, name, slug) values
  ('00000000-0000-4000-8000-0000000000d1', 'Volt Teste', 'tst-volt'),
  ('00000000-0000-4000-8000-0000000000d2', 'Naia Teste', 'tst-naia');

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-0000000000c1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tst-admin@oxyn.test', '{"full_name":"admin"}'),
  ('00000000-0000-4000-8000-0000000000c2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tst-ana@oxyn.test', '{"full_name":"ana"}'),
  ('00000000-0000-4000-8000-0000000000c3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tst-bruno@oxyn.test', '{"full_name":"bruno"}'),
  ('00000000-0000-4000-8000-0000000000c4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tst-caio@oxyn.test', '{"full_name":"caio"}'),
  ('00000000-0000-4000-8000-0000000000c5', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tst-inativo@oxyn.test', '{"full_name":"inativo"}');

update profiles set is_super_admin = true where id = '00000000-0000-4000-8000-0000000000c1';
update profiles set active = false where id = '00000000-0000-4000-8000-0000000000c5';

insert into roles (id, name, description, permissions) values
  ('00000000-0000-4000-8000-0000000000e1', 'tst-Equipe', 'teste', '{"visibility":{"leads":"team","deals":"team","persons":"team","organizations":"team","activities":"team"},"actions":{"create":true,"edit":true,"delete":false,"export":false,"reassign_owner":false},"settings":{"manage_pipelines":false,"manage_custom_fields":false,"manage_products":false,"view_reports":true,"create_dashboards":true,"share_dashboards":false}}'::jsonb),
  ('00000000-0000-4000-8000-0000000000e2', 'tst-Empresa', 'teste', '{"visibility":{"leads":"company","deals":"company","persons":"company","organizations":"company","activities":"company"},"actions":{"create":true,"edit":true,"delete":true,"export":false,"reassign_owner":false},"settings":{"manage_pipelines":false,"manage_custom_fields":false,"manage_products":false,"view_reports":true,"create_dashboards":true,"share_dashboards":false}}'::jsonb);

insert into teams (id, name) values ('00000000-0000-4000-8000-0000000000f1', 'tst-SDR');
insert into team_members (team_id, user_id) values
  ('00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-0000000000c2'),
  ('00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-0000000000c3');

insert into memberships (user_id, company_id, role_id) values
  ('00000000-0000-4000-8000-0000000000c2', '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000e1'),
  ('00000000-0000-4000-8000-0000000000c4', '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000e2'),
  ('00000000-0000-4000-8000-0000000000c5', '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000e2');
insert into memberships (user_id, company_id, role_id)
  select '00000000-0000-4000-8000-0000000000c3', '00000000-0000-4000-8000-0000000000d1', id from roles where is_system;

select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-4000-8000-0000000000c3'::text, 'role', 'authenticated')::text, true);
set local role authenticated;
select is(can_access('00000000-0000-4000-8000-0000000000d1', 'deals', '00000000-0000-4000-8000-0000000000c3', 'read'), true, 'bruno lê deal próprio em volt');
reset role;

select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-4000-8000-0000000000c3'::text, 'role', 'authenticated')::text, true);
set local role authenticated;
select is(can_access('00000000-0000-4000-8000-0000000000d1', 'deals', '00000000-0000-4000-8000-0000000000c2', 'read'), false, 'bruno não lê deal de ana (own)');
reset role;

select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-4000-8000-0000000000c2'::text, 'role', 'authenticated')::text, true);
set local role authenticated;
select is(can_access('00000000-0000-4000-8000-0000000000d1', 'deals', '00000000-0000-4000-8000-0000000000c3', 'read'), true, 'ana lê deal de bruno (mesma equipe)');
reset role;

select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-4000-8000-0000000000c2'::text, 'role', 'authenticated')::text, true);
set local role authenticated;
select is(can_access('00000000-0000-4000-8000-0000000000d1', 'deals', '00000000-0000-4000-8000-0000000000c4', 'read'), false, 'ana não lê deal de caio (outra equipe)');
reset role;

select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-4000-8000-0000000000c4'::text, 'role', 'authenticated')::text, true);
set local role authenticated;
select is(can_access('00000000-0000-4000-8000-0000000000d1', 'deals', '00000000-0000-4000-8000-0000000000c2', 'read'), true, 'caio lê deal de ana (company)');
reset role;

select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-4000-8000-0000000000c4'::text, 'role', 'authenticated')::text, true);
set local role authenticated;
select is(can_access('00000000-0000-4000-8000-0000000000d1', 'deals', '00000000-0000-4000-8000-0000000000c2', 'delete'), true, 'caio exclui deal de ana');
reset role;

select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-4000-8000-0000000000c2'::text, 'role', 'authenticated')::text, true);
set local role authenticated;
select is(can_access('00000000-0000-4000-8000-0000000000d1', 'deals', '00000000-0000-4000-8000-0000000000c2', 'delete'), false, 'ana não exclui deal próprio (ação desligada)');
reset role;

select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-4000-8000-0000000000c3'::text, 'role', 'authenticated')::text, true);
set local role authenticated;
select is(can_access('00000000-0000-4000-8000-0000000000d1', 'deals', '00000000-0000-4000-8000-0000000000c3', 'create'), true, 'bruno cria em volt');
reset role;

select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-4000-8000-0000000000c3'::text, 'role', 'authenticated')::text, true);
set local role authenticated;
select is(can_access('00000000-0000-4000-8000-0000000000d2', 'deals', '00000000-0000-4000-8000-0000000000c3', 'create'), false, 'bruno não cria em naia (sem membership)');
reset role;

select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-4000-8000-0000000000c4'::text, 'role', 'authenticated')::text, true);
set local role authenticated;
select is(can_access('00000000-0000-4000-8000-0000000000d2', 'deals', '00000000-0000-4000-8000-0000000000c4', 'read'), false, 'caio não lê em naia');
reset role;

select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-4000-8000-0000000000c1'::text, 'role', 'authenticated')::text, true);
set local role authenticated;
select is(can_access('00000000-0000-4000-8000-0000000000d2', 'deals', '00000000-0000-4000-8000-0000000000c2', 'read'), true, 'admin lê em naia');
reset role;

select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-4000-8000-0000000000c1'::text, 'role', 'authenticated')::text, true);
set local role authenticated;
select is(can_access('00000000-0000-4000-8000-0000000000d2', 'deals', '00000000-0000-4000-8000-0000000000c2', 'edit'), true, 'admin edita em naia');
reset role;

select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-4000-8000-0000000000c1'::text, 'role', 'authenticated')::text, true);
set local role authenticated;
select is(can_access('00000000-0000-4000-8000-0000000000d2', 'deals', '00000000-0000-4000-8000-0000000000c2', 'delete'), true, 'admin exclui em naia');
reset role;

select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-4000-8000-0000000000c5'::text, 'role', 'authenticated')::text, true);
set local role authenticated;
select is(can_access('00000000-0000-4000-8000-0000000000d1', 'deals', '00000000-0000-4000-8000-0000000000c5', 'read'), false, 'usuário inativo não lê em volt');
reset role;

update companies set archived_at = now() where id = '00000000-0000-4000-8000-0000000000d1';

select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-4000-8000-0000000000c4'::text, 'role', 'authenticated')::text, true);
set local role authenticated;
select is(can_access('00000000-0000-4000-8000-0000000000d1', 'deals', '00000000-0000-4000-8000-0000000000c2', 'read'), false, 'empresa arquivada: caio não lê');
reset role;

select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-4000-8000-0000000000c1'::text, 'role', 'authenticated')::text, true);
set local role authenticated;
select is(can_access('00000000-0000-4000-8000-0000000000d1', 'deals', '00000000-0000-4000-8000-0000000000c2', 'read'), true, 'empresa arquivada: admin lê');
reset role;

select set_config('request.jwt.claims', '{}', true);
set local role authenticated;
select is(can_access('00000000-0000-4000-8000-0000000000d1', 'deals', '00000000-0000-4000-8000-0000000000c2', 'read'), false, 'anônimo (sem claims) não acessa');
reset role;

select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-4000-8000-0000000000c3'::text, 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok($$select can_access('00000000-0000-4000-8000-0000000000d1', 'deals', '00000000-0000-4000-8000-0000000000c3', 'destroy')$$, 'P0001', 'OXYN_UNKNOWN_ACTION', 'ação desconhecida levanta exceção');
reset role;

update companies set archived_at = null where id = '00000000-0000-4000-8000-0000000000d1';
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-4000-8000-0000000000c3'::text, 'role', 'authenticated')::text, true);
set local role authenticated;
select is(can_access('00000000-0000-4000-8000-0000000000d1', 'invoices', '00000000-0000-4000-8000-0000000000c3', 'read'), false, 'entidade desconhecida (invoices) cai no else');
reset role;

select * from finish();
rollback;
