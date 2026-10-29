begin;
select plan(18);

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
  ('00000000-0000-4000-8000-0000000000d1', 'Fin Teste', 'tst-fin');

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-0000000000c1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tst-admin@oxyn.test', '{"full_name":"admin"}'),
  ('00000000-0000-4000-8000-0000000000c2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tst-nokeys@oxyn.test', '{"full_name":"nokeys"}'),
  ('00000000-0000-4000-8000-0000000000c3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tst-viewer@oxyn.test', '{"full_name":"viewer"}'),
  ('00000000-0000-4000-8000-0000000000c4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tst-manager@oxyn.test', '{"full_name":"manager"}'),
  ('00000000-0000-4000-8000-0000000000c5', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tst-seller@oxyn.test', '{"full_name":"seller"}'),
  ('00000000-0000-4000-8000-0000000000c6', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tst-outsider@oxyn.test', '{"full_name":"outsider"}');
update profiles set is_super_admin = true where id = '00000000-0000-4000-8000-0000000000c1';

-- Papel com só as 6 chaves antigas continua válido.
select ok(public.is_valid_permissions('{"visibility":{"leads":"own","deals":"own","persons":"own","organizations":"own","activities":"own"},"actions":{"create":true,"edit":true,"delete":false,"export":false,"reassign_owner":false},"settings":{"manage_pipelines":false,"manage_custom_fields":false,"manage_products":false,"view_reports":true,"create_dashboards":true,"share_dashboards":false}}'::jsonb),
  'papel com as 6 chaves antigas é válido');
select ok(public.is_valid_permissions('{"visibility":{"leads":"own","deals":"own","persons":"own","organizations":"own","activities":"own"},"actions":{"create":true,"edit":true,"delete":false,"export":false,"reassign_owner":false},"settings":{"manage_pipelines":false,"manage_custom_fields":false,"manage_products":false,"view_reports":true,"create_dashboards":true,"share_dashboards":false,"view_finance":true}}'::jsonb),
  'papel com view_finance é válido');
select ok(not public.is_valid_permissions('{"visibility":{"leads":"own","deals":"own","persons":"own","organizations":"own","activities":"own"},"actions":{"create":true,"edit":true,"delete":false,"export":false,"reassign_owner":false},"settings":{"manage_pipelines":false,"manage_custom_fields":false,"manage_products":false,"view_reports":true,"create_dashboards":true,"share_dashboards":false,"foo":true}}'::jsonb),
  'chave desconhecida é inválida');
select ok(not public.is_valid_permissions('{"visibility":{"leads":"own","deals":"own","persons":"own","organizations":"own","activities":"own"},"actions":{"create":true,"edit":true,"delete":false,"export":false,"reassign_owner":false},"settings":{"manage_pipelines":false,"manage_custom_fields":false,"manage_products":false,"view_reports":true,"create_dashboards":true,"share_dashboards":false,"view_finance":"sim"}}'::jsonb),
  'chave de finanças não booleana é inválida');

insert into roles (id, name, description, permissions) values
  ('00000000-0000-4000-8000-0000000000e1', 'tst-SemFin', 't', '{"visibility":{"leads":"own","deals":"own","persons":"own","organizations":"own","activities":"own"},"actions":{"create":true,"edit":true,"delete":false,"export":false,"reassign_owner":false},"settings":{"manage_pipelines":false,"manage_custom_fields":false,"manage_products":false,"view_reports":true,"create_dashboards":true,"share_dashboards":false}}'::jsonb),
  ('00000000-0000-4000-8000-0000000000e2', 'tst-VerFin', 't', '{"visibility":{"leads":"own","deals":"own","persons":"own","organizations":"own","activities":"own"},"actions":{"create":true,"edit":true,"delete":false,"export":false,"reassign_owner":false},"settings":{"manage_pipelines":false,"manage_custom_fields":false,"manage_products":false,"view_reports":true,"create_dashboards":true,"share_dashboards":false,"view_finance":true}}'::jsonb),
  ('00000000-0000-4000-8000-0000000000e3', 'tst-GerFin', 't', '{"visibility":{"leads":"own","deals":"own","persons":"own","organizations":"own","activities":"own"},"actions":{"create":true,"edit":true,"delete":false,"export":false,"reassign_owner":false},"settings":{"manage_pipelines":false,"manage_custom_fields":false,"manage_products":false,"view_reports":true,"create_dashboards":true,"share_dashboards":false,"manage_finance":true}}'::jsonb),
  ('00000000-0000-4000-8000-0000000000e4', 'tst-Vendedor', 't', '{"visibility":{"leads":"own","deals":"own","persons":"own","organizations":"own","activities":"own"},"actions":{"create":true,"edit":true,"delete":false,"export":false,"reassign_owner":false},"settings":{"manage_pipelines":false,"manage_custom_fields":false,"manage_products":false,"view_reports":true,"create_dashboards":true,"share_dashboards":false,"register_sales":true}}'::jsonb);
insert into memberships (user_id, company_id, role_id) values
  ('00000000-0000-4000-8000-0000000000c2', '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000e1'),
  ('00000000-0000-4000-8000-0000000000c3', '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000e2'),
  ('00000000-0000-4000-8000-0000000000c4', '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000e3'),
  ('00000000-0000-4000-8000-0000000000c5', '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000e4');

-- Desligado: falso até para o admin geral.
select pg_temp.as_user('00000000-0000-4000-8000-0000000000c1');
select is(public.can_finance('00000000-0000-4000-8000-0000000000d1', 'view'), false, 'desligado: admin geral não vê');
select is(public.can_finance('00000000-0000-4000-8000-0000000000d1', 'sell'), false, 'desligado: admin geral não vende');

-- Liga como admin geral (a trigger semeia categorias de serviço, que exige super admin).
select pg_temp.as_user('00000000-0000-4000-8000-0000000000c1');
update companies set finance_enabled = true where id = '00000000-0000-4000-8000-0000000000d1';

select pg_temp.as_user('00000000-0000-4000-8000-0000000000c1');
select is(public.can_finance('00000000-0000-4000-8000-0000000000d1', 'manage'), true, 'ligado: admin geral gerencia');

select pg_temp.as_user('00000000-0000-4000-8000-0000000000c2');
select is(public.can_finance('00000000-0000-4000-8000-0000000000d1', 'view'), false, 'sem chaves: não vê');

select pg_temp.as_user('00000000-0000-4000-8000-0000000000c3');
select is(public.can_finance('00000000-0000-4000-8000-0000000000d1', 'view'), true, 'view_finance: view');
select is(public.can_finance('00000000-0000-4000-8000-0000000000d1', 'manage'), false, 'view_finance: não gerencia');

select pg_temp.as_user('00000000-0000-4000-8000-0000000000c4');
select is(public.can_finance('00000000-0000-4000-8000-0000000000d1', 'view'), true, 'manage_finance: view');
select is(public.can_finance('00000000-0000-4000-8000-0000000000d1', 'manage'), true, 'manage_finance: manage');
select is(public.can_finance('00000000-0000-4000-8000-0000000000d1', 'sell'), true, 'manage_finance: sell');

select pg_temp.as_user('00000000-0000-4000-8000-0000000000c5');
select is(public.can_finance('00000000-0000-4000-8000-0000000000d1', 'sell'), true, 'register_sales: sell');
select is(public.can_finance('00000000-0000-4000-8000-0000000000d1', 'view'), false, 'register_sales: não vê');
select is(public.can_finance('00000000-0000-4000-8000-0000000000d1', 'manage'), false, 'register_sales: não gerencia');

select pg_temp.as_user('00000000-0000-4000-8000-0000000000c6');
select is(public.can_finance('00000000-0000-4000-8000-0000000000d1', 'view'), false, 'não membro: falso');

-- Não admin não consegue ligar/desligar (RLS: 0 linhas afetadas).
select pg_temp.as_user('00000000-0000-4000-8000-0000000000c4');
update companies set finance_enabled = false where id = '00000000-0000-4000-8000-0000000000d1';
select pg_temp.as_pg();
select is((select finance_enabled from companies where id = '00000000-0000-4000-8000-0000000000d1'), true,
  'não admin não altera finance_enabled');

select * from finish();
rollback;
