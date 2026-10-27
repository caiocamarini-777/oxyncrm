begin;
select plan(68);

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


update activity_types set id = '00000000-0000-4000-8000-0000000000b1' where company_id = '00000000-0000-4000-8000-0000000000d1' and name = 'Ligação';
update activity_types set id = '00000000-0000-4000-8000-0000000000b5' where company_id = '00000000-0000-4000-8000-0000000000d2' and name = 'Ligação';
update activity_channels set id = '00000000-0000-4000-8000-0000000000b2' where company_id = '00000000-0000-4000-8000-0000000000d1' and name = 'Telefone';
update activity_channels set id = '00000000-0000-4000-8000-0000000000b3' where company_id = '00000000-0000-4000-8000-0000000000d2' and name = 'Telefone';
update activity_outcomes set id = '00000000-0000-4000-8000-0000000000b4' where company_id = '00000000-0000-4000-8000-0000000000d1' and name = 'Conversa realizada';
insert into leads (id, company_id, owner_id, title, created_by) values
  ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000c2', 'Lead Ana', '00000000-0000-4000-8000-0000000000c2'),
  ('00000000-0000-4000-8000-0000000000a2', '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000c3', 'Lead Bruno', '00000000-0000-4000-8000-0000000000c3');
insert into persons (id, company_id, owner_id, full_name) values
  ('00000000-0000-4000-8000-0000000000a3', '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000c2', 'tst-pessoa-ana'),
  ('00000000-0000-4000-8000-0000000000a4', '00000000-0000-4000-8000-0000000000d2', '00000000-0000-4000-8000-0000000000c5', 'tst-pessoa-dani');
insert into activities (id, company_id, owner_id, created_by, type_id, channel_id, subject, due_at, lead_id, person_id) values
  ('00000000-0000-4000-8000-000000000a01', '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000c3', '00000000-0000-4000-8000-0000000000c3', '00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000b2', 'Ativ Bruno', now(), '00000000-0000-4000-8000-0000000000a2', null),
  ('00000000-0000-4000-8000-000000000a02', '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000c2', '00000000-0000-4000-8000-0000000000c2', '00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000b2', 'Ativ Ana', now(), '00000000-0000-4000-8000-0000000000a1', null),
  ('00000000-0000-4000-8000-000000000a03', '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000c4', '00000000-0000-4000-8000-0000000000c4', '00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000b2', 'Ativ Caio', now(), null, '00000000-0000-4000-8000-0000000000a3'),
  ('00000000-0000-4000-8000-000000000a04', '00000000-0000-4000-8000-0000000000d2', '00000000-0000-4000-8000-0000000000c5', '00000000-0000-4000-8000-0000000000c5', '00000000-0000-4000-8000-0000000000b5', '00000000-0000-4000-8000-0000000000b3', 'Ativ Dani', now(), null, '00000000-0000-4000-8000-0000000000a4');
insert into notifications (id, user_id, company_id, kind, activity_id, title, due_at) overriding system value values
  (900001, '00000000-0000-4000-8000-0000000000c3', '00000000-0000-4000-8000-0000000000d1', 'activity_reminder', '00000000-0000-4000-8000-000000000a01', 'Lembrete bruno', now()),
  (900002, '00000000-0000-4000-8000-0000000000c2', '00000000-0000-4000-8000-0000000000d1', 'activity_reminder', '00000000-0000-4000-8000-000000000a02', 'Lembrete ana', now());

-- Como superusuário: vínculo e as demais regras

-- bruno (próprio)
select pg_temp.as_user('00000000-0000-4000-8000-0000000000c3');
select results_eq($$ select id from activities where company_id in ('00000000-0000-4000-8000-0000000000d1','00000000-0000-4000-8000-0000000000d2') $$,
  $$ values ('00000000-0000-4000-8000-000000000a01'::uuid) $$, 'bruno vê só a própria atividade');
select throws_ok($$ select * from record_ref('activities', '00000000-0000-4000-8000-000000000a01') $$, '42501', null, 'authenticated não executa record_ref');
select is(can_read_record('activities', '00000000-0000-4000-8000-000000000a01'), true, 'bruno lê a atividade dele');
select is(can_read_record('activities', '00000000-0000-4000-8000-000000000a02'), false, 'bruno não lê atividade de ana');
select lives_ok($$ insert into activities (id, company_id, owner_id, type_id, channel_id, subject, due_at, lead_id) values
  ('00000000-0000-4000-8000-000000000a05', '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000c3', '00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000b2', 'Nova do bruno', now(), '00000000-0000-4000-8000-0000000000a2') $$, 'bruno cria atividade ligada a lead que lê');
select throws_ok($$ insert into activities (company_id, owner_id, type_id, channel_id, subject, due_at, lead_id) values
  ('00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000c3', '00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000b2', 'Em lead alheio', now(), '00000000-0000-4000-8000-0000000000a1') $$, 'P0001', 'OXYN_LINK_FORBIDDEN', 'bruno não cria atividade ligada a lead que não lê');
select throws_ok($$ insert into activities (company_id, owner_id, type_id, channel_id, subject, due_at, lead_id, person_id) values
  ('00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000c3', '00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000b2', 'Um vínculo ruim', now(), '00000000-0000-4000-8000-0000000000a2', '00000000-0000-4000-8000-0000000000a3') $$, 'P0001', 'OXYN_LINK_FORBIDDEN', 'qualquer vínculo ilegível barra a criação');
select throws_ok($$ insert into activities (company_id, owner_id, type_id, channel_id, subject, due_at, lead_id) values
  ('00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000c2', '00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000b2', 'Para ana', now(), '00000000-0000-4000-8000-0000000000a2') $$, '42501', null, 'bruno não cria atividade para outro dono');
select throws_ok($$ insert into activities (company_id, owner_id, type_id, channel_id, subject, due_at, lead_id, created_by) values
  ('00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000c3', '00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000b2', 'Autor falso', now(), '00000000-0000-4000-8000-0000000000a2', '00000000-0000-4000-8000-0000000000c2') $$, '42501', null, 'insert não aceita created_by de outro');
select throws_ok($$ insert into activities (company_id, owner_id, type_id, channel_id, subject, due_at, lead_id, deleted_at) values
  ('00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000c3', '00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000b2', 'Na lixeira', now(), '00000000-0000-4000-8000-0000000000a2', now()) $$, '42501', null, 'insert não cria atividade já na lixeira');
select throws_ok($$ insert into activities (company_id, owner_id, type_id, channel_id, subject, due_at, person_id) values
  ('00000000-0000-4000-8000-0000000000d2', '00000000-0000-4000-8000-0000000000c3', '00000000-0000-4000-8000-0000000000b5', '00000000-0000-4000-8000-0000000000b3', 'Outra empresa', now(), '00000000-0000-4000-8000-0000000000a4') $$, 'P0001', 'OXYN_LINK_FORBIDDEN', 'bruno não cria atividade em empresa sem acesso (vínculo ilegível)');
select is(pg_temp.affected($q$update activities set subject = 'Ativ Bruno 2' where id = '00000000-0000-4000-8000-000000000a01'$q$), 1::bigint, 'bruno edita a própria atividade');
select is(pg_temp.affected($q$update activities set subject = 'x' where id = '00000000-0000-4000-8000-000000000a02'$q$), 0::bigint, 'bruno não edita atividade que não vê');
select lives_ok($$ select complete_activity('00000000-0000-4000-8000-000000000a01', '00000000-0000-4000-8000-0000000000b4') $$, 'bruno conclui a própria atividade');
select throws_ok($$ update activities set lead_id = '00000000-0000-4000-8000-0000000000a1' where id = '00000000-0000-4000-8000-000000000a01' $$, 'P0001', 'OXYN_LINK_FORBIDDEN', 'bruno não troca o vínculo para lead que não lê');
select throws_ok($$ update activities set person_id = '00000000-0000-4000-8000-0000000000a3' where id = '00000000-0000-4000-8000-000000000a05' $$, 'P0001', 'OXYN_LINK_FORBIDDEN', 'bruno não adiciona vínculo ilegível');
select throws_ok($$ update activities set owner_id = '00000000-0000-4000-8000-0000000000c2' where id = '00000000-0000-4000-8000-000000000a01' $$, 'P0001', 'OXYN_REASSIGN_FORBIDDEN', 'bruno não reatribui atividade');
select throws_ok($$ select reassign_record('activities', '00000000-0000-4000-8000-000000000a01', '00000000-0000-4000-8000-0000000000c2') $$, 'P0001', 'OXYN_REASSIGN_FORBIDDEN', 'bruno não reatribui via RPC');
select throws_ok($$ update activities set deleted_at = now() where id = '00000000-0000-4000-8000-000000000a01' $$, 'P0001', 'OXYN_TRASH_FORBIDDEN', 'bruno não manda para a lixeira');
select throws_ok($$ update activities set company_id = '00000000-0000-4000-8000-0000000000d2' where id = '00000000-0000-4000-8000-000000000a01' $$, 'P0001', 'OXYN_COMPANY_IMMUTABLE', 'empresa da atividade é imutável');
select throws_ok($$ update activities set created_by = '00000000-0000-4000-8000-0000000000c2' where id = '00000000-0000-4000-8000-000000000a01' $$, 'P0001', 'OXYN_FORBIDDEN_FIELD', 'created_by é imutável');
select is(pg_temp.affected($q$delete from activities where id = '00000000-0000-4000-8000-000000000a01'$q$), 0::bigint, 'bruno não exclui definitivamente');
-- configuração
select is((select count(*) from activity_types where company_id in ('00000000-0000-4000-8000-0000000000d1','00000000-0000-4000-8000-0000000000d2')), 5::bigint, 'bruno vê tipos só da empresa dele');
select is((select count(*) from activity_channels where company_id = '00000000-0000-4000-8000-0000000000d2'), 0::bigint, 'bruno não vê canais de outra empresa');
select is((select count(*) from activity_outcomes where company_id = '00000000-0000-4000-8000-0000000000d1'), 9::bigint, 'bruno vê resultados da empresa dele');
select throws_ok($$ insert into activity_types (company_id, name) values ('00000000-0000-4000-8000-0000000000d1', 'tst-tipo') $$, '42501', null, 'bruno não cria tipo');
select throws_ok($$ insert into activity_channels (company_id, name) values ('00000000-0000-4000-8000-0000000000d1', 'tst-canal') $$, '42501', null, 'bruno não cria canal');
select throws_ok($$ insert into activity_outcomes (company_id, name, classification) values ('00000000-0000-4000-8000-0000000000d1', 'tst-res', 'neutral') $$, '42501', null, 'bruno não cria resultado');
select is(pg_temp.affected($q$update activity_types set active = false where company_id = '00000000-0000-4000-8000-0000000000d1'$q$), 0::bigint, 'bruno não edita tipos');
-- notificações
select results_eq($$ select id from notifications where id in (900001, 900002) $$, $$ values (900001::bigint) $$, 'bruno vê só a própria notificação');
select is(pg_temp.affected($q$update notifications set read_at = now() where id = 900001$q$), 1::bigint, 'bruno marca a própria como lida');
select is(pg_temp.affected($q$update notifications set read_at = now() where id = 900002$q$), 0::bigint, 'bruno não marca a de outro');
select throws_ok($$ update notifications set title = 'x' where id = 900001 $$, 'P0001', 'OXYN_FORBIDDEN_FIELD', 'bruno só altera read_at');
select throws_ok($$ update notifications set user_id = '00000000-0000-4000-8000-0000000000c2' where id = 900001 $$, 'P0001', 'OXYN_FORBIDDEN_FIELD', 'bruno não passa a notificação adiante');
select throws_ok($$ insert into notifications (user_id, kind, title) values ('00000000-0000-4000-8000-0000000000c3', 'activity_reminder', 'x') $$, '42501', null, 'bruno não insere notificação');
select throws_ok($$ delete from notifications where id = 900001 $$, '42501', null, 'bruno não apaga notificação');

-- ana (equipe)
select pg_temp.as_pg();
select pg_temp.as_user('00000000-0000-4000-8000-0000000000c2');
select results_eq($$ select id from activities where company_id = '00000000-0000-4000-8000-0000000000d1' order by subject $$,
  $$ values ('00000000-0000-4000-8000-000000000a02'::uuid), ('00000000-0000-4000-8000-000000000a01'::uuid), ('00000000-0000-4000-8000-000000000a05'::uuid) $$, 'ana vê atividades dela e de bruno, não de caio');
select is(can_manage_company_lists('00000000-0000-4000-8000-0000000000d1'), false, 'ana não gerencia listas');
select throws_ok($$ insert into activity_types (company_id, name) values ('00000000-0000-4000-8000-0000000000d1', 'tst-tipo') $$, '42501', null, 'ana não cria tipo');
select throws_ok($$ update activities set owner_id = '00000000-0000-4000-8000-0000000000c3' where id = '00000000-0000-4000-8000-000000000a02' $$, 'P0001', 'OXYN_REASSIGN_FORBIDDEN', 'ana não reatribui');

-- eva (equipe com reatribuição)
select pg_temp.as_pg();
select pg_temp.as_user('00000000-0000-4000-8000-0000000000c6');
select lives_ok($$ select reassign_record('activities', '00000000-0000-4000-8000-000000000a01', '00000000-0000-4000-8000-0000000000c2') $$, 'eva reatribui atividade da equipe');

-- caio (gestor)
select pg_temp.as_pg();
select pg_temp.as_user('00000000-0000-4000-8000-0000000000c4');
select is((select count(*) from activities where id in ('00000000-0000-4000-8000-000000000a01','00000000-0000-4000-8000-000000000a02','00000000-0000-4000-8000-000000000a03','00000000-0000-4000-8000-000000000a04')), 3::bigint, 'caio vê todas as atividades da empresa dele e nenhuma de outra');
select is((select owner_id from activities where id = '00000000-0000-4000-8000-000000000a01'), '00000000-0000-4000-8000-0000000000c2'::uuid, 'reatribuição da eva valeu');
select lives_ok($$ select reassign_record('activities', '00000000-0000-4000-8000-000000000a02', '00000000-0000-4000-8000-0000000000c3') $$, 'caio reatribui via reassign_record');
select throws_ok($$ select reassign_record('activities', '00000000-0000-4000-8000-000000000a02', '00000000-0000-4000-8000-0000000000c5') $$, 'P0001', 'OXYN_OWNER_NOT_MEMBER', 'caio não reatribui para quem não é da empresa');
select lives_ok($$ insert into activities (id, company_id, owner_id, type_id, channel_id, subject, due_at, lead_id) values
  ('00000000-0000-4000-8000-000000000a06', '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000c2', '00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000b2', 'Caio para ana', now(), '00000000-0000-4000-8000-0000000000a1') $$, 'caio cria atividade para ana ligada a lead da ana');
select throws_ok($$ insert into activities (company_id, owner_id, type_id, channel_id, subject, due_at, lead_id) values
  ('00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000c5', '00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000b2', 'Para dani', now(), '00000000-0000-4000-8000-0000000000a1') $$, '42501', null, 'caio não cria atividade para quem não é da empresa');
select throws_ok($$ insert into activities (company_id, owner_id, type_id, channel_id, subject, due_at, person_id) values
  ('00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000c4', '00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000b2', 'Vínculo de outra empresa', now(), '00000000-0000-4000-8000-0000000000a4') $$, 'P0001', 'OXYN_LINK_FORBIDDEN', 'vínculo de outra empresa é barrado');
select is(can_manage_company_lists('00000000-0000-4000-8000-0000000000d1'), true, 'caio gerencia listas');
select lives_ok($$ insert into activity_types (company_id, name) values ('00000000-0000-4000-8000-0000000000d1', 'tst-tipo-caio') $$, 'caio cria tipo');
select lives_ok($$ insert into activity_channels (company_id, name) values ('00000000-0000-4000-8000-0000000000d1', 'tst-canal-caio') $$, 'caio cria canal');
select lives_ok($$ insert into activity_outcomes (company_id, name, classification) values ('00000000-0000-4000-8000-0000000000d1', 'tst-res-caio', 'neutral') $$, 'caio cria resultado');
select throws_ok($$ insert into activity_types (company_id, name) values ('00000000-0000-4000-8000-0000000000d2', 'tst-fora') $$, '42501', null, 'caio não cria tipo em outra empresa');
select is(pg_temp.affected($q$update activity_types set active = false where name = 'tst-tipo-caio'$q$), 1::bigint, 'caio edita tipo');
select is((select count(*) from notifications where id in (900001, 900002)), 0::bigint, 'nem o gestor vê notificação de outros');
-- lixeira
select is(pg_temp.affected($q$update activities set deleted_at = now() where id = '00000000-0000-4000-8000-000000000a03'$q$), 1::bigint, 'caio manda atividade para a lixeira');
select is((select count(*) from activities where id = '00000000-0000-4000-8000-000000000a03'), 1::bigint, 'caio ainda vê a atividade na lixeira');
select is(can_read_record('activities', '00000000-0000-4000-8000-000000000a03'), false, 'atividade na lixeira não é lida como registro ativo');
select is(pg_temp.affected($q$delete from activities where id = '00000000-0000-4000-8000-000000000a03'$q$), 0::bigint, 'caio não exclui definitivamente');
select throws_ok($$ select purge_record('activities', '00000000-0000-4000-8000-000000000a03') $$, '42501', null, 'caio não usa purge_record');

-- bruno não vê a lixeira
select pg_temp.as_pg();
select pg_temp.as_user('00000000-0000-4000-8000-0000000000c3');
select is((select count(*) from activities where id = '00000000-0000-4000-8000-000000000a03'), 0::bigint, 'bruno não vê atividade na lixeira');

-- dani (outra empresa)
select pg_temp.as_pg();
select pg_temp.as_user('00000000-0000-4000-8000-0000000000c5');
select results_eq($$ select id from activities where id in ('00000000-0000-4000-8000-000000000a01','00000000-0000-4000-8000-000000000a02','00000000-0000-4000-8000-000000000a03','00000000-0000-4000-8000-000000000a04') $$, $$ values ('00000000-0000-4000-8000-000000000a04'::uuid) $$, 'dani vê só atividade da empresa dela');
select is((select count(*) from activity_types where id = '00000000-0000-4000-8000-0000000000b1'), 0::bigint, 'dani não vê tipos de outra empresa');

-- admin geral: exclusão definitiva
select pg_temp.as_pg();
select pg_temp.as_user('00000000-0000-4000-8000-0000000000c1');
select throws_ok($$ select purge_record('activities', '00000000-0000-4000-8000-000000000a01') $$, 'P0001', 'OXYN_TRASH_FORBIDDEN', 'purge_record exige atividade na lixeira');
select lives_ok($$ select purge_record('activities', '00000000-0000-4000-8000-000000000a03') $$, 'admin exclui definitivamente atividade da lixeira');
select pg_temp.as_pg();
select is((select count(*) from activities where id = '00000000-0000-4000-8000-000000000a03'), 0::bigint, 'atividade foi removida');
select is(purge_records_internal('activities', array['00000000-0000-4000-8000-000000000a04']::uuid[]), 1, 'purge_records_internal aceita activities');
select is(has_function_privilege('authenticated', 'public.guard_activity_links()', 'execute'), false, 'authenticated não executa guard_activity_links');

select * from finish();
rollback;
