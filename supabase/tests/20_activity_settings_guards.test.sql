begin;
select plan(8);

insert into companies (id, name, slug) values
  ('00000000-0000-4000-8000-0000000000d1', 'Volt Teste', 'tst-volt');
-- seed_company_activities roda no insert: 1 tipo reunião, 1 resultado que agenda, 1 canal legado inativo.

select throws_ok(
  $$update activity_types set active = false where company_id = '00000000-0000-4000-8000-0000000000d1' and is_meeting$$,
  'P0001', 'OXYN_LAST_MEETING_TYPE', 'não desativa o único tipo reunião');
select throws_ok(
  $$update activity_types set is_meeting = false where company_id = '00000000-0000-4000-8000-0000000000d1' and is_meeting$$,
  'P0001', 'OXYN_LAST_MEETING_TYPE', 'não desmarca o único tipo reunião');
select throws_ok(
  $$delete from activity_types where company_id = '00000000-0000-4000-8000-0000000000d1' and is_meeting$$,
  'P0001', 'OXYN_LAST_MEETING_TYPE', 'não exclui o único tipo reunião');
insert into activity_types (id, company_id, name, is_meeting)
  values ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000d1', 'tst-Visita', true);
select lives_ok(
  $$update activity_types set active = false where company_id = '00000000-0000-4000-8000-0000000000d1' and name = 'Reunião'$$,
  'com outro tipo reunião ativo, desativa');

select throws_ok(
  $$update activity_outcomes set active = false where company_id = '00000000-0000-4000-8000-0000000000d1' and books_meeting$$,
  'P0001', 'OXYN_LAST_BOOKING_OUTCOME', 'não desativa o único resultado que agenda');
select throws_ok(
  $$update activity_channels set active = true where company_id = '00000000-0000-4000-8000-0000000000d1' and is_legacy$$,
  'P0001', 'OXYN_LEGACY_CHANNEL', 'canal legado não ativa');
select throws_ok(
  $$update companies set settings = '{"lead_next_activity_rule":"x"}' where id = '00000000-0000-4000-8000-0000000000d1'$$,
  'P0001', 'OXYN_INVALID_INPUT', 'regra inválida');
select lives_ok(
  $$update companies set settings = '{"lead_next_activity_rule":"require"}' where id = '00000000-0000-4000-8000-0000000000d1'$$,
  'regra válida');

select * from finish();
rollback;
