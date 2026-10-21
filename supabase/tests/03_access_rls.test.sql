begin;
select plan(36);

insert into companies (id, name, slug) values
  ('00000000-0000-4000-8000-0000000000d1', 'Volt Teste', 'tst-volt'),
  ('00000000-0000-4000-8000-0000000000d2', 'Naia Teste', 'tst-naia');

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-0000000000c1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tst-admin@oxyn.test', '{"full_name":"admin"}'),
  ('00000000-0000-4000-8000-0000000000c2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tst-ana@oxyn.test', '{"full_name":"ana"}'),
  ('00000000-0000-4000-8000-0000000000c3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tst-bruno@oxyn.test', '{"full_name":"bruno"}'),
  ('00000000-0000-4000-8000-0000000000c4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tst-caio@oxyn.test', '{"full_name":"caio"}'),
  ('00000000-0000-4000-8000-0000000000c5', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tst-inativo@oxyn.test', '{"full_name":"inativo"}'),
  ('00000000-0000-4000-8000-0000000000c6', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tst-admin2@oxyn.test', '{"full_name":"admin2"}'),
  ('00000000-0000-4000-8000-0000000000c7', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tst-dora@oxyn.test', '{"full_name":"dora"}');

update profiles set is_super_admin = true where id in ('00000000-0000-4000-8000-0000000000c1','00000000-0000-4000-8000-0000000000c6');
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
insert into memberships (user_id, company_id, role_id) values
  ('00000000-0000-4000-8000-0000000000c7', '00000000-0000-4000-8000-0000000000d2', '00000000-0000-4000-8000-0000000000e2');
insert into memberships (user_id, company_id, role_id)
  select '00000000-0000-4000-8000-0000000000c3', '00000000-0000-4000-8000-0000000000d1', id from roles where is_system;

select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-4000-8000-0000000000c3'::text, 'role', 'authenticated')::text, true);
set local role authenticated;
select results_eq($$ select slug from companies where slug like 'tst-%' order by slug $$, $$ values ('tst-volt') $$, 'bruno vê só tst-volt');
reset role;
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-4000-8000-0000000000c1'::text, 'role', 'authenticated')::text, true);
set local role authenticated;
select results_eq($$ select slug from companies where slug like 'tst-%' order by slug $$, $$ values ('tst-naia'),('tst-volt') $$, 'admin vê tst-volt e tst-naia');
reset role;
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-4000-8000-0000000000c3'::text, 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok($$ insert into companies (name, slug) values ('Nova', 'tst-nova') $$, '42501', null, 'bruno não insere company');
reset role;
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-4000-8000-0000000000c3'::text, 'role', 'authenticated')::text, true);
set local role authenticated;
select results_eq($$ select email from profiles where email like 'tst-%' order by email $$, $$ values ('tst-ana@oxyn.test'),('tst-bruno@oxyn.test'),('tst-caio@oxyn.test'),('tst-inativo@oxyn.test') $$, 'bruno vê perfis de volt (inclui ana e caio), não admin nem dora');
reset role;
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-4000-8000-0000000000c3'::text, 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select count(*) from profiles where id = '00000000-0000-4000-8000-0000000000c7'), 0::bigint, 'bruno não vê dora (só em naia)');
reset role;
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-4000-8000-0000000000c3'::text, 'role', 'authenticated')::text, true);
set local role authenticated;
select is(shares_company('00000000-0000-4000-8000-0000000000c2'), true, 'shares_company: ana') ;
reset role;
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-4000-8000-0000000000c3'::text, 'role', 'authenticated')::text, true);
set local role authenticated;
select is(shares_company('00000000-0000-4000-8000-0000000000c7'), false, 'shares_company: dora');
reset role;
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-4000-8000-0000000000c3'::text, 'role', 'authenticated')::text, true);
set local role authenticated;
select lives_ok($$ update profiles set full_name = 'Bruno Novo' where id = '00000000-0000-4000-8000-0000000000c3' $$, 'bruno atualiza o próprio nome');
reset role;
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-4000-8000-0000000000c3'::text, 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok($$ update profiles set is_super_admin = true where id = '00000000-0000-4000-8000-0000000000c3' $$, 'P0001', 'OXYN_FORBIDDEN_FIELD', 'bruno não vira super admin');
reset role;
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-4000-8000-0000000000c3'::text, 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok($$ update profiles set email = 'tst-x@oxyn.test' where id = '00000000-0000-4000-8000-0000000000c3' $$, 'P0001', 'OXYN_FORBIDDEN_FIELD', 'bruno não troca email');
reset role;
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-4000-8000-0000000000c3'::text, 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok($$ insert into profiles (id, email) values (gen_random_uuid(), 'tst-y@oxyn.test') $$, '42501', null, 'bruno não insere profile');
reset role;
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-4000-8000-0000000000c3'::text, 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok($$ insert into audit_log (table_name, action) values ('x','insert') $$, '42501', null, 'bruno não escreve em audit_log');
reset role;
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-4000-8000-0000000000c1'::text, 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok($$ update profiles set active = false where id = '00000000-0000-4000-8000-0000000000c1' $$, 'P0001', 'OXYN_SELF_LOCKOUT', 'admin não desativa a si mesmo');
reset role;
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-4000-8000-0000000000c1'::text, 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok($$ update profiles set is_super_admin = false where id = '00000000-0000-4000-8000-0000000000c1' $$, 'P0001', 'OXYN_SELF_LOCKOUT', 'admin não se rebaixa');
reset role;
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-4000-8000-0000000000c1'::text, 'role', 'authenticated')::text, true);
set local role authenticated;
select lives_ok($$ update profiles set active = false where id = '00000000-0000-4000-8000-0000000000c6' $$, 'admin desativa admin2');
reset role;
select set_config('request.jwt.claims', '', true);
update profiles set is_super_admin = false where is_super_admin and id <> '00000000-0000-4000-8000-0000000000c1';
select throws_ok($$ update profiles set active = false where id = '00000000-0000-4000-8000-0000000000c1' $$, 'P0001', 'OXYN_LAST_SUPER_ADMIN', 'ninguém desativa o último super admin (sem auth.uid)');
select set_config('request.jwt.claims', '', true);
select throws_ok($$ delete from auth.users where id = '00000000-0000-4000-8000-0000000000c1' $$, 'P0001', 'OXYN_LAST_SUPER_ADMIN', 'não exclui o último super admin (cascade)');
select set_config('request.jwt.claims', '', true);
select lives_ok($$ update profiles set is_super_admin = true where id = '00000000-0000-4000-8000-0000000000c2' $$, 'service/postgres pode promover (R9)');
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-4000-8000-0000000000c1'::text, 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok($$ delete from roles where name = 'Usuário padrão' $$, 'P0001', 'OXYN_SYSTEM_ROLE', 'admin não exclui papel de sistema');
reset role;
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-4000-8000-0000000000c1'::text, 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok($$ update roles set name = 'Outro' where name = 'Usuário padrão' $$, 'P0001', 'OXYN_SYSTEM_ROLE', 'admin não renomeia papel de sistema');
reset role;
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-4000-8000-0000000000c1'::text, 'role', 'authenticated')::text, true);
set local role authenticated;
select lives_ok($$ update roles set permissions = jsonb_set(permissions, '{actions,export}', 'true') where name = 'Usuário padrão' $$, 'admin edita permissões do papel de sistema');
reset role;
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-4000-8000-0000000000c1'::text, 'role', 'authenticated')::text, true);
set local role authenticated;
select lives_ok($$ update roles set name = 'tst-Empresa2' where name = 'tst-Empresa' $$, 'admin renomeia papel comum');
reset role;
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-4000-8000-0000000000c1'::text, 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok($$ delete from roles where id = '00000000-0000-4000-8000-0000000000e1' $$, '23503', null, 'papel em uso não é excluído');
reset role;
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-4000-8000-0000000000c1'::text, 'role', 'authenticated')::text, true);
set local role authenticated;
insert into companies (id, name, slug) values ('00000000-0000-4000-8000-0000000000d3', 'Nova Teste', 'tst-nova');
select is((select count(*) from companies where id = '00000000-0000-4000-8000-0000000000d3'), 1::bigint, 'admin cria empresa');
reset role;
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-4000-8000-0000000000c3'::text, 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select count(*) from audit_log), 0::bigint, 'bruno lê 0 linhas de audit_log');
reset role;
select set_config('request.jwt.claims', '', true);
select results_eq($$ select table_name, action, actor_id from audit_log where record_id = '00000000-0000-4000-8000-0000000000d3' $$, $$ values ('companies'::text, 'insert'::text, '00000000-0000-4000-8000-0000000000c1'::uuid) $$, 'audit_log registra criação da empresa com actor admin');
select is((select count(*) from audit_log where table_name = 'profiles' and action = 'update' and record_id = '00000000-0000-4000-8000-0000000000c3'), 1::bigint, 'audit_log registra update do profile do bruno');
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-4000-8000-0000000000c5'::text, 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select count(*) from companies where slug like 'tst-%'), 0::bigint, 'inativo lê 0 companies');
reset role;

select set_config('request.jwt.claims', '', true);
select lives_ok($$ delete from auth.users where id = '00000000-0000-4000-8000-0000000000c7' $$, 'exclui usuário comum');
select ok(not has_table_privilege('authenticated', 'public.companies', 'TRUNCATE'), 'authenticated sem TRUNCATE em companies');
select ok(not has_table_privilege('authenticated', 'public.profiles', 'TRUNCATE'), 'authenticated sem TRUNCATE em profiles');
select ok(not has_table_privilege('authenticated', 'public.roles', 'TRUNCATE'), 'authenticated sem TRUNCATE em roles');
select ok(not has_table_privilege('authenticated', 'public.teams', 'TRUNCATE'), 'authenticated sem TRUNCATE em teams');
select ok(not has_table_privilege('authenticated', 'public.team_members', 'TRUNCATE'), 'authenticated sem TRUNCATE em team_members');
select ok(not has_table_privilege('authenticated', 'public.memberships', 'TRUNCATE'), 'authenticated sem TRUNCATE em memberships');
select ok(not has_table_privilege('authenticated', 'public.audit_log', 'TRUNCATE'), 'authenticated sem TRUNCATE em audit_log');

select * from finish();
rollback;
