begin;
select plan(52);

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
  ('00000000-0000-4000-8000-0000000000c1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tst-admin@oxyn.test', '{"full_name":"tst Admin"}'),
  ('00000000-0000-4000-8000-0000000000c2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tst-ana@oxyn.test', '{"full_name":"tst Ana"}'),
  ('00000000-0000-4000-8000-0000000000c3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tst-bruno@oxyn.test', '{"full_name":"tst Bruno"}'),
  ('00000000-0000-4000-8000-0000000000c4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tst-caio@oxyn.test', '{"full_name":"tst Caio"}'),
  ('00000000-0000-4000-8000-0000000000c5', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tst-dani@oxyn.test', '{"full_name":"tst Dani"}');
update profiles set is_super_admin = true where id = '00000000-0000-4000-8000-0000000000c1';

insert into roles (id, name, description, permissions) values
  ('00000000-0000-4000-8000-0000000000e1', 'tst-Equipe', 'teste', '{"visibility":{"leads":"team","deals":"team","persons":"team","organizations":"team","activities":"team"},"actions":{"create":true,"edit":true,"delete":false,"export":false,"reassign_owner":false},"settings":{"manage_pipelines":false,"manage_custom_fields":false,"manage_products":false,"view_reports":true,"create_dashboards":true,"share_dashboards":false}}'::jsonb),
  ('00000000-0000-4000-8000-0000000000e3', 'tst-Gestor', 'teste', '{"visibility":{"leads":"company","deals":"company","persons":"company","organizations":"company","activities":"company"},"actions":{"create":true,"edit":true,"delete":true,"export":true,"reassign_owner":true},"settings":{"manage_pipelines":true,"manage_custom_fields":true,"manage_products":true,"view_reports":true,"create_dashboards":true,"share_dashboards":true}}'::jsonb);

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-0000000000c6', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tst-eva@oxyn.test', '{"full_name":"tst Eva"}');
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

insert into persons (id, company_id, owner_id, full_name, emails, phones) values
  ('00000000-0000-4000-8000-000000000a01', '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000c2', 'Volt Ana Pessoa', '[{"value":"Ana@Volt.com"}]', '[{"value":"(11) 99999-0000"}]'),
  ('00000000-0000-4000-8000-000000000a02', '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000c3', 'Volt Bruno Pessoa', '[{"value":"bruno@volt.com"}]', '[]'),
  ('00000000-0000-4000-8000-000000000a03', '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000c2', 'Lixo', '[{"value":"lixo@volt.com"}]', '[]'),
  ('00000000-0000-4000-8000-000000000a04', '00000000-0000-4000-8000-0000000000d2', '00000000-0000-4000-8000-0000000000c5', 'Volt Dani Pessoa', '[{"value":"dani@volt.com"}]', '[]');
update persons set deleted_at = now() where id = '00000000-0000-4000-8000-000000000a03';
insert into organizations (id, company_id, owner_id, name, cnpj, domain) values
  ('00000000-0000-4000-8000-000000000b01', '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000c2', 'Volt Ana Org', '11222333000181', 'volt.com'),
  ('00000000-0000-4000-8000-000000000b02', '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000c3', 'Volt Bruno Org', null, null),
  ('00000000-0000-4000-8000-000000000b04', '00000000-0000-4000-8000-0000000000d2', '00000000-0000-4000-8000-0000000000c5', 'Volt Dani Org', null, null);
insert into leads (id, company_id, owner_id, title) values
  ('00000000-0000-4000-8000-000000000c02', '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000c3', 'Volt Lead Bruno'),
  ('00000000-0000-4000-8000-000000000c03', '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000c2', 'Volt Lead Ana'),
  ('00000000-0000-4000-8000-000000000c04', '00000000-0000-4000-8000-0000000000d2', '00000000-0000-4000-8000-0000000000c5', 'Volt Lead Dani');
insert into labels (id, company_id, name, color) values
  ('00000000-0000-4000-8000-000000000d01', '00000000-0000-4000-8000-0000000000d1', 'tst-Quente', 'red');

-- check_duplicates
select pg_temp.as_user('00000000-0000-4000-8000-0000000000c3');
select results_eq($$ select matched_on, owner_name, record_id from check_duplicates('00000000-0000-4000-8000-0000000000d1', 'persons', array['ANA@volt.com']) $$,
  $$ values ('email'::text, 'tst Ana'::text, null::uuid) $$, 'bruno vê duplicidade por e-mail sem record_id');
select results_eq($$ select matched_on from check_duplicates('00000000-0000-4000-8000-0000000000d1', 'persons', '{}', array['(11) 99999-0000']) $$,
  $$ values ('phone'::text) $$, 'telefone comparado só por dígitos');
select is((select count(*) from check_duplicates('00000000-0000-4000-8000-0000000000d1', 'persons', array['lixo@volt.com'])), 0::bigint, 'pessoa na lixeira não conta');
select is((select count(*) from check_duplicates('00000000-0000-4000-8000-0000000000d1', 'persons', array['bruno@volt.com'], '{}', null, null, '00000000-0000-4000-8000-000000000a02')), 0::bigint, 'p_exclude ignora o próprio registro');
select results_eq($$ select matched_on, record_id from check_duplicates('00000000-0000-4000-8000-0000000000d1', 'persons', array['bruno@volt.com']) $$,
  $$ values ('email'::text, '00000000-0000-4000-8000-000000000a02'::uuid) $$, 'bruno vê record_id do que pode ler');
select is((select count(*) from check_duplicates('00000000-0000-4000-8000-0000000000d2', 'persons', array['dani@volt.com'])), 0::bigint, 'bruno sem acesso à empresa: zero linhas');
select throws_ok($$ select * from check_duplicates('00000000-0000-4000-8000-0000000000d1', 'deals', array['a@b.com']) $$, null, null, 'entidade inválida falha');
select results_eq($$ select matched_on, record_id from check_duplicates('00000000-0000-4000-8000-0000000000d1', 'organizations', '{}', '{}', '11222333000181') $$,
  $$ values ('cnpj'::text, null::uuid) $$, 'organização sem permissão de leitura: record_id nulo');
select pg_temp.as_user('00000000-0000-4000-8000-0000000000c4');
select results_eq($$ select record_id from check_duplicates('00000000-0000-4000-8000-0000000000d1', 'persons', array['ana@volt.com']) $$,
  $$ values ('00000000-0000-4000-8000-000000000a01'::uuid) $$, 'caio (empresa toda) recebe record_id');
select results_eq($$ select matched_on from check_duplicates('00000000-0000-4000-8000-0000000000d1', 'organizations', '{}', '{}', '11222333000181', 'volt.com') order by 1 $$,
  $$ values ('cnpj'::text), ('domain'::text) $$, 'organização: cnpj e domínio');
select pg_temp.as_user('00000000-0000-4000-8000-0000000000c5');
select is((select count(*) from check_duplicates('00000000-0000-4000-8000-0000000000d1', 'persons', array['ana@volt.com'])), 0::bigint, 'dani sem acesso a tst-volt: zero linhas');

-- linha do tempo
select pg_temp.as_user('00000000-0000-4000-8000-0000000000c4');
insert into leads (id, company_id, owner_id, title) values ('00000000-0000-4000-8000-000000000c10', '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000c4', 'Lead timeline');
select pg_temp.as_pg();
select results_eq($$ select kind, actor_id from timeline_events where record_id = '00000000-0000-4000-8000-000000000c10' $$,
  $$ values ('created'::text, '00000000-0000-4000-8000-0000000000c4'::uuid) $$, 'criar lead gera created com actor');
select pg_temp.as_user('00000000-0000-4000-8000-0000000000c3');
select is((select count(*) from timeline_events where record_id = '00000000-0000-4000-8000-000000000c10'), 0::bigint, 'bruno não lê eventos de lead de caio');
select pg_temp.as_user('00000000-0000-4000-8000-0000000000c4');
select lives_ok($$ select reassign_record('leads', '00000000-0000-4000-8000-000000000c10', '00000000-0000-4000-8000-0000000000c2') $$, 'caio reatribui');
select pg_temp.as_pg();
select results_eq($$ select data->>'from', data->>'to' from timeline_events where record_id = '00000000-0000-4000-8000-000000000c10' and kind = 'owner_changed' $$,
  $$ values ('00000000-0000-4000-8000-0000000000c4'::text, '00000000-0000-4000-8000-0000000000c2'::text) $$, 'owner_changed com from/to');
select pg_temp.as_user('00000000-0000-4000-8000-0000000000c4');
update leads set status = 'disqualified',
  disqualification_reason_id = (select id from disqualification_reasons where company_id = '00000000-0000-4000-8000-0000000000d1' limit 1)
  where id = '00000000-0000-4000-8000-000000000c10';
update leads set title = 'Lead timeline 2' where id = '00000000-0000-4000-8000-000000000c10';
insert into notes (company_id, entity, record_id, body) values ('00000000-0000-4000-8000-0000000000d1', 'leads', '00000000-0000-4000-8000-000000000c10', 'oi');
insert into record_labels (label_id, entity, record_id) values ('00000000-0000-4000-8000-000000000d01', 'leads', '00000000-0000-4000-8000-000000000c10');
delete from record_labels where record_id = '00000000-0000-4000-8000-000000000c10';
update leads set deleted_at = now() where id = '00000000-0000-4000-8000-000000000c10';
update leads set deleted_at = null where id = '00000000-0000-4000-8000-000000000c10';
select pg_temp.as_pg();
select results_eq($$ select kind from timeline_events where record_id = '00000000-0000-4000-8000-000000000c10' order by id $$,
  $$ values ('created'::text), ('owner_changed'), ('status_changed'), ('updated'), ('note_added'), ('label_added'), ('label_removed'), ('trashed'), ('restored') $$,
  'sequência completa de eventos');
select is((select data->>'to' from timeline_events where record_id = '00000000-0000-4000-8000-000000000c10' and kind = 'status_changed'), 'disqualified', 'status_changed to');
select isnt((select data->>'reason_id' from timeline_events where record_id = '00000000-0000-4000-8000-000000000c10' and kind = 'status_changed'), null, 'status_changed com reason_id');
select is((select data->'fields' from timeline_events where record_id = '00000000-0000-4000-8000-000000000c10' and kind = 'updated'), '["title"]'::jsonb, 'updated lista só nomes de colunas, sem updated_at');
select is((select data->>'name' from timeline_events where record_id = '00000000-0000-4000-8000-000000000c10' and kind = 'label_added'), 'tst-Quente', 'label_added com nome');
select isnt((select data->>'note_id' from timeline_events where record_id = '00000000-0000-4000-8000-000000000c10' and kind = 'note_added'), null, 'note_added com note_id');
insert into custom_field_defs (company_id, entity, key, label, type) values ('00000000-0000-4000-8000-0000000000d1', 'organizations', 'obs', 'Obs', 'text');
update organizations set custom_fields = '{"obs":"a"}' where id = '00000000-0000-4000-8000-000000000b02';
select is((select data->'fields' from timeline_events where record_id = '00000000-0000-4000-8000-000000000b02' and kind = 'updated'), '["custom_fields"]'::jsonb, 'custom_fields vira um único nome');

-- busca
select pg_temp.as_user('00000000-0000-4000-8000-0000000000c3');
select results_eq($$ select entity, record_id from global_search('volt') order by entity, record_id $$,
  $$ values ('leads'::text, '00000000-0000-4000-8000-000000000c02'::uuid),
            ('organizations', '00000000-0000-4000-8000-000000000b02'),
            ('persons', '00000000-0000-4000-8000-000000000a02') $$, 'bruno busca só o que vê');
select is((select count(*) from global_search('v')), 0::bigint, 'menos de 2 caracteres devolve vazio');
select is((select count(*) from global_search('__')), 0::bigint, '_ é literal');
select is((select count(*) from global_search('%%')), 0::bigint, '% é literal');
select results_eq($$ select entity, title, subtitle from global_search('bruno@volt', '00000000-0000-4000-8000-0000000000d1') $$,
  $$ values ('persons'::text, 'Volt Bruno Pessoa'::text, 'bruno@volt.com'::text) $$, 'busca por e-mail com subtítulo');
select results_eq($$ select subtitle from global_search('Volt Lead Bruno') $$, $$ values ('open'::text) $$, 'subtítulo do lead é o status');
select pg_temp.as_user('00000000-0000-4000-8000-0000000000c4');
select is((select count(*) from global_search('volt', '00000000-0000-4000-8000-0000000000d1', 1) where entity = 'persons'), 1::bigint, 'p_limit por entidade');
select pg_temp.as_user('00000000-0000-4000-8000-0000000000c5');
select is((select count(*) from global_search('volt', '00000000-0000-4000-8000-0000000000d1')), 0::bigint, 'dani não vê empresa sem acesso');

-- lixeira
select pg_temp.as_user('00000000-0000-4000-8000-0000000000c3');
select throws_ok($$ select purge_trash() $$, '42501', null, 'authenticated não executa purge_trash');
select pg_temp.as_pg();
insert into persons (id, company_id, owner_id, full_name, deleted_at) values
  ('00000000-0000-4000-8000-000000000a21', '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000c2', 'Velha', now() - interval '31 days'),
  ('00000000-0000-4000-8000-000000000a22', '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000c2', 'Recente', now() - interval '29 days');
insert into leads (id, company_id, owner_id, title, deleted_at) values
  ('00000000-0000-4000-8000-000000000c31', '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000c2', 'Lead velho', now() - interval '31 days');
insert into organizations (id, company_id, owner_id, name, deleted_at) values
  ('00000000-0000-4000-8000-000000000b31', '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000c2', 'Org velha', now() - interval '31 days');
insert into notes (company_id, entity, record_id, body, created_by) values ('00000000-0000-4000-8000-0000000000d1', 'leads', '00000000-0000-4000-8000-000000000c31', 'n', '00000000-0000-4000-8000-0000000000c2');
insert into record_labels (label_id, entity, record_id) values ('00000000-0000-4000-8000-000000000d01', 'leads', '00000000-0000-4000-8000-000000000c31');
select ok(purge_trash() >= 1, 'purge_trash devolve contagem');
select is((select count(*) from persons where id = '00000000-0000-4000-8000-000000000a21'), 0::bigint, 'registro de 31 dias apagado');
select is((select count(*) from leads where id = '00000000-0000-4000-8000-000000000c31'), 0::bigint, 'lead antigo apagado');
select is((select count(*) from organizations where id = '00000000-0000-4000-8000-000000000b31'), 0::bigint, 'organização antiga apagada');
select is((select count(*) from record_labels where record_id = '00000000-0000-4000-8000-000000000c31'), 0::bigint, 'purge remove etiquetas do registro');
select is((select count(*) from notes where record_id = '00000000-0000-4000-8000-000000000c31'), 0::bigint, 'purge remove notas do registro');
select is((select count(*) from timeline_events where record_id in ('00000000-0000-4000-8000-000000000c31','00000000-0000-4000-8000-000000000b31')), 0::bigint, 'purge remove timeline do registro');
select is((select count(*) from persons where id = '00000000-0000-4000-8000-000000000a22'), 1::bigint, 'registro de 29 dias mantido');
select ok(not has_function_privilege('service_role', 'public.purge_trash()', 'execute'), 'service_role sem execute');
select is((select count(*) from cron.job where jobname = 'oxyn-purge-trash'), 1::bigint, 'job agendado');

-- purge_record
select pg_temp.as_pg();
insert into persons (id, company_id, owner_id, full_name) values
  ('00000000-0000-4000-8000-000000000a41', '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000c2', 'Viva'),
  ('00000000-0000-4000-8000-000000000a42', '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000c2', 'Lixeira');
update persons set deleted_at = now() where id = '00000000-0000-4000-8000-000000000a42';
insert into notes (company_id, entity, record_id, body, created_by) values
  ('00000000-0000-4000-8000-0000000000d1', 'persons', '00000000-0000-4000-8000-000000000a42', 'n', '00000000-0000-4000-8000-0000000000c2');
insert into record_labels (label_id, entity, record_id) values ('00000000-0000-4000-8000-000000000d01', 'persons', '00000000-0000-4000-8000-000000000a42');
select ok(
  (select count(*) from timeline_events where record_id = '00000000-0000-4000-8000-000000000a42') > 0,
  'registro na lixeira tem timeline');
select pg_temp.as_user('00000000-0000-4000-8000-0000000000c3');
select throws_ok($$ select purge_record('persons', '00000000-0000-4000-8000-000000000a42') $$, '42501', null, 'não admin não executa purge_record');
select pg_temp.as_user('00000000-0000-4000-8000-0000000000c1');
select throws_ok($$ select purge_record('persons', '00000000-0000-4000-8000-000000000a41') $$, 'P0001', 'OXYN_TRASH_FORBIDDEN', 'registro fora da lixeira não é apagado');
select throws_ok($$ select purge_record('persons', '00000000-0000-4000-8000-000000000999') $$, 'P0001', 'OXYN_NOT_FOUND', 'registro inexistente');
select throws_ok($$ select purge_record('profiles', '00000000-0000-4000-8000-000000000a42') $$, 'P0001', 'OXYN_INVALID_ENTITY', 'entidade inválida');
select lives_ok($$ select purge_record('persons', '00000000-0000-4000-8000-000000000a42') $$, 'admin apaga registro da lixeira');
select pg_temp.as_pg();
select is((select count(*) from persons where id = '00000000-0000-4000-8000-000000000a42'), 0::bigint, 'registro apagado');
select is((select count(*) from notes where record_id = '00000000-0000-4000-8000-000000000a42'), 0::bigint, 'notas apagadas');
select is((select count(*) from record_labels where record_id = '00000000-0000-4000-8000-000000000a42'), 0::bigint, 'etiquetas apagadas');
select is((select count(*) from timeline_events where record_id = '00000000-0000-4000-8000-000000000a42'), 0::bigint, 'timeline apagada');
select is((select count(*) from persons where id = '00000000-0000-4000-8000-000000000a41'), 1::bigint, 'registro vivo intacto');

select * from finish();
rollback;
