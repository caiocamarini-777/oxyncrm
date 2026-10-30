begin;
select plan(16);

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
create function pg_temp.detail_of(stmt text) returns text language plpgsql as $$
declare d text;
begin
  execute stmt;
  return 'sem erro';
exception when others then
  get stacked diagnostics d = pg_exception_detail;
  return d;
end $$;
grant execute on function pg_temp.as_user(uuid), pg_temp.as_pg(), pg_temp.detail_of(text) to public;

insert into companies (id, name, slug) values
  ('00000000-0000-4000-8000-0000000000d1', 'Volt Teste', 'tst-volt'),
  ('00000000-0000-4000-8000-0000000000d2', 'Naia Teste', 'tst-naia');

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-0000000000c1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tst-admin@oxyn.test', '{"full_name":"admin"}'),
  ('00000000-0000-4000-8000-0000000000c2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tst-ana@oxyn.test', '{"full_name":"ana"}'),
  ('00000000-0000-4000-8000-0000000000c4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tst-caio@oxyn.test', '{"full_name":"caio"}'),
  ('00000000-0000-4000-8000-0000000000c5', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tst-dani@oxyn.test', '{"full_name":"dani"}'),
  ('00000000-0000-4000-8000-0000000000c6', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tst-eva@oxyn.test', '{"full_name":"eva"}');
update profiles set is_super_admin = true where id = '00000000-0000-4000-8000-0000000000c1';

insert into roles (id, name, description, permissions) values
  ('00000000-0000-4000-8000-0000000000e1', 'tst-Equipe', 'teste', '{"visibility":{"leads":"team","deals":"team","persons":"team","organizations":"team","activities":"team"},"actions":{"create":true,"edit":true,"delete":false,"export":false,"reassign_owner":false},"settings":{"manage_pipelines":false,"manage_custom_fields":false,"manage_products":false,"view_reports":true,"create_dashboards":true,"share_dashboards":false}}'::jsonb),
  ('00000000-0000-4000-8000-0000000000e3', 'tst-Gestor', 'teste', '{"visibility":{"leads":"company","deals":"company","persons":"company","organizations":"company","activities":"company"},"actions":{"create":true,"edit":true,"delete":true,"export":true,"reassign_owner":true},"settings":{"manage_pipelines":true,"manage_custom_fields":true,"manage_products":true,"view_reports":true,"create_dashboards":true,"share_dashboards":true}}'::jsonb),
  ('00000000-0000-4000-8000-0000000000e5', 'tst-Leitor', 'teste', '{"visibility":{"leads":"company","deals":"company","persons":"company","organizations":"company","activities":"company"},"actions":{"create":false,"edit":true,"delete":false,"export":false,"reassign_owner":false},"settings":{"manage_pipelines":false,"manage_custom_fields":false,"manage_products":false,"view_reports":true,"create_dashboards":false,"share_dashboards":false}}'::jsonb);
insert into memberships (user_id, company_id, role_id) values
  ('00000000-0000-4000-8000-0000000000c2', '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000e1'),
  ('00000000-0000-4000-8000-0000000000c4', '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000e3'),
  ('00000000-0000-4000-8000-0000000000c6', '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000e5'),
  ('00000000-0000-4000-8000-0000000000c5', '00000000-0000-4000-8000-0000000000d2', '00000000-0000-4000-8000-0000000000e3');

insert into pipelines (id, company_id, name) values
  ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000d1', 'tst-funil-1'),
  ('00000000-0000-4000-8000-0000000000a2', '00000000-0000-4000-8000-0000000000d1', 'tst-funil-2'),
  ('00000000-0000-4000-8000-0000000000a3', '00000000-0000-4000-8000-0000000000d2', 'tst-funil-naia');
insert into stages (id, pipeline_id, company_id, name, position, required_fields) values
  ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000d1', 'tst-etapa-exige', 0, '{expected_close_date,contract,cf:porte}'),
  ('00000000-0000-4000-8000-0000000000b2', '00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000d1', 'tst-etapa-2', 1, '{}'),
  ('00000000-0000-4000-8000-0000000000b3', '00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000d1', 'tst-etapa-3', 2, '{}'),
  ('00000000-0000-4000-8000-0000000000b4', '00000000-0000-4000-8000-0000000000a2', '00000000-0000-4000-8000-0000000000d1', 'tst-etapa-outro-funil', 0, '{}'),
  ('00000000-0000-4000-8000-0000000000b5', '00000000-0000-4000-8000-0000000000a3', '00000000-0000-4000-8000-0000000000d2', 'tst-etapa-naia', 0, '{}'),
  ('00000000-0000-4000-8000-0000000000b6', '00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000d1', 'tst-etapa-produtos', 3, '{person_id,estimated_value,products}'),
  ('00000000-0000-4000-8000-0000000000b7', '00000000-0000-4000-8000-0000000000a3', '00000000-0000-4000-8000-0000000000d2', 'tst-etapa-naia-exige', 1, '{expected_close_date}');
insert into custom_field_defs (company_id, entity, key, label, type) values
  ('00000000-0000-4000-8000-0000000000d1', 'deals', 'porte', 'Porte', 'text');
insert into products (id, company_id, name, kind, active) values
  ('00000000-0000-4000-8000-0000000000a4', '00000000-0000-4000-8000-0000000000d1', 'tst-recorrente', 'recurring', true),
  ('00000000-0000-4000-8000-0000000000a5', '00000000-0000-4000-8000-0000000000d1', 'tst-implantacao', 'setup', true),
  ('00000000-0000-4000-8000-0000000000a6', '00000000-0000-4000-8000-0000000000d1', 'tst-inativo', 'recurring', false),
  ('00000000-0000-4000-8000-0000000000a9', '00000000-0000-4000-8000-0000000000d2', 'tst-naia-inativo', 'setup', false);
insert into lost_reasons (id, company_id, name) values ('00000000-0000-4000-8000-0000000000a7', '00000000-0000-4000-8000-0000000000d1', 'tst-motivo');
insert into disqualification_reasons (id, company_id, name) values ('00000000-0000-4000-8000-0000000000a8', '00000000-0000-4000-8000-0000000000d1', 'tst-desq');
insert into labels (id, company_id, name, color) values
  ('00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-0000000000d1', 'tst-l1', 'teal'),
  ('00000000-0000-4000-8000-0000000000f2', '00000000-0000-4000-8000-0000000000d1', 'tst-l2', 'blue');
insert into organizations (id, company_id, owner_id, name) values ('00000000-0000-4000-8000-000000000b01', '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000c2', 'tst-org');
insert into persons (id, company_id, owner_id, full_name) values ('00000000-0000-4000-8000-000000000a01', '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000c2', 'tst-pessoa');


insert into service_categories (id, company_id, name) values
  ('00000000-0000-4000-8000-000000000ca1', '00000000-0000-4000-8000-0000000000d1', 'tst-cat-volt'),
  ('00000000-0000-4000-8000-000000000ca2', '00000000-0000-4000-8000-0000000000d2', 'tst-cat-naia');
update products set service_category_id = '00000000-0000-4000-8000-000000000ca1' where id = '00000000-0000-4000-8000-0000000000a4';
insert into deals (id, company_id, owner_id, title, pipeline_id, stage_id, setup_first_due, mrr_start, contract_months) values
  ('00000000-0000-4000-8000-000000000d11', '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000c4', 'tst-neg', '00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000b2', '2026-05-01', '2026-05-01', 12);

-- leitura isolada por empresa
select pg_temp.as_user('00000000-0000-4000-8000-0000000000c2');
select is((select count(*) from service_categories where name = 'tst-cat-volt'), 1::bigint, 'membro lê as categorias da própria empresa');
select is((select count(*) from service_categories where name = 'tst-cat-naia'), 0::bigint, 'membro não lê as de outra empresa');

-- escrita só do admin geral
select throws_ok($$ insert into service_categories (company_id, name) values ('00000000-0000-4000-8000-0000000000d1', 'tst-x') $$,
  '42501', null, 'quem não é admin não insere');
update service_categories set name = 'tst-hack' where id = '00000000-0000-4000-8000-000000000ca1';
select pg_temp.as_user('00000000-0000-4000-8000-0000000000c4');
update service_categories set name = 'tst-hack' where id = '00000000-0000-4000-8000-000000000ca1';
select pg_temp.as_pg();
select is((select name from service_categories where id = '00000000-0000-4000-8000-000000000ca1'), 'tst-cat-volt', 'quem não é admin (membro ou gestor) não atualiza');

select pg_temp.as_user('00000000-0000-4000-8000-0000000000c1');
select lives_ok($$ insert into service_categories (company_id, name) values ('00000000-0000-4000-8000-0000000000d1', 'tst-nova') $$, 'admin geral insere');
select throws_ok($$ insert into service_categories (company_id, name) values ('00000000-0000-4000-8000-0000000000d1', 'TST-NOVA') $$,
  '23505', null, 'nome duplicado ignorando maiúsculas falha');

-- seed
select lives_ok($$ select seed_service_categories('00000000-0000-4000-8000-0000000000d1') $$, 'seed roda');
select is((select count(*) from service_categories where company_id = '00000000-0000-4000-8000-0000000000d1'), 2::bigint, 'seed não age em empresa que já tem categorias');
delete from service_categories where company_id = '00000000-0000-4000-8000-0000000000d1' and id <> '00000000-0000-4000-8000-000000000ca1';
update products set service_category_id = null where company_id = '00000000-0000-4000-8000-0000000000d1';
delete from service_categories where company_id = '00000000-0000-4000-8000-0000000000d1';
select seed_service_categories('00000000-0000-4000-8000-0000000000d1');
select is((select count(*) from service_categories where company_id = '00000000-0000-4000-8000-0000000000d1'), 6::bigint, 'seed cria exatamente 6');
select seed_service_categories('00000000-0000-4000-8000-0000000000d1');
select is((select count(*) from service_categories where company_id = '00000000-0000-4000-8000-0000000000d1'), 6::bigint, 'segunda chamada continua com 6');
select pg_temp.as_user('00000000-0000-4000-8000-0000000000c2');
select throws_ok($$ select seed_service_categories('00000000-0000-4000-8000-0000000000d1') $$, '42501', null, 'seed exige admin geral');
select pg_temp.as_pg();

-- herança da categoria do produto no item
insert into service_categories (id, company_id, name) values ('00000000-0000-4000-8000-000000000ca3', '00000000-0000-4000-8000-0000000000d1', 'tst-cat-prod');
update products set service_category_id = '00000000-0000-4000-8000-000000000ca3' where id = '00000000-0000-4000-8000-0000000000a4';
insert into deal_items (id, deal_id, company_id, product_id, quantity, unit_price) values
  ('00000000-0000-4000-8000-000000000e01', '00000000-0000-4000-8000-000000000d11', '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000a4', 1, 100);
select is((select service_category_id from deal_items where id = '00000000-0000-4000-8000-000000000e01'), '00000000-0000-4000-8000-000000000ca3'::uuid, 'item herda a categoria do produto');

-- mesma empresa
select throws_ok($$ update deals set service_category_id = '00000000-0000-4000-8000-000000000ca2' where id = '00000000-0000-4000-8000-000000000d11' $$,
  'P0001', 'OXYN_CROSS_COMPANY', 'categoria de outra empresa em deals é rejeitada');
select throws_ok($$ update products set service_category_id = '00000000-0000-4000-8000-000000000ca2' where id = '00000000-0000-4000-8000-0000000000a4' $$,
  'P0001', 'OXYN_CROSS_COMPANY', 'categoria de outra empresa em products é rejeitada');
select throws_ok($$ update deal_items set service_category_id = '00000000-0000-4000-8000-000000000ca2' where id = '00000000-0000-4000-8000-000000000e01' $$,
  'P0001', 'OXYN_CROSS_COMPANY', 'categoria de outra empresa em deal_items é rejeitada');

-- restrict
select throws_ok($$ delete from service_categories where id = '00000000-0000-4000-8000-000000000ca3' $$,
  '23503', null, 'excluir categoria usada por produto falha');

select * from finish();
rollback;
