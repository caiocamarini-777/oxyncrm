begin;
select plan(26);

select has_table('public', t, t || ' existe')
from unnest(array['pipelines','stages','lost_reasons','products','deals','deal_items',
  'deal_stage_history','deal_revenue_schedule']) t;

insert into companies (id, name, slug) values
  ('00000000-0000-4000-8000-0000000000d1', 'Volt Teste', 'tst-volt'),
  ('00000000-0000-4000-8000-0000000000d2', 'Naia Teste', 'tst-naia');
insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-0000000000c1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tst-admin@oxyn.test', '{"full_name":"admin"}');

insert into pipelines (id, company_id, name) values
  ('00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-0000000000d1', 'tst-funil-volt'),
  ('00000000-0000-4000-8000-0000000000f2', '00000000-0000-4000-8000-0000000000d2', 'tst-funil-naia');
insert into stages (id, pipeline_id, company_id, name, position) values
  ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-0000000000d1', 'tst-etapa-volt', 0),
  ('00000000-0000-4000-8000-0000000000b2', '00000000-0000-4000-8000-0000000000f2', '00000000-0000-4000-8000-0000000000d2', 'tst-etapa-naia', 0);
insert into products (id, company_id, name, kind) values
  ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000d1', 'tst-produto-volt', 'recurring'),
  ('00000000-0000-4000-8000-0000000000a2', '00000000-0000-4000-8000-0000000000d2', 'tst-produto-naia', 'setup');
insert into lost_reasons (id, company_id, name) values
  ('00000000-0000-4000-8000-0000000000a3', '00000000-0000-4000-8000-0000000000d1', 'tst-motivo');

-- Checks de integridade (23514)
select throws_ok($$ insert into deals (company_id, owner_id, title, pipeline_id, stage_id, mrr, contract_months) values
  ('00000000-0000-4000-8000-0000000000d1','00000000-0000-4000-8000-0000000000c1','D','00000000-0000-4000-8000-0000000000f1','00000000-0000-4000-8000-0000000000b1', 5000, 12) $$,
  '23514', null, 'MRR sem mrr_start é rejeitado');
select throws_ok($$ insert into deals (company_id, owner_id, title, pipeline_id, stage_id, setup_total) values
  ('00000000-0000-4000-8000-0000000000d1','00000000-0000-4000-8000-0000000000c1','D','00000000-0000-4000-8000-0000000000f1','00000000-0000-4000-8000-0000000000b1', 30000) $$,
  '23514', null, 'setup sem primeiro vencimento é rejeitado');
select throws_ok($$ insert into deals (company_id, owner_id, title, pipeline_id, stage_id, mrr, mrr_start, contract_months) values
  ('00000000-0000-4000-8000-0000000000d1','00000000-0000-4000-8000-0000000000c1','D','00000000-0000-4000-8000-0000000000f1','00000000-0000-4000-8000-0000000000b1', 5000, '2026-05-15', 12) $$,
  '23514', null, 'mrr_start fora do dia 1 é rejeitado');
select throws_ok($$ insert into deals (company_id, owner_id, title, pipeline_id, stage_id, status) values
  ('00000000-0000-4000-8000-0000000000d1','00000000-0000-4000-8000-0000000000c1','D','00000000-0000-4000-8000-0000000000f1','00000000-0000-4000-8000-0000000000b1', 'lost') $$,
  '23514', null, 'perdido sem motivo é rejeitado');
select throws_ok($$ update stages set required_fields = '{foo}' where id = '00000000-0000-4000-8000-0000000000b1' $$,
  '23514', null, 'campo obrigatório desconhecido é rejeitado');
select throws_ok($$ update stages set probability = 120 where id = '00000000-0000-4000-8000-0000000000b1' $$,
  '23514', null, 'probabilidade acima de 100 é rejeitada');

insert into deals (id, company_id, owner_id, title, pipeline_id, stage_id, setup_total, setup_first_due, mrr, mrr_start, contract_months) values
  ('00000000-0000-4000-8000-000000000d01', '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000c1', 'tst-negocio',
   '00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-0000000000b1', 30000, '2026-06-01', 5000, '2026-07-01', 12);
select is((select contract_value from deals where id = '00000000-0000-4000-8000-000000000d01'), 90000::numeric, 'valor do contrato = setup + MRR x meses');

select throws_ok($$ insert into deal_items (deal_id, company_id, product_id, quantity, unit_price, discount) values
  ('00000000-0000-4000-8000-000000000d01','00000000-0000-4000-8000-0000000000d1','00000000-0000-4000-8000-0000000000a1', 1, 100, 150) $$,
  '23514', null, 'desconto maior que o subtotal é rejeitado');

-- Mesma empresa
select throws_ok($$ insert into deals (company_id, owner_id, title, pipeline_id, stage_id) values
  ('00000000-0000-4000-8000-0000000000d1','00000000-0000-4000-8000-0000000000c1','D','00000000-0000-4000-8000-0000000000f2','00000000-0000-4000-8000-0000000000b2') $$,
  null, 'OXYN_CROSS_COMPANY', 'negócio não usa etapa de funil de outra empresa');
select throws_ok($$ insert into deal_items (deal_id, company_id, product_id, quantity, unit_price) values
  ('00000000-0000-4000-8000-000000000d01','00000000-0000-4000-8000-0000000000d1','00000000-0000-4000-8000-0000000000a2', 1, 100) $$,
  null, 'OXYN_CROSS_COMPANY', 'item não usa produto de outra empresa');
select throws_ok($$ insert into stages (pipeline_id, company_id, name, position) values
  ('00000000-0000-4000-8000-0000000000f1','00000000-0000-4000-8000-0000000000d2','tst-x', 9) $$,
  null, 'OXYN_CROSS_COMPANY', 'etapa tem a mesma empresa do funil');

insert into deal_items (id, deal_id, company_id, product_id, quantity, unit_price) values
  ('00000000-0000-4000-8000-000000000e01', '00000000-0000-4000-8000-000000000d01', '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000a1', 2, 100);
select is((select kind from deal_items where id = '00000000-0000-4000-8000-000000000e01'), 'recurring', 'tipo do item é copiado do produto');

-- Seeds de empresa nova
insert into companies (id, name, slug) values ('00000000-0000-4000-8000-0000000000d3', 'Nova Teste', 'tst-nova');
select is((select count(*) from pipelines where company_id = '00000000-0000-4000-8000-0000000000d3'), 1::bigint, 'empresa nova recebe 1 funil');
select is((select array_agg(s.probability order by s.position) from stages s where s.company_id = '00000000-0000-4000-8000-0000000000d3'),
  array[10,25,50,75,90], 'etapas padrão com probabilidades');
select is((select count(*) from lost_reasons where company_id = '00000000-0000-4000-8000-0000000000d3'), 6::bigint, 'empresa nova recebe 6 motivos de perda');

-- Polimórficos
insert into labels (id, company_id, name, color) values
  ('00000000-0000-4000-8000-0000000000a4', '00000000-0000-4000-8000-0000000000d1', 'tst-label', 'teal');
select lives_ok($$ insert into record_labels (label_id, entity, record_id) values
  ('00000000-0000-4000-8000-0000000000a4', 'deals', '00000000-0000-4000-8000-000000000d01') $$, 'record_labels aceita deals');
select lives_ok($$ insert into timeline_events (company_id, entity, record_id, kind) values
  ('00000000-0000-4000-8000-0000000000d1', 'deals', '00000000-0000-4000-8000-000000000d01', 'stage_changed') $$, 'timeline aceita stage_changed');

-- Privilégios
select is((select count(*) from unnest(array['pipelines','stages','lost_reasons','products','deals','deal_items',
  'deal_stage_history','deal_revenue_schedule']) t where has_table_privilege('authenticated', 'public.' || t, 'TRUNCATE')),
  0::bigint, 'authenticated não tem TRUNCATE nas 8 tabelas');

select * from finish();
rollback;
