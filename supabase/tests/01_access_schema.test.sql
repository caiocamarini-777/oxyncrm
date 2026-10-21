begin;
select plan(19);

select has_table('public'::name, t::name) from unnest(array['companies','profiles','roles','teams','team_members','memberships','audit_log']) as t;

select throws_ok(
  $$insert into companies (id, name, slug) values ('00000000-0000-4000-8000-0000000000a1', 'Todas', 'todas')$$,
  '23514');
select throws_ok(
  $$insert into companies (id, name, slug) values ('00000000-0000-4000-8000-0000000000a2', 'Volt SA', 'Volt SA')$$,
  '23514');
select throws_ok(
  $$insert into companies (id, name, slug, cnpj) values ('00000000-0000-4000-8000-0000000000a3', 'Volt', 'tst-cnpj', '11.222.333/0001-81')$$,
  '23514');
select lives_ok(
  $$insert into companies (id, name, slug, cnpj) values ('00000000-0000-4000-8000-0000000000a4', 'Volt', 'tst-volt', '11222333000181')$$);

select ok(is_valid_permissions('{"visibility":{"leads":"own","deals":"own","persons":"own","organizations":"own","activities":"own"},"actions":{"create":true,"edit":true,"delete":false,"export":false,"reassign_owner":false},"settings":{"manage_pipelines":false,"manage_custom_fields":false,"manage_products":false,"view_reports":true,"create_dashboards":true,"share_dashboards":false}}'::jsonb));
select ok(not is_valid_permissions('{"visibility":{"leads":"all","deals":"own","persons":"own","organizations":"own","activities":"own"},"actions":{"create":true,"edit":true,"delete":false,"export":false,"reassign_owner":false},"settings":{"manage_pipelines":false,"manage_custom_fields":false,"manage_products":false,"view_reports":true,"create_dashboards":true,"share_dashboards":false}}'::jsonb));
select ok(not is_valid_permissions('{"visibility":{"leads":"own","deals":"own","persons":"own","organizations":"own","activities":"own"},"actions":{"create":true,"edit":true,"delete":false,"export":false,"reassign_owner":false},"settings":{"manage_pipelines":false,"manage_custom_fields":false,"manage_products":false,"view_reports":true,"create_dashboards":true}}'::jsonb));
select ok(not is_valid_permissions('{"visibility":{"leads":"own","deals":"own","persons":"own","organizations":"own","activities":"own"},"actions":{"create":true,"edit":true,"delete":false,"export":false,"reassign_owner":false,"foo":true},"settings":{"manage_pipelines":false,"manage_custom_fields":false,"manage_products":false,"view_reports":true,"create_dashboards":true,"share_dashboards":false}}'::jsonb));
select ok(not is_valid_permissions('{"visibility":{"leads":"own","deals":"own","persons":"own","organizations":"own","activities":"own"},"actions":{"create":"true","edit":true,"delete":false,"export":false,"reassign_owner":false},"settings":{"manage_pipelines":false,"manage_custom_fields":false,"manage_products":false,"view_reports":true,"create_dashboards":true,"share_dashboards":false}}'::jsonb));

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data)
values ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'tst-ana@oxyn.test', '{"full_name":"Ana Teste"}');

select results_eq(
  $$select full_name, is_super_admin, active from profiles where id = '00000000-0000-4000-8000-0000000000b1'$$,
  $$values ('Ana Teste'::text, false, true)$$);

select is((select count(*) from roles where is_system), 1::bigint);

insert into memberships (user_id, company_id, role_id)
select '00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000a4', id
from roles where is_system;

select throws_ok(
  $$insert into memberships (user_id, company_id, role_id)
    select '00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000a4', id from roles where is_system$$,
  '23505');

select * from finish();
rollback;
