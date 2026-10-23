begin;
select plan(9);

create function pg_temp.as_user(u uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;
grant execute on function pg_temp.as_user(uuid) to public;

insert into companies (id, name, slug) values ('00000000-0000-4000-8000-0000000000d1', 'Volt Teste', 'tst-volt');
insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-0000000000c1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tst-admin@oxyn.test', '{"full_name":"admin"}'),
  ('00000000-0000-4000-8000-0000000000c2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tst-ana@oxyn.test', '{"full_name":"ana"}');
update profiles set is_super_admin = true where id = '00000000-0000-4000-8000-0000000000c1';

select pg_temp.as_user('00000000-0000-4000-8000-0000000000c1');

select throws_ok(
  $$update activity_channels set is_legacy = false where company_id = '00000000-0000-4000-8000-0000000000d1' and name = 'Não informado'$$,
  'P0001', 'OXYN_LEGACY_CHANNEL', 'não desmarca is_legacy (passo 1 do bypass)');
select throws_ok(
  $$update activity_channels set name = 'Outro' where company_id = '00000000-0000-4000-8000-0000000000d1' and is_legacy$$,
  'P0001', 'OXYN_LEGACY_CHANNEL', 'não renomeia canal legado');
select throws_ok(
  $$update activity_channels set is_legacy = true where company_id = '00000000-0000-4000-8000-0000000000d1' and name = 'WhatsApp'$$,
  'P0001', 'OXYN_LEGACY_CHANNEL', 'não marca canal comum como legado');
select throws_ok(
  $$update activity_channels set active = true where company_id = '00000000-0000-4000-8000-0000000000d1' and is_legacy$$,
  'P0001', 'OXYN_LEGACY_CHANNEL', 'não ativa legado');

select lives_ok(
  $$select set_lead_next_activity_rule('00000000-0000-4000-8000-0000000000d1', 'suggest')$$, 'rpc grava a regra');
select is((select settings->>'lead_next_activity_rule' from companies where id = '00000000-0000-4000-8000-0000000000d1'),
  'suggest', 'regra gravada');
select throws_ok(
  $$select set_lead_next_activity_rule('00000000-0000-4000-8000-0000000000d1', 'x')$$,
  'P0001', 'OXYN_INVALID_INPUT', 'regra inválida');
select throws_ok(
  $$select set_lead_next_activity_rule('00000000-0000-4000-8000-0000000000ff', 'off')$$,
  'P0001', 'OXYN_NOT_FOUND', 'empresa inexistente');

select pg_temp.as_user('00000000-0000-4000-8000-0000000000c2');
select throws_ok(
  $$select set_lead_next_activity_rule('00000000-0000-4000-8000-0000000000d1', 'off')$$,
  'P0001', 'OXYN_NOT_FOUND', 'sem permissão: nenhuma linha muda');

select * from finish();
rollback;
