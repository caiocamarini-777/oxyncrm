begin;
select plan(11);

create function pg_temp.as_user(u uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;
create function pg_temp.as_anon() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  perform set_config('role', 'anon', true);
end $$;
create function pg_temp.as_pg() returns void language plpgsql as $$
begin
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
end $$;
grant execute on function pg_temp.as_user(uuid), pg_temp.as_anon(), pg_temp.as_pg() to public;

insert into companies (id, name, slug) values
  ('00000000-0000-4000-8000-0000000000d1', 'Volt Teste', 'tst-volt'),
  ('00000000-0000-4000-8000-0000000000d2', 'Naia Teste', 'tst-naia');

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-0000000000c2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tst-ana@oxyn.test', '{"full_name":"tst Ana"}'),
  ('00000000-0000-4000-8000-0000000000c3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tst-bruno@oxyn.test', '{"full_name":"tst Bruno"}'),
  ('00000000-0000-4000-8000-0000000000c5', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tst-dani@oxyn.test', '{"full_name":"tst Dani"}'),
  ('00000000-0000-4000-8000-0000000000c7', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tst-fora@oxyn.test', '{"full_name":"tst Fora"}');

insert into roles (id, name, description, permissions) values
  ('00000000-0000-4000-8000-0000000000e1', 'tst-Proprio', 'teste', '{"visibility":{"leads":"own","deals":"own","persons":"own","organizations":"own","activities":"own"},"actions":{"create":true,"edit":true,"delete":false,"export":false,"reassign_owner":false},"settings":{"manage_pipelines":false,"manage_custom_fields":false,"manage_products":false,"view_reports":true,"create_dashboards":true,"share_dashboards":false}}'::jsonb);

insert into memberships (user_id, company_id, role_id) values
  ('00000000-0000-4000-8000-0000000000c2', '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000e1'),
  ('00000000-0000-4000-8000-0000000000c3', '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000e1'),
  ('00000000-0000-4000-8000-0000000000c5', '00000000-0000-4000-8000-0000000000d2', '00000000-0000-4000-8000-0000000000e1');

insert into organizations (id, company_id, owner_id, name) values
  ('00000000-0000-4000-8000-000000000b01', '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000c3', 'tst Org Bruno'),
  ('00000000-0000-4000-8000-000000000b02', '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000c3', 'tst Org Lixo'),
  ('00000000-0000-4000-8000-000000000b04', '00000000-0000-4000-8000-0000000000d2', '00000000-0000-4000-8000-0000000000c5', 'tst Org Dani');
update organizations set deleted_at = now() where id = '00000000-0000-4000-8000-000000000b02';

select pg_temp.as_user('00000000-0000-4000-8000-0000000000c2');
select is((select count(*) from organizations where id = '00000000-0000-4000-8000-000000000b01'), 0::bigint, 'ana não lê a organização do bruno');
select is((select name from organization_label('00000000-0000-4000-8000-000000000b01')), 'tst Org Bruno', 'nome devolvido a quem tem acesso à empresa');
select is((select trashed from organization_label('00000000-0000-4000-8000-000000000b01')), false, 'organização ativa não está na lixeira');
select is((select name from organization_label('00000000-0000-4000-8000-000000000b02')), 'tst Org Lixo', 'nome devolvido também para organização na lixeira');
select is((select trashed from organization_label('00000000-0000-4000-8000-000000000b02')), true, 'organização na lixeira é marcada');
select is((select count(*) from organization_label('00000000-0000-4000-8000-000000000b04')), 0::bigint, 'null para empresa diferente');
select is((select count(*) from organization_label('00000000-0000-4000-8000-000000000999')), 0::bigint, 'null para id inexistente');

select pg_temp.as_user('00000000-0000-4000-8000-0000000000c7');
select is((select count(*) from organization_label('00000000-0000-4000-8000-000000000b01')), 0::bigint, 'null para usuário sem vínculo com a empresa');

select pg_temp.as_user('00000000-0000-4000-8000-0000000000c5');
select is((select count(*) from organization_label('00000000-0000-4000-8000-000000000b01')), 0::bigint, 'membro de outra empresa não recebe o nome');

select pg_temp.as_anon();
select throws_ok($$ select * from organization_label('00000000-0000-4000-8000-000000000b01') $$, '42501', null, 'anon não executa');

select pg_temp.as_pg();
select ok(has_function_privilege('authenticated', 'public.organization_label(uuid)', 'execute'), 'authenticated executa');

select * from finish();
rollback;
