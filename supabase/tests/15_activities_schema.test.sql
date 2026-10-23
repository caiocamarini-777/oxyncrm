begin;
select plan(19);

select has_table('public', t, t || ' existe')
from unnest(array['activity_types','activity_channels','activity_outcomes','activities','notifications']) t;

insert into companies (id, name, slug) values
  ('00000000-0000-4000-8000-0000000000d1', 'Volt Teste', 'tst-volt'),
  ('00000000-0000-4000-8000-0000000000d2', 'Naia Teste', 'tst-naia');
insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-0000000000c1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tst-admin@oxyn.test', '{"full_name":"admin"}');
insert into persons (id, company_id, owner_id, full_name) values
  ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000c1', 'tst-pessoa');

-- Os seeds de empresa nova já criaram tipos e canais; ids fixos para os testes
update activity_types set id = '00000000-0000-4000-8000-0000000000b1'
  where company_id = '00000000-0000-4000-8000-0000000000d1' and name = 'Ligação';
update activity_channels set id = '00000000-0000-4000-8000-0000000000b2'
  where company_id = '00000000-0000-4000-8000-0000000000d1' and name = 'Telefone';
update activity_channels set id = '00000000-0000-4000-8000-0000000000b3'
  where company_id = '00000000-0000-4000-8000-0000000000d2' and name = 'Telefone';
update activity_outcomes set id = '00000000-0000-4000-8000-0000000000b4'
  where company_id = '00000000-0000-4000-8000-0000000000d1' and name = 'Conversa realizada';

-- Checks de integridade (23514)
select throws_ok($$ insert into activities (company_id, owner_id, type_id, channel_id, subject, due_at) values
  ('00000000-0000-4000-8000-0000000000d1','00000000-0000-4000-8000-0000000000c1','00000000-0000-4000-8000-0000000000b1','00000000-0000-4000-8000-0000000000b2','A', now()) $$,
  '23514', null, 'atividade sem vínculo é rejeitada');
select throws_ok($$ insert into activities (company_id, owner_id, type_id, channel_id, subject, due_at, person_id, done) values
  ('00000000-0000-4000-8000-0000000000d1','00000000-0000-4000-8000-0000000000c1','00000000-0000-4000-8000-0000000000b1','00000000-0000-4000-8000-0000000000b2','A', now(),'00000000-0000-4000-8000-0000000000a1', true) $$,
  '23514', null, 'done sem completed_at é rejeitado');
select throws_ok($$ insert into activities (company_id, owner_id, type_id, channel_id, subject, due_at, person_id, done, completed_at, outcome_id, meeting_outcome) values
  ('00000000-0000-4000-8000-0000000000d1','00000000-0000-4000-8000-0000000000c1','00000000-0000-4000-8000-0000000000b1','00000000-0000-4000-8000-0000000000b2','A', now(),'00000000-0000-4000-8000-0000000000a1', true, now(), '00000000-0000-4000-8000-0000000000b4', 'held') $$,
  '23514', null, 'resultado e resultado de reunião juntos são rejeitados');
select throws_ok($$ insert into activities (company_id, owner_id, type_id, channel_id, subject, due_at, person_id, meeting_outcome) values
  ('00000000-0000-4000-8000-0000000000d1','00000000-0000-4000-8000-0000000000c1','00000000-0000-4000-8000-0000000000b1','00000000-0000-4000-8000-0000000000b2','A', now(),'00000000-0000-4000-8000-0000000000a1', 'x') $$,
  '23514', null, 'meeting_outcome desconhecido é rejeitado');
select lives_ok($$ insert into activities (company_id, owner_id, type_id, channel_id, subject, due_at, person_id) values
  ('00000000-0000-4000-8000-0000000000d1','00000000-0000-4000-8000-0000000000c1','00000000-0000-4000-8000-0000000000b1','00000000-0000-4000-8000-0000000000b2','A', now(),'00000000-0000-4000-8000-0000000000a1') $$,
  'atividade válida é aceita');

-- Mesma empresa
select throws_ok($$ insert into activities (company_id, owner_id, type_id, channel_id, subject, due_at, person_id) values
  ('00000000-0000-4000-8000-0000000000d1','00000000-0000-4000-8000-0000000000c1','00000000-0000-4000-8000-0000000000b1','00000000-0000-4000-8000-0000000000b3','A', now(),'00000000-0000-4000-8000-0000000000a1') $$,
  null, 'OXYN_CROSS_COMPANY', 'atividade não usa canal de outra empresa');

-- Seeds de empresa nova
insert into companies (id, name, slug) values ('00000000-0000-4000-8000-0000000000d3', 'Nova Teste', 'tst-nova');
select is((select count(*) from activity_types where company_id = '00000000-0000-4000-8000-0000000000d3'), 5::bigint, 'empresa nova recebe 5 tipos');
select is((select count(*) from activity_types where company_id = '00000000-0000-4000-8000-0000000000d3' and is_meeting), 1::bigint, 'um tipo é reunião');
select is((select count(*) from activity_channels where company_id = '00000000-0000-4000-8000-0000000000d3'), 7::bigint, 'empresa nova recebe 7 canais');
select is((select count(*) from activity_channels where company_id = '00000000-0000-4000-8000-0000000000d3' and is_legacy and not active), 1::bigint, 'um canal legado inativo');
select is((select count(*) from activity_outcomes where company_id = '00000000-0000-4000-8000-0000000000d3'), 6::bigint, 'empresa nova recebe 6 resultados');
select is((select count(*) from activity_outcomes where company_id = '00000000-0000-4000-8000-0000000000d3' and books_meeting), 1::bigint, 'um resultado agenda reunião');

-- Realtime e privilégios
select ok(exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications'),
  'notifications está na publicação supabase_realtime');
select is((select count(*) from unnest(array['activity_types','activity_channels','activity_outcomes','activities','notifications']) t
  where has_table_privilege('authenticated', 'public.' || t, 'TRUNCATE')),
  0::bigint, 'authenticated não tem TRUNCATE nas 5 tabelas');

select * from finish();
rollback;
