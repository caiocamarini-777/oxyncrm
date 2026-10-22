begin;
select plan(98);

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
  ('00000000-0000-4000-8000-0000000000b6', '00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000d1', 'tst-etapa-produtos', 3, '{person_id,estimated_value,products}');
insert into custom_field_defs (company_id, entity, key, label, type) values
  ('00000000-0000-4000-8000-0000000000d1', 'deals', 'porte', 'Porte', 'text');
insert into products (id, company_id, name, kind, active) values
  ('00000000-0000-4000-8000-0000000000a4', '00000000-0000-4000-8000-0000000000d1', 'tst-recorrente', 'recurring', true),
  ('00000000-0000-4000-8000-0000000000a5', '00000000-0000-4000-8000-0000000000d1', 'tst-implantacao', 'setup', true),
  ('00000000-0000-4000-8000-0000000000a6', '00000000-0000-4000-8000-0000000000d1', 'tst-inativo', 'recurring', false);
insert into lost_reasons (id, company_id, name) values ('00000000-0000-4000-8000-0000000000a7', '00000000-0000-4000-8000-0000000000d1', 'tst-motivo');
insert into disqualification_reasons (id, company_id, name) values ('00000000-0000-4000-8000-0000000000a8', '00000000-0000-4000-8000-0000000000d1', 'tst-desq');
insert into labels (id, company_id, name, color) values
  ('00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-0000000000d1', 'tst-l1', 'teal'),
  ('00000000-0000-4000-8000-0000000000f2', '00000000-0000-4000-8000-0000000000d1', 'tst-l2', 'blue');
insert into organizations (id, company_id, owner_id, name) values ('00000000-0000-4000-8000-000000000b01', '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000c2', 'tst-org');
insert into persons (id, company_id, owner_id, full_name) values ('00000000-0000-4000-8000-000000000a01', '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000c2', 'tst-pessoa');

-- A. algoritmo do cronograma ------------------------------------------------
select results_eq($$ select month, setup, mrr from build_revenue_schedule(30000, 3, '2026-03-01', 5000, '2026-04-01', 12) order by month limit 3 $$,
  $$ values ('2026-03-01'::date, 10000::numeric, 0::numeric), ('2026-04-01', 10000, 5000), ('2026-05-01', 10000, 5000) $$,
  'março a maio: setup em 3 parcelas e MRR a partir de abril');
select is((select count(*) from build_revenue_schedule(30000, 3, '2026-03-01', 5000, '2026-04-01', 12)), 13::bigint, '13 meses no total');
select results_eq($$ select month, setup, mrr from build_revenue_schedule(30000, 3, '2026-03-01', 5000, '2026-04-01', 12) order by month desc limit 1 $$,
  $$ values ('2027-03-01'::date, 0::numeric, 5000::numeric) $$, 'último mês só tem MRR');
select is((select sum(setup) from build_revenue_schedule(30000, 3, '2026-03-01', 5000, '2026-04-01', 12)), 30000::numeric, 'setup soma o total');
select is((select array_agg(setup order by month) from build_revenue_schedule(100, 3, '2026-03-01', 0, null, null)),
  array[33.33, 33.33, 33.34]::numeric[], 'resto vai para a última parcela');
select is((select count(*) from build_revenue_schedule(0, 1, null, 0, null, null)), 0::bigint, 'sem contrato, sem linhas');

-- B. cronograma no negócio ---------------------------------------------------
insert into deals (id, company_id, owner_id, title, pipeline_id, stage_id, setup_total, setup_installments, setup_first_due, mrr, mrr_start, contract_months) values
  ('00000000-0000-4000-8000-000000000d10', '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000c4', 'tst-neg-cronograma', '00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000b2', 30000, 3, '2026-03-01', 5000, '2026-04-01', 12);
select is((select count(*) from deal_revenue_schedule where deal_id = '00000000-0000-4000-8000-000000000d10'), 13::bigint, 'insert gera o cronograma');
update deals set contract_months = 6 where id = '00000000-0000-4000-8000-000000000d10';
select is((select count(*) from deal_revenue_schedule where deal_id = '00000000-0000-4000-8000-000000000d10'), 7::bigint, 'mudar condições regenera');
select is((select sum(setup) from deal_revenue_schedule where deal_id = '00000000-0000-4000-8000-000000000d10'), 30000::numeric, 'cronograma regenerado preserva o setup');
update deals set deleted_at = now() where id = '00000000-0000-4000-8000-000000000d10';
select is((select count(*) from deal_revenue_schedule where deal_id = '00000000-0000-4000-8000-000000000d10'), 0::bigint, 'lixeira zera o cronograma');
update deals set deleted_at = null where id = '00000000-0000-4000-8000-000000000d10';
select is((select count(*) from deal_revenue_schedule where deal_id = '00000000-0000-4000-8000-000000000d10'), 7::bigint, 'restaurar recria o cronograma');

-- C. itens e totais ----------------------------------------------------------
insert into deals (id, company_id, owner_id, title, pipeline_id, stage_id, setup_first_due, mrr_start, contract_months) values
  ('00000000-0000-4000-8000-000000000d11', '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000c4', 'tst-neg-itens', '00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000b2', '2026-05-01', '2026-05-01', 12);
insert into deal_items (id, deal_id, company_id, product_id, quantity, unit_price) values
  ('00000000-0000-4000-8000-000000000e01', '00000000-0000-4000-8000-000000000d11', '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000a4', 2, 2500);
select is((select mrr from deals where id = '00000000-0000-4000-8000-000000000d11'), 5000::numeric, 'item recorrente 2 x 2500 dá MRR 5000');
insert into deal_items (id, deal_id, company_id, product_id, quantity, unit_price) values
  ('00000000-0000-4000-8000-000000000e02', '00000000-0000-4000-8000-000000000d11', '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000a5', 1, 900);
select is((select setup_total from deals where id = '00000000-0000-4000-8000-000000000d11'), 900::numeric, 'item de implantação soma no setup');
select results_eq($$ select month, setup, mrr from deal_revenue_schedule where deal_id = '00000000-0000-4000-8000-000000000d11' and month = '2026-05-01' $$,
  $$ values ('2026-05-01'::date, 900::numeric, 5000::numeric) $$, 'itens alimentam o cronograma');
select throws_ok($$ update deals set mrr = 1 where id = '00000000-0000-4000-8000-000000000d11' $$, 'P0001', 'OXYN_TOTALS_FROM_ITEMS', 'MRR manual com itens é bloqueado');
select throws_ok($$ update deals set setup_total = 1 where id = '00000000-0000-4000-8000-000000000d11' $$, 'P0001', 'OXYN_TOTALS_FROM_ITEMS', 'setup manual com itens é bloqueado');
select lives_ok($$ update deals set title = 'tst-neg-itens renomeado', mrr = mrr where id = '00000000-0000-4000-8000-000000000d11' $$, 'regravar o mesmo total é permitido');
select throws_ok($$ update deal_items set kind = 'setup' where id = '00000000-0000-4000-8000-000000000e01' $$, 'P0001', 'OXYN_FORBIDDEN_FIELD', 'tipo do item não muda');
update products set kind = 'setup' where id = '00000000-0000-4000-8000-0000000000a4';
select is((select kind from deal_items where id = '00000000-0000-4000-8000-000000000e01'), 'recurring', 'mudar o tipo do produto não muda itens existentes');
update products set kind = 'recurring' where id = '00000000-0000-4000-8000-0000000000a4';
select throws_ok($$ insert into deal_items (deal_id, company_id, product_id, quantity, unit_price) values ('00000000-0000-4000-8000-000000000d11', '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000a6', 1, 10) $$,
  'P0001', 'OXYN_PRODUCT_INACTIVE', 'produto inativo não entra em item novo');
update deal_items set quantity = 3 where id = '00000000-0000-4000-8000-000000000e01';
select is((select mrr from deals where id = '00000000-0000-4000-8000-000000000d11'), 7500::numeric, 'editar item recalcula');
delete from deal_items where id = '00000000-0000-4000-8000-000000000e02';
select is((select setup_total from deals where id = '00000000-0000-4000-8000-000000000d11'), 0::numeric, 'remover item recalcula');
insert into deal_items (id, deal_id, company_id, product_id, kind, quantity, unit_price) values
  ('00000000-0000-4000-8000-000000000e03', '00000000-0000-4000-8000-000000000d11', '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000a4', 'setup', 1, 10);
select is((select kind from deal_items where id = '00000000-0000-4000-8000-000000000e03'), 'recurring', 'tipo do item vem do produto, não do payload');

-- D. campos obrigatórios -----------------------------------------------------
insert into deals (id, company_id, owner_id, title, pipeline_id, stage_id) values
  ('00000000-0000-4000-8000-000000000d12', '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000c4', 'tst-neg-obrigatorios', '00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000b2');
select is(pg_temp.detail_of($$ update deals set stage_id = '00000000-0000-4000-8000-0000000000b1' where id = '00000000-0000-4000-8000-000000000d12' $$), 'expected_close_date,contract,cf:porte',
  'detalhe lista as chaves na ordem da etapa');
select throws_ok($$ update deals set stage_id = '00000000-0000-4000-8000-0000000000b1' where id = '00000000-0000-4000-8000-000000000d12' $$, 'P0001', 'OXYN_REQUIRED_FIELDS', 'mover sem os campos é bloqueado');
update deals set expected_close_date = '2026-12-01' where id = '00000000-0000-4000-8000-000000000d12';
select is(pg_temp.detail_of($$ update deals set stage_id = '00000000-0000-4000-8000-0000000000b1' where id = '00000000-0000-4000-8000-000000000d12' $$), 'contract,cf:porte', 'só o que falta');
update custom_field_defs set archived_at = now() where company_id = '00000000-0000-4000-8000-0000000000d1' and entity = 'deals' and key = 'porte';
update deals set setup_total = 1000, setup_first_due = '2026-06-01' where id = '00000000-0000-4000-8000-000000000d12';
select lives_ok($$ update deals set stage_id = '00000000-0000-4000-8000-0000000000b1' where id = '00000000-0000-4000-8000-000000000d12' $$, 'campo personalizado arquivado não bloqueia');
select is((select stage_id from deals where id = '00000000-0000-4000-8000-000000000d12'), '00000000-0000-4000-8000-0000000000b1'::uuid, 'negócio mudou de etapa');
select throws_ok($$ insert into deals (company_id, owner_id, title, pipeline_id, stage_id) values ('00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000c4', 'x', '00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000b1') $$,
  'P0001', 'OXYN_REQUIRED_FIELDS', 'criar direto numa etapa exigente também valida');
update custom_field_defs set archived_at = null where company_id = '00000000-0000-4000-8000-0000000000d1' and entity = 'deals' and key = 'porte';
insert into deals (id, company_id, owner_id, title, pipeline_id, stage_id, expected_close_date, mrr, mrr_start, contract_months, custom_fields) values
  ('00000000-0000-4000-8000-000000000d14', '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000c4', 'tst-neg-completo', '00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000b2', '2026-12-01', 100, '2026-07-01', 3, '{"porte":"grande"}');
select lives_ok($$ update deals set stage_id = '00000000-0000-4000-8000-0000000000b1' where id = '00000000-0000-4000-8000-000000000d14' $$, 'campo personalizado ativo preenchido libera');
insert into deals (id, company_id, owner_id, title, pipeline_id, stage_id, setup_first_due) values
  ('00000000-0000-4000-8000-000000000d15', '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000c4', 'tst-neg-produtos', '00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000b2', '2026-06-01');
select is(pg_temp.detail_of($$ update deals set stage_id = '00000000-0000-4000-8000-0000000000b6' where id = '00000000-0000-4000-8000-000000000d15' $$), 'person_id,estimated_value,products', 'pessoa, valor e produtos faltando');
update deals set person_id = '00000000-0000-4000-8000-000000000a01', estimated_value = 10 where id = '00000000-0000-4000-8000-000000000d15';
select is(pg_temp.detail_of($$ update deals set stage_id = '00000000-0000-4000-8000-0000000000b6' where id = '00000000-0000-4000-8000-000000000d15' $$), 'products', 'falta só produto');
insert into deal_items (deal_id, company_id, product_id, quantity, unit_price) values ('00000000-0000-4000-8000-000000000d15', '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000a5', 1, 50);
select lives_ok($$ update deals set stage_id = '00000000-0000-4000-8000-0000000000b6' where id = '00000000-0000-4000-8000-000000000d15' $$, 'com produto, move');

-- E. etapa e histórico --------------------------------------------------------
insert into deals (id, company_id, owner_id, title, pipeline_id, stage_id) values
  ('00000000-0000-4000-8000-000000000d16', '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000c4', 'tst-neg-historico', '00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000b2');
select results_eq($$ select from_stage_id, to_stage_id from deal_stage_history where deal_id = '00000000-0000-4000-8000-000000000d16' $$,
  $$ values (null::uuid, '00000000-0000-4000-8000-0000000000b2'::uuid) $$, 'insert registra a etapa inicial');
create temp table t_entered as select stage_entered_at as e from deals where id = '00000000-0000-4000-8000-000000000d16';
update deals set stage_id = '00000000-0000-4000-8000-0000000000b3' where id = '00000000-0000-4000-8000-000000000d16';
update deals set stage_id = '00000000-0000-4000-8000-0000000000b2' where id = '00000000-0000-4000-8000-000000000d16';
select is((select count(*) from deal_stage_history where deal_id = '00000000-0000-4000-8000-000000000d16'), 3::bigint, 'duas mudanças geram 3 linhas');
select ok((select stage_entered_at from deals where id = '00000000-0000-4000-8000-000000000d16') > (select e from t_entered), 'stage_entered_at muda');
select is((select count(*) from deal_stage_history where deal_id = '00000000-0000-4000-8000-000000000d16' and from_stage_id is not null and seconds_in_previous is not null), 2::bigint,
  'seconds_in_previous preenchido nas mudanças');
select throws_ok($$ update deals set stage_id = '00000000-0000-4000-8000-0000000000b4' where id = '00000000-0000-4000-8000-000000000d16' $$, 'P0001', 'OXYN_CROSS_COMPANY', 'etapa de outro funil sem trocar o funil');
select lives_ok($$ update deals set pipeline_id = '00000000-0000-4000-8000-0000000000a2', stage_id = '00000000-0000-4000-8000-0000000000b4' where id = '00000000-0000-4000-8000-000000000d16' $$, 'trocar funil e etapa juntos');
select throws_ok($$ update deals set pipeline_id = '00000000-0000-4000-8000-0000000000a1' where id = '00000000-0000-4000-8000-000000000d16' $$, 'P0001', 'OXYN_CROSS_COMPANY', 'trocar só o funil é incoerente');

-- F. status --------------------------------------------------------------------
insert into deals (id, company_id, owner_id, title, pipeline_id, stage_id) values
  ('00000000-0000-4000-8000-000000000d17', '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000c4', 'tst-neg-status', '00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000b2');
update deals set status = 'won' where id = '00000000-0000-4000-8000-000000000d17';
select results_eq($$ select won_at is not null, lost_at is null from deals where id = '00000000-0000-4000-8000-000000000d17' $$, $$ values (true, true) $$, 'ganho define won_at');
update deals set status = 'lost', lost_reason_id = '00000000-0000-4000-8000-0000000000a7', lost_note = 'caro' where id = '00000000-0000-4000-8000-000000000d17';
select results_eq($$ select won_at is null, lost_at is not null, lost_reason_id from deals where id = '00000000-0000-4000-8000-000000000d17' $$,
  $$ values (true, true, '00000000-0000-4000-8000-0000000000a7'::uuid) $$, 'perdido define lost_at e limpa won_at');
update deals set status = 'open' where id = '00000000-0000-4000-8000-000000000d17';
select results_eq($$ select won_at is null, lost_at is null, lost_reason_id is null, lost_note is null from deals where id = '00000000-0000-4000-8000-000000000d17' $$,
  $$ values (true, true, true, true) $$, 'reabrir limpa datas, motivo e nota');
select throws_ok($$ update deals set status = 'lost' where id = '00000000-0000-4000-8000-000000000d17' $$, '23514', null, 'perdido exige motivo');

-- G. linha do tempo de negócios -----------------------------------------------------
update deals set owner_id = '00000000-0000-4000-8000-0000000000c2' where id = '00000000-0000-4000-8000-000000000d16';
select is((select count(*) from timeline_events where entity = 'deals' and record_id = '00000000-0000-4000-8000-000000000d16' and kind = 'created'), 1::bigint, 'created');
select is((select data->>'to' from timeline_events where record_id = '00000000-0000-4000-8000-000000000d16' and kind = 'owner_changed'), '00000000-0000-4000-8000-0000000000c2', 'owner_changed');
select results_eq($$ select data->>'from', data->>'to' from timeline_events where record_id = '00000000-0000-4000-8000-000000000d16' and kind = 'stage_changed' order by id limit 1 $$,
  $$ values ('00000000-0000-4000-8000-0000000000b2'::text, '00000000-0000-4000-8000-0000000000b3'::text) $$, 'stage_changed com from e to');
select is((select count(*) from timeline_events where record_id = '00000000-0000-4000-8000-000000000d16' and kind = 'stage_changed'), 3::bigint, 'uma stage_changed por mudança');
select is((select count(*) from timeline_events where record_id = '00000000-0000-4000-8000-000000000d16' and kind = 'updated' and data->'fields' ? 'stage_entered_at'), 0::bigint,
  'updated ignora stage_entered_at');
select is((select count(*) from timeline_events where record_id = '00000000-0000-4000-8000-000000000d11' and kind = 'updated' and (data->'fields' ? 'mrr' or data->'fields' ? 'setup_total')), 0::bigint,
  'updated ignora totais recalculados');
select results_eq($$ select data->>'to', data->>'reason_id' from timeline_events where record_id = '00000000-0000-4000-8000-000000000d17' and kind = 'status_changed' order by id $$,
  $$ values ('won'::text, null::text), ('lost', '00000000-0000-4000-8000-0000000000a7'), ('open', null) $$, 'status_changed won, lost com motivo e open');
select is((select count(*) from timeline_events where record_id = '00000000-0000-4000-8000-000000000d17' and kind = 'updated'), 0::bigint, 'status não vira updated');
select is((select count(*) from timeline_events where record_id = '00000000-0000-4000-8000-000000000d10' and kind in ('trashed','restored')), 2::bigint, 'trashed e restored');

-- H. conversão de lead --------------------------------------------------------------
insert into leads (id, company_id, owner_id, title, person_id, organization_id, estimated_value) values
  ('00000000-0000-4000-8000-000000000c01', '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000c2', 'tst-lead-convertivel', '00000000-0000-4000-8000-000000000a01', '00000000-0000-4000-8000-000000000b01', 7000),
  ('00000000-0000-4000-8000-000000000c02', '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000c4', 'tst-lead-exigente', null, null, null),
  ('00000000-0000-4000-8000-000000000c03', '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000c2', 'tst-lead-eva', null, null, null),
  ('00000000-0000-4000-8000-000000000c04', '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000c2', 'tst-lead-lixeira', null, null, null),
  ('00000000-0000-4000-8000-000000000c05', '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000c2', 'tst-lead-titulo', null, null, null),
  ('00000000-0000-4000-8000-000000000c06', '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000c2', 'tst-lead-transicoes', null, null, null);
update leads set deleted_at = now() where id = '00000000-0000-4000-8000-000000000c04';
insert into record_labels (label_id, entity, record_id) values
  ('00000000-0000-4000-8000-0000000000f1', 'leads', '00000000-0000-4000-8000-000000000c01'), ('00000000-0000-4000-8000-0000000000f1', 'organizations', '00000000-0000-4000-8000-000000000b01'), ('00000000-0000-4000-8000-0000000000f1', 'persons', '00000000-0000-4000-8000-000000000a01');

select pg_temp.as_user('00000000-0000-4000-8000-0000000000c2');
select lives_ok($$ select set_config('tst.deal', convert_lead('00000000-0000-4000-8000-000000000c01', '00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000b2')::text, true) $$, 'ana converte o lead dela');
select results_eq($$ select title, owner_id, person_id, organization_id, estimated_value, lead_id from deals where id = current_setting('tst.deal')::uuid $$,
  $$ values ('tst-lead-convertivel'::text, '00000000-0000-4000-8000-0000000000c2'::uuid, '00000000-0000-4000-8000-000000000a01'::uuid, '00000000-0000-4000-8000-000000000b01'::uuid, 7000::numeric, '00000000-0000-4000-8000-000000000c01'::uuid) $$, 'negócio herda os dados do lead');
select is((select count(*) from record_labels where entity = 'deals' and record_id = current_setting('tst.deal')::uuid and label_id = '00000000-0000-4000-8000-0000000000f1'), 1::bigint,
  'etiquetas copiadas');
select results_eq($$ select status, converted_deal_id = current_setting('tst.deal')::uuid, converted_at is not null from leads where id = '00000000-0000-4000-8000-000000000c01' $$,
  $$ values ('converted'::text, true, true) $$, 'lead vira converted');
select is((select count(*) from timeline_events where record_id = '00000000-0000-4000-8000-000000000c01' and kind = 'converted'), 1::bigint, 'converted na linha do tempo do lead');
select is((select count(*) from timeline_events where record_id = '00000000-0000-4000-8000-000000000c01' and kind = 'status_changed'), 0::bigint, 'sem status_changed duplicado');
select is((select count(*) from timeline_events where record_id = current_setting('tst.deal')::uuid and kind = 'created'), 1::bigint, 'created na linha do tempo do negócio');
select throws_ok($$ select convert_lead('00000000-0000-4000-8000-000000000c01', '00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000b2') $$, 'P0001', 'OXYN_INVALID_TRANSITION', 'segunda conversão falha');
select throws_ok($$ select convert_lead('00000000-0000-4000-8000-000000000c04', '00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000b2') $$, 'P0001', 'OXYN_INVALID_TRANSITION', 'lead na lixeira não converte');
select throws_ok($$ select convert_lead('00000000-0000-4000-8000-000000000c02', '00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000b2') $$, '42501', null, 'ana não edita lead de caio');
select throws_ok($$ select convert_lead('00000000-0000-4000-8000-000000000c05', '00000000-0000-4000-8000-0000000000a3', '00000000-0000-4000-8000-0000000000b5') $$, 'P0001', 'OXYN_CROSS_COMPANY', 'funil de outra empresa');
select throws_ok($$ update leads set converted_deal_id = null where id = '00000000-0000-4000-8000-000000000c01' $$, 'P0001', 'OXYN_FORBIDDEN_FIELD', 'converted_deal_id não muda fora de convert_lead');
select lives_ok($$ select set_config('tst.deal2', convert_lead('00000000-0000-4000-8000-000000000c05', '00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000b2', 'tst-titulo-custom')::text, true) $$, 'conversão com título próprio');
select is((select title from deals where id = current_setting('tst.deal2')::uuid), 'tst-titulo-custom', 'usa p_title');
select pg_temp.as_user('00000000-0000-4000-8000-0000000000c4');
select throws_ok($$ select convert_lead('00000000-0000-4000-8000-000000000c02', '00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000b1') $$, 'P0001', 'OXYN_REQUIRED_FIELDS', 'respeita campos obrigatórios da etapa');
select is((select status from leads where id = '00000000-0000-4000-8000-000000000c02'), 'open', 'lead continua aberto após erro');
select pg_temp.as_user('00000000-0000-4000-8000-0000000000c6');
select throws_ok($$ select convert_lead('00000000-0000-4000-8000-000000000c03', '00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000b2') $$, '42501', null, 'sem permissão de criar negócios');
select pg_temp.as_pg();
select ok(not has_function_privilege('anon', 'public.convert_lead(uuid,uuid,uuid,text)', 'execute'), 'anon sem execute em convert_lead');
select ok(has_function_privilege('authenticated', 'public.convert_lead(uuid,uuid,uuid,text)', 'execute'), 'authenticated executa convert_lead');

insert into deals (id, company_id, owner_id, title, pipeline_id, stage_id) values
  ('00000000-0000-4000-8000-000000000d99', '00000000-0000-4000-8000-0000000000d2', '00000000-0000-4000-8000-0000000000c5', 'tst-neg-naia', '00000000-0000-4000-8000-0000000000a3', '00000000-0000-4000-8000-0000000000b5');
select set_config('oxyn.converting', 'on', true);
select throws_ok($$ update leads set converted_deal_id = '00000000-0000-4000-8000-000000000d99' where id = '00000000-0000-4000-8000-000000000c06' $$, 'P0001', 'OXYN_CROSS_COMPANY', 'converted_deal_id de outra empresa');
select set_config('oxyn.converting', 'off', true);

-- exclusão definitiva do negócio convertido
update deals set deleted_at = now() where id = current_setting('tst.deal')::uuid;
select pg_temp.as_user('00000000-0000-4000-8000-0000000000c1');
select lives_ok($$ select purge_record('deals', current_setting('tst.deal')::uuid) $$, 'admin apaga negócio da lixeira');
select pg_temp.as_pg();
select is((select converted_deal_id from leads where id = '00000000-0000-4000-8000-000000000c01'), null::uuid, 'apagar o negócio zera converted_deal_id');
select is((select count(*) from timeline_events where record_id = '00000000-0000-4000-8000-000000000c01' and kind = 'updated' and data->'fields' ? 'converted_deal_id'), 0::bigint,
  'zerar converted_deal_id não gera ruído');
select is((select count(*) from deals where id = current_setting('tst.deal')::uuid), 0::bigint, 'negócio apagado');
select is((select count(*) from timeline_events where record_id = current_setting('tst.deal')::uuid), 0::bigint, 'timeline do negócio apagada');

-- I. transições de status do lead ------------------------------------------------------
select throws_ok($$ update leads set status = 'converted' where id = '00000000-0000-4000-8000-000000000c06' $$, 'P0001', 'OXYN_INVALID_TRANSITION', 'converted direto é bloqueado');
select lives_ok($$ update leads set status = 'archived' where id = '00000000-0000-4000-8000-000000000c06' $$, 'open para archived');
select throws_ok($$ update leads set status = 'disqualified', disqualification_reason_id = '00000000-0000-4000-8000-0000000000a8' where id = '00000000-0000-4000-8000-000000000c06' $$, 'P0001', 'OXYN_INVALID_TRANSITION', 'archived para disqualified');
select lives_ok($$ update leads set status = 'open' where id = '00000000-0000-4000-8000-000000000c06' $$, 'archived para open');
select lives_ok($$ update leads set status = 'disqualified', disqualification_reason_id = '00000000-0000-4000-8000-0000000000a8' where id = '00000000-0000-4000-8000-000000000c06' $$, 'open para disqualified');
select throws_ok($$ update leads set status = 'archived' where id = '00000000-0000-4000-8000-000000000c06' $$, 'P0001', 'OXYN_INVALID_TRANSITION', 'disqualified para archived');
select lives_ok($$ update leads set status = 'open' where id = '00000000-0000-4000-8000-000000000c06' $$, 'disqualified para open');
select throws_ok($$ update leads set status = 'open' where id = '00000000-0000-4000-8000-000000000c01' $$, 'P0001', 'OXYN_INVALID_TRANSITION', 'converted não reabre');

-- J. filtros por etiqueta ---------------------------------------------------------------
insert into deals (id, company_id, owner_id, title, pipeline_id, stage_id) values
  ('00000000-0000-4000-8000-000000000d20', '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000c4', 'tst-busca-xyz negocio', '00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000b2'),
  ('00000000-0000-4000-8000-000000000d21', '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000c4', 'tst-neg-so-l1', '00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000b2'),
  ('00000000-0000-4000-8000-000000000d22', '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000c4', 'tst-neg-sem', '00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000b2'),
  ('00000000-0000-4000-8000-000000000d23', '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000c2', 'tst-neg-ana', '00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000b2');
insert into record_labels (label_id, entity, record_id) values
  ('00000000-0000-4000-8000-0000000000f1', 'deals', '00000000-0000-4000-8000-000000000d20'), ('00000000-0000-4000-8000-0000000000f2', 'deals', '00000000-0000-4000-8000-000000000d20'), ('00000000-0000-4000-8000-0000000000f1', 'deals', '00000000-0000-4000-8000-000000000d21'),
  ('00000000-0000-4000-8000-0000000000f1', 'deals', '00000000-0000-4000-8000-000000000d23'), ('00000000-0000-4000-8000-0000000000f2', 'deals', '00000000-0000-4000-8000-000000000d23');
select results_eq($$ select id from deals_with_labels(array['00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-0000000000f2']::uuid[]) where id in ('00000000-0000-4000-8000-000000000d20','00000000-0000-4000-8000-000000000d21','00000000-0000-4000-8000-000000000d22','00000000-0000-4000-8000-000000000d23') order by id $$,
  $$ values ('00000000-0000-4000-8000-000000000d20'::uuid), ('00000000-0000-4000-8000-000000000d23'::uuid) $$, 'devolve só negócios com as duas etiquetas');
select is((select count(*) from deals_with_labels('{}') where id in ('00000000-0000-4000-8000-000000000d20','00000000-0000-4000-8000-000000000d21','00000000-0000-4000-8000-000000000d22','00000000-0000-4000-8000-000000000d23')), 4::bigint, 'array vazio devolve tudo');
select is((select count(*) from deals_with_labels(null) where id in ('00000000-0000-4000-8000-000000000d20','00000000-0000-4000-8000-000000000d21','00000000-0000-4000-8000-000000000d22','00000000-0000-4000-8000-000000000d23')), 4::bigint, 'array nulo devolve tudo');
select is((select count(*) from organizations_with_labels(array['00000000-0000-4000-8000-0000000000f1']::uuid[]) where id = '00000000-0000-4000-8000-000000000b01'), 1::bigint, 'organizations_with_labels');
select is((select count(*) from persons_with_labels(array['00000000-0000-4000-8000-0000000000f1']::uuid[]) where id = '00000000-0000-4000-8000-000000000a01'), 1::bigint, 'persons_with_labels');
select is((select count(*) from leads_with_labels(array['00000000-0000-4000-8000-0000000000f1']::uuid[]) where id = '00000000-0000-4000-8000-000000000c01'), 1::bigint, 'leads_with_labels');
select is((select count(*) from leads_with_labels(array['00000000-0000-4000-8000-0000000000f2']::uuid[]) where id = '00000000-0000-4000-8000-000000000c01'), 0::bigint, 'lead sem a outra etiqueta fica de fora');
select pg_temp.as_user('00000000-0000-4000-8000-0000000000c2');
select results_eq($$ select id from deals_with_labels(array['00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-0000000000f2']::uuid[]) where id in ('00000000-0000-4000-8000-000000000d20','00000000-0000-4000-8000-000000000d21','00000000-0000-4000-8000-000000000d22','00000000-0000-4000-8000-000000000d23') $$,
  $$ values ('00000000-0000-4000-8000-000000000d23'::uuid) $$, 'RLS vale nos filtros por etiqueta');
select ok(has_function_privilege('authenticated', 'public.deals_with_labels(uuid[])', 'execute'), 'authenticated executa deals_with_labels');
select pg_temp.as_pg();
select ok(not has_function_privilege('anon', 'public.deals_with_labels(uuid[])', 'execute'), 'anon sem execute em deals_with_labels');

-- K. busca global ---------------------------------------------------------------------------
select pg_temp.as_user('00000000-0000-4000-8000-0000000000c1');
select results_eq($$ select entity, record_id, title, subtitle from global_search('tst-busca-xyz') $$,
  $$ values ('deals'::text, '00000000-0000-4000-8000-000000000d20'::uuid, 'tst-busca-xyz negocio'::text, 'tst-etapa-2'::text) $$, 'busca encontra negócio pelo título, com a etapa no subtítulo');
select pg_temp.as_user('00000000-0000-4000-8000-0000000000c5');
select is((select count(*) from global_search('tst-busca-xyz')), 0::bigint, 'busca de negócios respeita o RLS');

select * from finish();
