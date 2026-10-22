begin;
select plan(13);

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



insert into leads (id, company_id, owner_id, title, created_by) values
  ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000c2', 'L1', '00000000-0000-4000-8000-0000000000c2'), ('00000000-0000-4000-8000-0000000000a2', '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000c2', 'L2', '00000000-0000-4000-8000-0000000000c2'), ('00000000-0000-4000-8000-0000000000a5', '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000c2', 'L3', '00000000-0000-4000-8000-0000000000c2');
insert into leads (id, company_id, owner_id, title, created_by) values ('00000000-0000-4000-8000-0000000000a6', '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000c3', 'L6', '00000000-0000-4000-8000-0000000000c3');
insert into persons (id, company_id, owner_id, full_name) values ('00000000-0000-4000-8000-0000000000a3', '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000c2', 'tst-p2');
insert into activities (id,company_id,owner_id,created_by,type_id,channel_id,subject,due_at,lead_id) values ('00000000-0000-4000-8000-000000000b01','00000000-0000-4000-8000-0000000000d1','00000000-0000-4000-8000-0000000000c2','00000000-0000-4000-8000-0000000000c2',(select id from activity_types where company_id='00000000-0000-4000-8000-0000000000d1' limit 1),(select id from activity_channels where company_id='00000000-0000-4000-8000-0000000000d1' limit 1),'s',now(),'00000000-0000-4000-8000-0000000000a1');
insert into activities (id,company_id,owner_id,created_by,type_id,channel_id,subject,due_at,lead_id,person_id) values ('00000000-0000-4000-8000-000000000b02','00000000-0000-4000-8000-0000000000d1','00000000-0000-4000-8000-0000000000c2','00000000-0000-4000-8000-0000000000c2',(select id from activity_types where company_id='00000000-0000-4000-8000-0000000000d1' limit 1),(select id from activity_channels where company_id='00000000-0000-4000-8000-0000000000d1' limit 1),'s',now(),'00000000-0000-4000-8000-0000000000a2','00000000-0000-4000-8000-0000000000a3');
insert into activities (id,company_id,owner_id,created_by,type_id,channel_id,subject,due_at,lead_id) values ('00000000-0000-4000-8000-000000000b03','00000000-0000-4000-8000-0000000000d1','00000000-0000-4000-8000-0000000000c2','00000000-0000-4000-8000-0000000000c2',(select id from activity_types where company_id='00000000-0000-4000-8000-0000000000d1' limit 1),(select id from activity_channels where company_id='00000000-0000-4000-8000-0000000000d1' limit 1),'s',now(),'00000000-0000-4000-8000-0000000000a5');
insert into activities (id,company_id,owner_id,created_by,type_id,channel_id,subject,due_at,lead_id) values ('00000000-0000-4000-8000-000000000b04','00000000-0000-4000-8000-0000000000d1','00000000-0000-4000-8000-0000000000c3','00000000-0000-4000-8000-0000000000c3',(select id from activity_types where company_id='00000000-0000-4000-8000-0000000000d1' limit 1),(select id from activity_channels where company_id='00000000-0000-4000-8000-0000000000d1' limit 1),'s',now(),'00000000-0000-4000-8000-0000000000a6');

insert into notifications (id, user_id, company_id, kind, activity_id, title, due_at) overriding system value values
  (900011, '00000000-0000-4000-8000-0000000000c3', '00000000-0000-4000-8000-0000000000d1', 'activity_reminder', '00000000-0000-4000-8000-000000000b04', 'Lembrete', now());

-- purga: único vínculo
select lives_ok($$ select purge_records_internal('leads', array['00000000-0000-4000-8000-0000000000a1']::uuid[]) $$, 'purga de lead que é único vínculo não falha');
select is((select count(*) from activities where id = '00000000-0000-4000-8000-000000000b01'), 0::bigint, 'atividade de vínculo único é removida');
-- purga: outro vínculo sobrevive
select lives_ok($$ select purge_records_internal('leads', array['00000000-0000-4000-8000-0000000000a2']::uuid[]) $$, 'purga de lead com atividade de dois vínculos');
select is((select lead_id from activities where id = '00000000-0000-4000-8000-000000000b02'), null::uuid, 'atividade sobrevive com lead_id nulo');
select is((select person_id from activities where id = '00000000-0000-4000-8000-000000000b02'), '00000000-0000-4000-8000-0000000000a3'::uuid, 'o outro vínculo permanece');
-- purge_trash
update leads set deleted_at = now() - interval '40 days' where id = '00000000-0000-4000-8000-0000000000a5';
select lives_ok($$ select purge_trash() $$, 'purge_trash com atividade de vínculo único');
select is((select count(*) from activities where id = '00000000-0000-4000-8000-000000000b03'), 0::bigint, 'purge_trash removeu a atividade órfã');

-- booked_by
select pg_temp.as_user('00000000-0000-4000-8000-0000000000c3');
select throws_ok($$ insert into activities (company_id, owner_id, type_id, channel_id, subject, due_at, lead_id, booked_by_activity_id)
  select '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000c3', type_id, channel_id, 'b', now(), '00000000-0000-4000-8000-0000000000a6', '00000000-0000-4000-8000-000000000b02' from activities where id = '00000000-0000-4000-8000-000000000b04' $$,
  'P0001', 'OXYN_LINK_FORBIDDEN', 'bruno não aponta booked_by para atividade que não lê');
select lives_ok($$ insert into activities (company_id, owner_id, type_id, channel_id, subject, due_at, lead_id, booked_by_activity_id)
  select '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000c3', type_id, channel_id, 'b', now(), '00000000-0000-4000-8000-0000000000a6', '00000000-0000-4000-8000-000000000b04' from activities where id = '00000000-0000-4000-8000-000000000b04' $$,
  'bruno aponta booked_by para atividade que lê');
select throws_ok($$ update activities set booked_by_activity_id = '00000000-0000-4000-8000-000000000b02' where id = '00000000-0000-4000-8000-000000000b04' $$,
  'P0001', 'OXYN_LINK_FORBIDDEN', 'bruno não troca booked_by para atividade ilegível');
-- notificações
select is((select count(*) from notifications where id = 900011), 1::bigint, 'usuário ativo vê a própria notificação');
select throws_ok($$ update notifications set title = 'x' where id = 900011 $$, 'P0001', 'OXYN_FORBIDDEN_FIELD', 'só read_at muda');
select pg_temp.as_pg();
update profiles set active = false where id = '00000000-0000-4000-8000-0000000000c3';
select pg_temp.as_user('00000000-0000-4000-8000-0000000000c3');
select is((select count(*) from notifications where id = 900011), 0::bigint, 'usuário desativado não vê notificações');

select * from finish();
rollback;
