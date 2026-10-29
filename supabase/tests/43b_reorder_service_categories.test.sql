begin;
select plan(6);

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
grant execute on function pg_temp.as_user(uuid), pg_temp.as_pg() to public;

insert into companies (id, name, slug) values
  ('00000000-0000-4000-8000-0000000000d1', 'Volt Teste', 'tst-volt'),
  ('00000000-0000-4000-8000-0000000000d2', 'Naia Teste', 'tst-naia');
insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-0000000000c1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tst-admin@oxyn.test', '{"full_name":"admin"}'),
  ('00000000-0000-4000-8000-0000000000c2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tst-ana@oxyn.test', '{"full_name":"ana"}');
update profiles set is_super_admin = true where id = '00000000-0000-4000-8000-0000000000c1';
insert into service_categories (id, company_id, name, position) values
  ('00000000-0000-4000-8000-000000000ca1', '00000000-0000-4000-8000-0000000000d1', 'tst-a', 0),
  ('00000000-0000-4000-8000-000000000ca2', '00000000-0000-4000-8000-0000000000d1', 'tst-b', 1),
  ('00000000-0000-4000-8000-000000000ca3', '00000000-0000-4000-8000-0000000000d1', 'tst-c', 2),
  ('00000000-0000-4000-8000-000000000ca4', '00000000-0000-4000-8000-0000000000d2', 'tst-naia', 0);

select pg_temp.as_user('00000000-0000-4000-8000-0000000000c2');
select throws_ok($$ select reorder_service_categories('00000000-0000-4000-8000-0000000000d1',
  array['00000000-0000-4000-8000-000000000ca3','00000000-0000-4000-8000-000000000ca2','00000000-0000-4000-8000-000000000ca1']::uuid[]) $$,
  '42501', null, 'quem não é admin geral não reordena');

select pg_temp.as_user('00000000-0000-4000-8000-0000000000c1');
select lives_ok($$ select reorder_service_categories('00000000-0000-4000-8000-0000000000d1',
  array['00000000-0000-4000-8000-000000000ca3','00000000-0000-4000-8000-000000000ca1','00000000-0000-4000-8000-000000000ca2']::uuid[]) $$,
  'admin geral reordena');
select is((select array_agg(name order by position) from service_categories where company_id = '00000000-0000-4000-8000-0000000000d1'),
  array['tst-c','tst-a','tst-b'], 'a nova ordem foi gravada');
select throws_ok($$ select reorder_service_categories('00000000-0000-4000-8000-0000000000d1',
  array['00000000-0000-4000-8000-000000000ca3','00000000-0000-4000-8000-000000000ca1']::uuid[]) $$,
  '22023', 'OXYN_CATEGORIES_MISMATCH', 'lista incompleta é rejeitada');
select throws_ok($$ select reorder_service_categories('00000000-0000-4000-8000-0000000000d1',
  array['00000000-0000-4000-8000-000000000ca3','00000000-0000-4000-8000-000000000ca1','00000000-0000-4000-8000-000000000ca4']::uuid[]) $$,
  '22023', 'OXYN_CATEGORIES_MISMATCH', 'id de outra empresa é rejeitado');
select is((select position from service_categories where id = '00000000-0000-4000-8000-000000000ca4'), 0, 'categoria de outra empresa intacta');

select * from finish();
rollback;
