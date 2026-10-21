begin;
select plan(80);

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
create function pg_temp.affected(stmt text) returns bigint language plpgsql as $$
declare n bigint;
begin
  execute stmt;
  get diagnostics n = row_count;
  return n;
end $$;
grant execute on function pg_temp.affected(text) to public;
grant execute on function pg_temp.as_user(uuid), pg_temp.as_pg() to public;

insert into companies (id, name, slug) values
  ('00000000-0000-4000-8000-0000000000d1', 'Volt Teste', 'tst-volt'),
  ('00000000-0000-4000-8000-0000000000d2', 'Naia Teste', 'tst-naia');

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-0000000000c1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tst-admin@oxyn.test', '{"full_name":"admin"}'),
  ('00000000-0000-4000-8000-0000000000c2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tst-ana@oxyn.test', '{"full_name":"ana"}'),
  ('00000000-0000-4000-8000-0000000000c3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tst-bruno@oxyn.test', '{"full_name":"bruno"}'),
  ('00000000-0000-4000-8000-0000000000c4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tst-caio@oxyn.test', '{"full_name":"caio"}'),
  ('00000000-0000-4000-8000-0000000000c5', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tst-dani@oxyn.test', '{"full_name":"dani"}');
update profiles set is_super_admin = true where id = '00000000-0000-4000-8000-0000000000c1';

insert into roles (id, name, description, permissions) values
  ('00000000-0000-4000-8000-0000000000e1', 'tst-Equipe', 'teste', '{"visibility":{"leads":"team","deals":"team","persons":"team","organizations":"team","activities":"team"},"actions":{"create":true,"edit":true,"delete":false,"export":false,"reassign_owner":false},"settings":{"manage_pipelines":false,"manage_custom_fields":false,"manage_products":false,"view_reports":true,"create_dashboards":true,"share_dashboards":false}}'::jsonb),
  ('00000000-0000-4000-8000-0000000000e3', 'tst-Gestor', 'teste', '{"visibility":{"leads":"company","deals":"company","persons":"company","organizations":"company","activities":"company"},"actions":{"create":true,"edit":true,"delete":true,"export":true,"reassign_owner":true},"settings":{"manage_pipelines":true,"manage_custom_fields":true,"manage_products":true,"view_reports":true,"create_dashboards":true,"share_dashboards":true}}'::jsonb);

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-0000000000c6', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tst-eva@oxyn.test', '{"full_name":"eva"}');
insert into roles (id, name, description, permissions) values
  ('00000000-0000-4000-8000-0000000000e4', 'tst-EquipeReassign', 'teste', '{"visibility":{"leads":"team","deals":"team","persons":"team","organizations":"team","activities":"team"},"actions":{"create":true,"edit":true,"delete":false,"export":false,"reassign_owner":true},"settings":{"manage_pipelines":false,"manage_custom_fields":false,"manage_products":false,"view_reports":true,"create_dashboards":true,"share_dashboards":false}}'::jsonb);
insert into teams (id, name) values ('00000000-0000-4000-8000-0000000000f1', 'tst-SDR');
insert into team_members (team_id, user_id) values
  ('00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-0000000000c2'),
  ('00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-0000000000c3'),
  ('00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-0000000000c6');

insert into memberships (user_id, company_id, role_id) values
  ('00000000-0000-4000-8000-0000000000c2', '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000e1'),
  ('00000000-0000-4000-8000-0000000000c4', '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000e3'),
  ('00000000-0000-4000-8000-0000000000c6', '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000e4'),
  ('00000000-0000-4000-8000-0000000000c5', '00000000-0000-4000-8000-0000000000d2', '00000000-0000-4000-8000-0000000000e3');
insert into memberships (user_id, company_id, role_id)
  select '00000000-0000-4000-8000-0000000000c3', '00000000-0000-4000-8000-0000000000d1', id from roles where is_system;

-- bruno=c3, ana=c2, caio=c4, dani=c5 (só em naia)
insert into organizations (id, company_id, owner_id, name) values
  ('00000000-0000-4000-8000-000000000b01', '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000c3', 'Org Bruno'),
  ('00000000-0000-4000-8000-000000000b02', '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000c2', 'Org Ana'),
  ('00000000-0000-4000-8000-000000000b03', '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000c4', 'Org Caio'),
  ('00000000-0000-4000-8000-000000000b04', '00000000-0000-4000-8000-0000000000d2', '00000000-0000-4000-8000-0000000000c5', 'Org Dani');
insert into persons (id, company_id, owner_id, full_name) values
  ('00000000-0000-4000-8000-000000000a01', '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000c3', 'Pessoa Bruno'),
  ('00000000-0000-4000-8000-000000000a02', '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000c2', 'Pessoa Ana'),
  ('00000000-0000-4000-8000-000000000a03', '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000c4', 'Pessoa Caio'),
  ('00000000-0000-4000-8000-000000000a04', '00000000-0000-4000-8000-0000000000d2', '00000000-0000-4000-8000-0000000000c5', 'Pessoa Dani');
insert into leads (id, company_id, owner_id, title) values
  ('00000000-0000-4000-8000-000000000c01', '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000c3', 'Lead Bruno'),
  ('00000000-0000-4000-8000-000000000c02', '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000c2', 'Lead Ana'),
  ('00000000-0000-4000-8000-000000000c03', '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000c4', 'Lead Caio'),
  ('00000000-0000-4000-8000-000000000c04', '00000000-0000-4000-8000-0000000000d2', '00000000-0000-4000-8000-0000000000c5', 'Lead Dani');

insert into custom_field_defs (company_id, entity, key, label, type, options) values
  ('00000000-0000-4000-8000-0000000000d1', 'organizations', 'porte', 'Porte', 'select', '["Pequeno","Médio","Grande"]'),
  ('00000000-0000-4000-8000-0000000000d1', 'organizations', 'tags', 'Tags', 'multiselect', '["a","b"]'),
  ('00000000-0000-4000-8000-0000000000d1', 'organizations', 'qtd', 'Quantidade', 'number', '[]'),
  ('00000000-0000-4000-8000-0000000000d1', 'organizations', 'desde', 'Desde', 'date', '[]'),
  ('00000000-0000-4000-8000-0000000000d1', 'organizations', 'resp', 'Responsável', 'user', '[]'),
  ('00000000-0000-4000-8000-0000000000d1', 'organizations', 'obs', 'Obs', 'text', '[]');

insert into labels (id, company_id, name, color) values
  ('00000000-0000-4000-8000-000000000d01', '00000000-0000-4000-8000-0000000000d1', 'tst-Quente', 'red'),
  ('00000000-0000-4000-8000-000000000d02', '00000000-0000-4000-8000-0000000000d1', 'tst-Frio', 'blue');
insert into notes (id, company_id, entity, record_id, body, created_by) values
  ('00000000-0000-4000-8000-000000000e01', '00000000-0000-4000-8000-0000000000d1', 'organizations', '00000000-0000-4000-8000-000000000b01', 'Nota bruno', '00000000-0000-4000-8000-0000000000c1'),
  ('00000000-0000-4000-8000-000000000e02', '00000000-0000-4000-8000-0000000000d1', 'organizations', '00000000-0000-4000-8000-000000000b02', 'Nota ana', '00000000-0000-4000-8000-0000000000c1');
insert into timeline_events (company_id, entity, record_id, kind) values
  ('00000000-0000-4000-8000-0000000000d1', 'organizations', '00000000-0000-4000-8000-000000000b01', 'created'),
  ('00000000-0000-4000-8000-0000000000d1', 'organizations', '00000000-0000-4000-8000-000000000b02', 'created');

-- Visibilidade: bruno (own)
select pg_temp.as_user('00000000-0000-4000-8000-0000000000c3');
select results_eq($$ select id from organizations where company_id in ('00000000-0000-4000-8000-0000000000d1','00000000-0000-4000-8000-0000000000d2') $$,
  $$ values ('00000000-0000-4000-8000-000000000b01'::uuid) $$, 'bruno vê só a própria organização');
select results_eq($$ select id from persons where company_id in ('00000000-0000-4000-8000-0000000000d1','00000000-0000-4000-8000-0000000000d2') $$,
  $$ values ('00000000-0000-4000-8000-000000000a01'::uuid) $$, 'bruno vê só a própria pessoa');
select results_eq($$ select id from leads where company_id in ('00000000-0000-4000-8000-0000000000d1','00000000-0000-4000-8000-0000000000d2') $$,
  $$ values ('00000000-0000-4000-8000-000000000c01'::uuid) $$, 'bruno vê só o próprio lead');
-- notas e timeline
select results_eq($$ select id from notes where company_id = '00000000-0000-4000-8000-0000000000d1' $$,
  $$ values ('00000000-0000-4000-8000-000000000e01'::uuid) $$, 'bruno lê só notas de registros que lê');
select results_eq($$ select distinct record_id from timeline_events where company_id = '00000000-0000-4000-8000-0000000000d1' and entity = 'organizations' $$,
  $$ values ('00000000-0000-4000-8000-000000000b01'::uuid) $$, 'bruno lê só timeline de registros que lê');
select throws_ok($$ insert into notes (company_id, entity, record_id, body, created_by) values
  ('00000000-0000-4000-8000-0000000000d1','organizations','00000000-0000-4000-8000-000000000b01','x','00000000-0000-4000-8000-0000000000c2') $$,
  '42501', null, 'bruno não cria nota em nome de outro');
select throws_ok($$ insert into notes (company_id, entity, record_id, body) values
  ('00000000-0000-4000-8000-0000000000d1','organizations','00000000-0000-4000-8000-000000000b02','x') $$,
  '42501', null, 'bruno não cria nota em registro que não lê');
select lives_ok($$ insert into notes (company_id, entity, record_id, body) values
  ('00000000-0000-4000-8000-0000000000d1','organizations','00000000-0000-4000-8000-000000000b01','minha nota') $$,
  'bruno cria nota própria em registro que lê');
select throws_ok($$ insert into timeline_events (company_id, entity, record_id, kind) values
  ('00000000-0000-4000-8000-0000000000d1','organizations','00000000-0000-4000-8000-000000000b01','created') $$,
  '42501', null, 'ninguém escreve em timeline_events pela API');
select throws_ok($$ insert into labels (company_id, name, color) values ('00000000-0000-4000-8000-0000000000d1','tst-Nova','blue') $$,
  '42501', null, 'bruno não cria labels');
select is((select count(*) from labels where id = '00000000-0000-4000-8000-000000000d01'), 1::bigint, 'bruno lê labels da empresa');
select lives_ok($$ insert into record_labels (label_id, entity, record_id) values
  ('00000000-0000-4000-8000-000000000d01','organizations','00000000-0000-4000-8000-000000000b01') $$,
  'bruno etiqueta registro que edita');
select throws_ok($$ insert into record_labels (label_id, entity, record_id) values
  ('00000000-0000-4000-8000-000000000d01','organizations','00000000-0000-4000-8000-000000000b02') $$,
  '42501', null, 'bruno não etiqueta registro que não edita');
select is((select count(*) from record_labels where label_id in ('00000000-0000-4000-8000-000000000d01','00000000-0000-4000-8000-000000000d02')), 1::bigint, 'bruno lê etiquetas de registros que lê');
select throws_ok($$ select * from record_ref('organizations', '00000000-0000-4000-8000-000000000b01') $$,
  '42501', null, 'authenticated não executa record_ref');
select is(owner_has_membership('00000000-0000-4000-8000-0000000000d2', '00000000-0000-4000-8000-0000000000c5'), false,
  'bruno não sonda membership de outra empresa');
select throws_ok($$ select validate_custom_fields('00000000-0000-4000-8000-0000000000d2', 'organizations', '{}') $$,
  '42501', null, 'bruno não valida campos de outra empresa');
select throws_ok($$ insert into leads (company_id, owner_id, title, deleted_at) values
  ('00000000-0000-4000-8000-0000000000d1','00000000-0000-4000-8000-0000000000c3','Já na lixeira', now()) $$,
  '42501', null, 'insert não cria registro já na lixeira');
select throws_ok($$ insert into leads (company_id, owner_id, title, created_by) values
  ('00000000-0000-4000-8000-0000000000d1','00000000-0000-4000-8000-0000000000c3','Autor falso','00000000-0000-4000-8000-0000000000c2') $$,
  '42501', null, 'insert não aceita created_by de outro');
select throws_ok($$ insert into record_labels (label_id, entity, record_id, created_by) values
  ('00000000-0000-4000-8000-000000000d02','organizations','00000000-0000-4000-8000-000000000b01','00000000-0000-4000-8000-0000000000c2') $$,
  '42501', null, 'record_labels não aceita created_by de outro');
-- criação
select lives_ok($$ insert into leads (id, company_id, owner_id, title) values
  ('00000000-0000-4000-8000-000000000c05','00000000-0000-4000-8000-0000000000d1','00000000-0000-4000-8000-0000000000c3','Novo do bruno') $$,
  'bruno cria lead próprio');
select throws_ok($$ insert into leads (company_id, owner_id, title) values
  ('00000000-0000-4000-8000-0000000000d1','00000000-0000-4000-8000-0000000000c2','Lead para ana') $$,
  '42501', null, 'bruno não cria lead para outro dono');
select throws_ok($$ update leads set owner_id = '00000000-0000-4000-8000-0000000000c2' where id = '00000000-0000-4000-8000-000000000c01' $$,
  'P0001', 'OXYN_REASSIGN_FORBIDDEN', 'bruno não reatribui lead');
select throws_ok($$ update leads set deleted_at = now() where id = '00000000-0000-4000-8000-000000000c01' $$,
  'P0001', 'OXYN_TRASH_FORBIDDEN', 'bruno não manda para a lixeira');
select is(pg_temp.affected($q$update leads set title = 'Lead Bruno 2' where id = '00000000-0000-4000-8000-000000000c02'$q$),
  0::bigint, 'bruno não edita lead que não vê');

-- ana (team)
select pg_temp.as_pg();
select pg_temp.as_user('00000000-0000-4000-8000-0000000000c2');
select results_eq($$ select id from leads where company_id = '00000000-0000-4000-8000-0000000000d1' order by title $$,
  $$ values ('00000000-0000-4000-8000-000000000c02'::uuid), ('00000000-0000-4000-8000-000000000c01'::uuid), ('00000000-0000-4000-8000-000000000c05'::uuid) $$,
  'ana vê leads dela e de bruno, não de caio');
select results_eq($$ select id from organizations where company_id = '00000000-0000-4000-8000-0000000000d1' order by name $$,
  $$ values ('00000000-0000-4000-8000-000000000b02'::uuid), ('00000000-0000-4000-8000-000000000b01'::uuid) $$,
  'ana vê organizações dela e de bruno');
select throws_ok($$ update leads set deleted_at = now() where id = '00000000-0000-4000-8000-000000000c02' $$,
  'P0001', 'OXYN_TRASH_FORBIDDEN', 'ana não manda para a lixeira');
select throws_ok($$ update leads set owner_id = '00000000-0000-4000-8000-0000000000c3' where id = '00000000-0000-4000-8000-000000000c02' $$,
  'P0001', 'OXYN_REASSIGN_FORBIDDEN', 'ana não reatribui');
select is(pg_temp.affected($q$delete from leads where id = '00000000-0000-4000-8000-000000000c02'$q$),
  0::bigint, 'ana não exclui definitivamente');

select results_eq($$ select id from persons where company_id = '00000000-0000-4000-8000-0000000000d1' order by full_name $$,
  $$ values ('00000000-0000-4000-8000-000000000a02'::uuid), ('00000000-0000-4000-8000-000000000a01'::uuid) $$,
  'ana vê pessoas dela e de bruno');
select is(pg_temp.affected($q$update notes set body = 'invadida' where body = 'minha nota'$q$), 0::bigint,
  'ana não edita nota de outro');

-- caio (company, gestor)
select pg_temp.as_pg();
select pg_temp.as_user('00000000-0000-4000-8000-0000000000c4');
select is((select count(*) from leads where id in ('00000000-0000-4000-8000-000000000c01','00000000-0000-4000-8000-000000000c02','00000000-0000-4000-8000-000000000c03')),
  3::bigint, 'caio vê todos os leads de tst-volt');
select is((select count(*) from leads where company_id = '00000000-0000-4000-8000-0000000000d2')
  + (select count(*) from persons where company_id = '00000000-0000-4000-8000-0000000000d2')
  + (select count(*) from organizations where company_id = '00000000-0000-4000-8000-0000000000d2'),
  0::bigint, 'caio não vê nada de tst-naia');
select results_eq($$ select id from persons where company_id = '00000000-0000-4000-8000-0000000000d1' order by full_name $$,
  $$ values ('00000000-0000-4000-8000-000000000a02'::uuid), ('00000000-0000-4000-8000-000000000a01'::uuid), ('00000000-0000-4000-8000-000000000a03'::uuid) $$,
  'caio vê todas as pessoas de tst-volt');
select is((select count(*) from organizations where id in ('00000000-0000-4000-8000-000000000b01','00000000-0000-4000-8000-000000000b02','00000000-0000-4000-8000-000000000b03')),
  3::bigint, 'caio vê todas as organizações de tst-volt');
select is(pg_temp.affected($q$update organizations set name = 'Invadida' where id = '00000000-0000-4000-8000-000000000b04'$q$), 0::bigint,
  'update em outra empresa afeta 0 linhas');
select lives_ok($$ insert into leads (id, company_id, owner_id, title) values
  ('00000000-0000-4000-8000-000000000c06','00000000-0000-4000-8000-0000000000d1','00000000-0000-4000-8000-0000000000c2','Lead do caio para ana') $$,
  'caio cria lead para ana');
select throws_ok($$ insert into leads (company_id, owner_id, title) values
  ('00000000-0000-4000-8000-0000000000d1','00000000-0000-4000-8000-0000000000c5','Lead para dani') $$,
  '42501', null, 'caio não cria lead para quem não é da empresa');
select throws_ok($$ update leads set owner_id = '00000000-0000-4000-8000-0000000000c5' where id = '00000000-0000-4000-8000-000000000c01' $$,
  '42501', null, 'caio não reatribui para quem não é da empresa');
select lives_ok($$ update leads set owner_id = '00000000-0000-4000-8000-0000000000c2' where id = '00000000-0000-4000-8000-000000000c01' $$,
  'caio reatribui lead de bruno para ana');
select throws_ok($$ update organizations set company_id = '00000000-0000-4000-8000-0000000000d2' where id = '00000000-0000-4000-8000-000000000b03' $$,
  'P0001', 'OXYN_COMPANY_IMMUTABLE', 'caio não muda a empresa do registro');
select lives_ok($$ update leads set deleted_at = now() where id = '00000000-0000-4000-8000-000000000c02' $$, 'caio manda lead para a lixeira');
select is((select count(*) from leads where id = '00000000-0000-4000-8000-000000000c02' and deleted_at is not null), 1::bigint,
  'caio vê o lead na lixeira');
select is(pg_temp.affected($q$delete from leads where id = '00000000-0000-4000-8000-000000000c03'$q$),
  0::bigint, 'caio não exclui definitivamente');
-- custom fields
select lives_ok($$ update organizations set custom_fields = '{"porte":"Médio","tags":["a","b"],"qtd":3,"desde":"2024-02-29","resp":"00000000-0000-4000-8000-0000000000c2","obs":null}' where id = '00000000-0000-4000-8000-000000000b03' $$,
  'campos personalizados válidos');
select throws_ok($$ update organizations set custom_fields = '{"porte":"Gigante"}' where id = '00000000-0000-4000-8000-000000000b03' $$,
  'P0001', 'OXYN_INVALID_CUSTOM_FIELD', 'opção inexistente');
select throws_ok($$ update organizations set custom_fields = '{"inexistente":1}' where id = '00000000-0000-4000-8000-000000000b03' $$,
  'P0001', 'OXYN_INVALID_CUSTOM_FIELD', 'chave sem definição');
select throws_ok($$ update organizations set custom_fields = '{"qtd":"3"}' where id = '00000000-0000-4000-8000-000000000b03' $$,
  'P0001', 'OXYN_INVALID_CUSTOM_FIELD', 'número como string');
select throws_ok($$ update organizations set custom_fields = '{"desde":"2024-02-30"}' where id = '00000000-0000-4000-8000-000000000b03' $$,
  'P0001', 'OXYN_INVALID_CUSTOM_FIELD', 'data inexistente');
select throws_ok($$ update organizations set custom_fields = '{"tags":["a","z"]}' where id = '00000000-0000-4000-8000-000000000b03' $$,
  'P0001', 'OXYN_INVALID_CUSTOM_FIELD', 'multiselect com opção inexistente');
select throws_ok($$ update organizations set custom_fields = '{"resp":"00000000-0000-4000-8000-0000000000c5"}' where id = '00000000-0000-4000-8000-000000000b03' $$,
  'P0001', 'OXYN_INVALID_CUSTOM_FIELD', 'usuário sem membership na empresa');
select throws_ok($$ update organizations set custom_fields = jsonb_build_object('obs', repeat('x', 2001)) where id = '00000000-0000-4000-8000-000000000b03' $$,
  'P0001', 'OXYN_INVALID_CUSTOM_FIELD', 'texto acima de 2.000');
select lives_ok($$ insert into labels (company_id, name, color) values ('00000000-0000-4000-8000-0000000000d1','tst-Nova','blue') $$,
  'caio cria labels');
select throws_ok($$ insert into labels (company_id, name, color) values ('00000000-0000-4000-8000-0000000000d2','tst-Outra','blue') $$,
  '42501', null, 'caio não cria labels em outra empresa');

-- def arquivada continua válida
select pg_temp.as_pg();
update custom_field_defs set archived_at = now() where key = 'porte' and company_id = '00000000-0000-4000-8000-0000000000d1';
select pg_temp.as_user('00000000-0000-4000-8000-0000000000c4');
select lives_ok($$ update organizations set custom_fields = '{"porte":"Médio"}' where id = '00000000-0000-4000-8000-000000000b03' $$,
  'definição arquivada mantém valor válido');

-- bruno depois da reatribuição
select pg_temp.as_pg();
select pg_temp.as_user('00000000-0000-4000-8000-0000000000c3');
select is((select count(*) from leads where id = '00000000-0000-4000-8000-000000000c01'), 0::bigint, 'lead reatribuído some para bruno');

-- ana não vê o lead na lixeira; caio sim (já checado); admin exclui
select pg_temp.as_pg();
select pg_temp.as_user('00000000-0000-4000-8000-0000000000c2');
select is((select count(*) from leads where id = '00000000-0000-4000-8000-000000000c02'), 0::bigint, 'lead na lixeira some para ana');
-- caio restaura da lixeira
select pg_temp.as_pg();
select pg_temp.as_user('00000000-0000-4000-8000-0000000000c4');
select lives_ok($$ update leads set deleted_at = null where id = '00000000-0000-4000-8000-000000000c02' $$, 'caio restaura lead da lixeira');
select pg_temp.as_pg();
select pg_temp.as_user('00000000-0000-4000-8000-0000000000c2');
select is((select count(*) from leads where id = '00000000-0000-4000-8000-000000000c02'), 1::bigint, 'lead restaurado volta para ana');
-- reassign_record
select pg_temp.as_pg();
insert into leads (id, company_id, owner_id, title) values
  ('00000000-0000-4000-8000-000000000c07', '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000c6', 'Lead Eva');
select pg_temp.as_user('00000000-0000-4000-8000-0000000000c6');
select lives_ok($$ select reassign_record('leads', '00000000-0000-4000-8000-000000000c07', '00000000-0000-4000-8000-0000000000c4') $$,
  'equipe com reassign reatribui para fora da equipe');
select throws_ok($$ select reassign_record('leads', '00000000-0000-4000-8000-000000000c06', '00000000-0000-4000-8000-0000000000c5') $$,
  'P0001', 'OXYN_OWNER_NOT_MEMBER', 'eva não reatribui para quem não é da empresa');
select pg_temp.as_pg();
select is((select owner_id from leads where id = '00000000-0000-4000-8000-000000000c07'), '00000000-0000-4000-8000-0000000000c4'::uuid,
  'dono do lead mudou para caio');
select pg_temp.as_user('00000000-0000-4000-8000-0000000000c2');
select throws_ok($$ select reassign_record('leads', '00000000-0000-4000-8000-000000000c06', '00000000-0000-4000-8000-0000000000c3') $$,
  'P0001', 'OXYN_REASSIGN_FORBIDDEN', 'ana sem reassign_owner não usa reassign_record');
select pg_temp.as_pg();
select pg_temp.as_user('00000000-0000-4000-8000-0000000000c4');
select throws_ok($$ select reassign_record('leads', '00000000-0000-4000-8000-000000000c06', '00000000-0000-4000-8000-0000000000c5') $$,
  'P0001', 'OXYN_OWNER_NOT_MEMBER', 'reassign_record exige membership do novo dono');

-- nota: criador apaga logicamente a própria nota
select pg_temp.as_pg();
select pg_temp.as_user('00000000-0000-4000-8000-0000000000c3');
select lives_ok($$ update notes set deleted_at = now() where body = 'minha nota' $$, 'criador apaga logicamente a própria nota');

select pg_temp.as_pg();
select pg_temp.as_user('00000000-0000-4000-8000-0000000000c1');
select is(pg_temp.affected($q$delete from leads where id = '00000000-0000-4000-8000-000000000c03'$q$),
  1::bigint, 'admin exclui definitivamente');
select pg_temp.as_pg();

-- privilégios
select ok(not has_table_privilege('authenticated', 'public.' || t, 'TRUNCATE'), 'authenticated sem TRUNCATE em ' || t)
from unnest(array['organizations','persons','lead_sources','disqualification_reasons','leads',
  'labels','record_labels','custom_field_defs','notes','timeline_events']) t;
select ok(not has_function_privilege('anon', 'public.record_ref(text,uuid)', 'execute'), 'anon sem execute em record_ref');
select ok(not has_function_privilege('authenticated', 'public.guard_record_update()', 'execute'), 'trigger guard sem execute');
select ok(has_function_privilege('authenticated', 'public.can_read_record(text,uuid)', 'execute'), 'authenticated executa can_read_record');

select * from finish();
rollback;
