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

insert into companies (id, name, slug) values ('00000000-0000-4000-8000-0000000000d1', 'Reord Teste', 'tst-reord');
insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-0000000000c1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tst-radmin@oxyn.test', '{"full_name":"admin"}'),
  ('00000000-0000-4000-8000-0000000000c3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tst-rbruno@oxyn.test', '{"full_name":"bruno"}');
update profiles set is_super_admin = true where id = '00000000-0000-4000-8000-0000000000c1';
insert into memberships (user_id, company_id, role_id)
  select '00000000-0000-4000-8000-0000000000c3', '00000000-0000-4000-8000-0000000000d1', id from roles where is_system;

insert into pipelines (id, company_id, name) values ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000d1', 'tst-Funil');
insert into stages (id, pipeline_id, company_id, name, position) values
  ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000d1', 'A', 0),
  ('00000000-0000-4000-8000-0000000000b2', '00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000d1', 'B', 1),
  ('00000000-0000-4000-8000-0000000000b3', '00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000d1', 'C', 2);

select pg_temp.as_user('00000000-0000-4000-8000-0000000000c1');
select lives_ok($$select reorder_stages('00000000-0000-4000-8000-0000000000a1',
  array['00000000-0000-4000-8000-0000000000b3','00000000-0000-4000-8000-0000000000b1','00000000-0000-4000-8000-0000000000b2']::uuid[])$$, 'reordena');
select is((select array_agg(name order by position) from stages where pipeline_id = '00000000-0000-4000-8000-0000000000a1'), array['C','A','B'], 'nova ordem');

select throws_ok($$select reorder_stages('00000000-0000-4000-8000-0000000000a1',
  array['00000000-0000-4000-8000-0000000000b1','00000000-0000-4000-8000-0000000000b2']::uuid[])$$, '22023', 'OXYN_STAGES_MISMATCH', 'lista incompleta falha');
select throws_ok($$select reorder_stages('00000000-0000-4000-8000-0000000000a1',
  array['00000000-0000-4000-8000-0000000000b1','00000000-0000-4000-8000-0000000000b1','00000000-0000-4000-8000-0000000000b2']::uuid[])$$, '22023', 'OXYN_STAGES_MISMATCH', 'lista com repetição falha');

select pg_temp.as_user('00000000-0000-4000-8000-0000000000c3');
select throws_ok($$select reorder_stages('00000000-0000-4000-8000-0000000000a1',
  array['00000000-0000-4000-8000-0000000000b1','00000000-0000-4000-8000-0000000000b2','00000000-0000-4000-8000-0000000000b3']::uuid[])$$, '42501', null, 'sem manage_pipelines falha');
select pg_temp.as_pg();
select is((select array_agg(name order by position) from stages where pipeline_id = '00000000-0000-4000-8000-0000000000a1'), array['C','A','B'], 'nada mudou');

select * from finish();
rollback;
