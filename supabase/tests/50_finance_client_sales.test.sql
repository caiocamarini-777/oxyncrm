begin;
select plan(36);

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
  ('00000000-0000-4000-8000-0000000000d1', 'Fin Vendas', 'tst-fin-sales');

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-0000000000c1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tst-admin@oxyn.test', '{"full_name":"admin"}'),
  ('00000000-0000-4000-8000-0000000000c4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tst-manager@oxyn.test', '{"full_name":"manager"}'),
  ('00000000-0000-4000-8000-0000000000c5', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tst-vend1@oxyn.test', '{"full_name":"vend1"}'),
  ('00000000-0000-4000-8000-0000000000c6', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tst-vend2@oxyn.test', '{"full_name":"vend2"}'),
  ('00000000-0000-4000-8000-0000000000c7', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tst-semfin@oxyn.test', '{"full_name":"semfin"}');
update profiles set is_super_admin = true where id = '00000000-0000-4000-8000-0000000000c1';

insert into roles (id, name, description, permissions) values
  ('00000000-0000-4000-8000-0000000000e1', 'tst-SemFin', 't', '{"visibility":{"leads":"own","deals":"own","persons":"own","organizations":"own","activities":"own"},"actions":{"create":true,"edit":true,"delete":false,"export":false,"reassign_owner":false},"settings":{"manage_pipelines":false,"manage_custom_fields":false,"manage_products":false,"view_reports":true,"create_dashboards":true,"share_dashboards":false}}'::jsonb),
  ('00000000-0000-4000-8000-0000000000e3', 'tst-GerFin', 't', '{"visibility":{"leads":"own","deals":"own","persons":"own","organizations":"own","activities":"own"},"actions":{"create":true,"edit":true,"delete":false,"export":false,"reassign_owner":false},"settings":{"manage_pipelines":false,"manage_custom_fields":false,"manage_products":false,"view_reports":true,"create_dashboards":true,"share_dashboards":false,"manage_finance":true}}'::jsonb),
  ('00000000-0000-4000-8000-0000000000e4', 'tst-Vendedor', 't', '{"visibility":{"leads":"own","deals":"own","persons":"own","organizations":"own","activities":"own"},"actions":{"create":true,"edit":true,"delete":false,"export":false,"reassign_owner":false},"settings":{"manage_pipelines":false,"manage_custom_fields":false,"manage_products":false,"view_reports":true,"create_dashboards":true,"share_dashboards":false,"register_sales":true}}'::jsonb);
insert into memberships (user_id, company_id, role_id) values
  ('00000000-0000-4000-8000-0000000000c4', '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000e3'),
  ('00000000-0000-4000-8000-0000000000c5', '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000e4'),
  ('00000000-0000-4000-8000-0000000000c6', '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000e4'),
  ('00000000-0000-4000-8000-0000000000c7', '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000e1');
insert into organizations (id, company_id, owner_id, name) values
  ('00000000-0000-4000-8000-000000000b01', '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000c4', 'Cliente X');

-- view do dono (sem RLS) para inspecionar as entries da venda 1
create temp view tst_e as
  select * from fin_entries where client_sale_id = current_setting('tst.s1')::uuid;
grant select on tst_e to public;

select pg_temp.as_user('00000000-0000-4000-8000-0000000000c1');
update companies set finance_enabled = true where id = '00000000-0000-4000-8000-0000000000d1';
select pg_temp.as_user('00000000-0000-4000-8000-0000000000c4');

insert into fin_accounts (id, company_id, name) values
  ('00000000-0000-4000-8000-00000000ac01', '00000000-0000-4000-8000-0000000000d1', 'tst-conta');
insert into fin_contracts (id, company_id, organization_id, account_id, title, status, due_day, retention_rate, end_rule) values
  ('00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-000000000b01',
   '00000000-0000-4000-8000-00000000ac01', 'Contrato Comissão', 'active', 10, 0, 'ends');
insert into fin_contract_lines (id, contract_id, company_id, kind, description, setup_rate, recurring_rate, first_month, months) values
  ('00000000-0000-4000-8000-000000000a11', '00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-0000000000d1',
   'commission', 'Comissão', 10, 5, '2026-11-01', 12);

-- Vendedor 1 registra duas vendas.
select pg_temp.as_user('00000000-0000-4000-8000-0000000000c5');
select set_config('tst.s1', public.fin_save_sale(null, '{"contract_id":"00000000-0000-4000-8000-0000000000f1","line_id":"00000000-0000-4000-8000-000000000a11","buyer":"Comprador A","sold_on":"2026-10-20","setup_value":3000,"setup_installments":3,"setup_first_month":"2026-11-01","recurring_value":1000,"recurring_start":"2026-11-01","recurring_months":3}'::jsonb)::text, true);
select set_config('tst.s2', public.fin_save_sale(null, '{"contract_id":"00000000-0000-4000-8000-0000000000f1","line_id":"00000000-0000-4000-8000-000000000a11","buyer":"Fora","sold_on":"2027-10-20","recurring_value":1000,"recurring_start":"2027-11-01","recurring_months":1}'::jsonb)::text, true);

select pg_temp.as_user('00000000-0000-4000-8000-0000000000c4');

select is((select string_agg(due_date || ':' || gross, ',' order by due_date) from tst_e where kind_tag = 'setup'),
  '2026-12-10:100.00,2027-01-10:100.00,2027-02-10:100.00', 'setup: 3 parcelas de 100 no mês seguinte ao recebimento');
select is((select string_agg(due_date || ':' || gross, ',' order by due_date) from tst_e where kind_tag = 'recurring'),
  '2026-12-10:50.00,2027-01-10:50.00,2027-02-10:50.00', 'recorrência: 50 nos mesmos vencimentos');
select is((select count(*)::int from tst_e
            where source_kind = 'sale' and direction = 'in' and contract_line_id is null
              and contract_id = '00000000-0000-4000-8000-0000000000f1'
              and organization_id = '00000000-0000-4000-8000-000000000b01'
              and account_id = '00000000-0000-4000-8000-00000000ac01'
              and description = 'Comissão – Comprador A'
              and competence = date_trunc('month', due_date)::date), 6,
  'entries de venda: source sale, sem linha, com contrato, cliente, conta e descrição');
select is((select count(*)::int from fin_entries where client_sale_id = current_setting('tst.s2')::uuid), 0,
  'recebimento fora da vigência (ends) não gera comissão');

-- Renovação automática conta como vigência; 'confirm' não. Regerar o contrato não toca as vendas.
update fin_contracts set end_rule = 'auto_renew' where id = '00000000-0000-4000-8000-0000000000f1';
select is((select string_agg(due_date || ':' || gross, ',') from fin_entries where client_sale_id = current_setting('tst.s2')::uuid),
  '2027-12-10:50.00', 'auto_renew: recebimento na renovação gera comissão');
select is((select count(*)::int from tst_e), 6, 'regerar o contrato mantém as entries de venda');
update fin_contracts set end_rule = 'confirm' where id = '00000000-0000-4000-8000-0000000000f1';
select is((select count(*)::int from fin_entries where client_sale_id = current_setting('tst.s2')::uuid), 0,
  'confirm: renovação não confirmada não gera comissão');

-- Liquida a recorrência de 2026-12 e muda o % de recorrência.
select public.fin_settle_entries(array[(select id from tst_e where kind_tag = 'recurring' and competence = '2026-12-01')], '2026-12-10');
update fin_contract_lines set recurring_rate = 6 where id = '00000000-0000-4000-8000-000000000a11';
select is((select string_agg(due_date || ':' || gross || ':' || status, ',' order by due_date) from tst_e where kind_tag = 'recurring'),
  '2026-12-10:50.00:settled,2027-01-10:60.00:open,2027-02-10:60.00:open', 'novo %: abertas a 60, liquidada mantém 50');
select is((select string_agg(gross::text, ',' order by due_date) from tst_e where kind_tag = 'setup'),
  '100.00,100.00,100.00', 'setup não muda com o % de recorrência');

-- Vendedor 1: não vê nada do Financeiro, só as funções.
select pg_temp.as_user('00000000-0000-4000-8000-0000000000c5');
select throws_ok(format($q$select public.fin_save_sale(%L, '{"contract_id":"00000000-0000-4000-8000-0000000000f1","line_id":"00000000-0000-4000-8000-000000000a11","buyer":"Outro","sold_on":"2026-10-20","recurring_value":1,"recurring_start":"2026-11-01","recurring_months":1}'::jsonb)$q$,
  current_setting('tst.s1')), null, 'Esta venda já tem comissão recebida e não pode ser alterada.', 'venda com comissão liquidada não é editável');
select lives_ok(format($q$select public.fin_save_sale(%L, '{"contract_id":"00000000-0000-4000-8000-0000000000f1","line_id":"00000000-0000-4000-8000-000000000a11","buyer":"Fora 2","sold_on":"2027-10-20","recurring_value":1000,"recurring_start":"2027-11-01","recurring_months":1}'::jsonb)$q$,
  current_setting('tst.s2')), 'vendedor edita a própria venda editável');
select is((select count(*)::int from fin_entries), 0, 'vendedor lê 0 fin_entries');
select is((select count(*)::int from fin_contracts), 0, 'vendedor lê 0 fin_contracts');
select is((select count(*)::int from fin_client_sales), 0, 'vendedor lê 0 fin_client_sales');
select is((select string_agg(contract_title || '|' || client_name || '|' || line_id, ',') from public.fin_sales_contracts('00000000-0000-4000-8000-0000000000d1')),
  'Contrato Comissão|Cliente X|00000000-0000-4000-8000-000000000a11', 'fin_sales_contracts devolve o contrato');
select is(pg_get_function_result('public.fin_sales_contracts(uuid)'::regprocedure),
  'TABLE(contract_id uuid, line_id uuid, contract_title text, client_name text)', 'fin_sales_contracts sem colunas de valor ou %');

-- Vendedor 2.
select pg_temp.as_user('00000000-0000-4000-8000-0000000000c6');
select set_config('tst.s3', public.fin_save_sale(null, '{"contract_id":"00000000-0000-4000-8000-0000000000f1","line_id":"00000000-0000-4000-8000-000000000a11","buyer":"Comprador B","sold_on":"2026-11-02","setup_value":500,"setup_first_month":"2026-12-01"}'::jsonb)::text, true);
select is((select string_agg(buyer || ':' || editable, ',') from public.fin_my_sales('00000000-0000-4000-8000-0000000000d1')),
  'Comprador B:true', 'fin_my_sales do vendedor 2 só tem a venda dele');
select throws_ok(format($q$select public.fin_save_sale(%L, '{"contract_id":"00000000-0000-4000-8000-0000000000f1","line_id":"00000000-0000-4000-8000-000000000a11","buyer":"X","sold_on":"2027-10-20","recurring_value":1,"recurring_start":"2027-11-01","recurring_months":1}'::jsonb)$q$,
  current_setting('tst.s2')), '42501', null, 'editar a venda de outro vendedor dá 42501');
select throws_ok(format($q$select public.fin_cancel_sale(%L)$q$, current_setting('tst.s2')), '42501', null,
  'cancelar a venda de outro vendedor dá 42501');

select pg_temp.as_user('00000000-0000-4000-8000-0000000000c5');
select is((select string_agg(buyer || ':' || editable, ',' order by buyer) from public.fin_my_sales('00000000-0000-4000-8000-0000000000d1')),
  'Comprador A:false,Fora 2:true', 'fin_my_sales do vendedor 1: as dele, com editable');

-- Contrato com vendedores definidos: só eles veem.
select pg_temp.as_user('00000000-0000-4000-8000-0000000000c4');
insert into fin_contract_sellers (contract_id, user_id, company_id) values
  ('00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-0000000000c6', '00000000-0000-4000-8000-0000000000d1');
select pg_temp.as_user('00000000-0000-4000-8000-0000000000c5');
select is((select count(*)::int from public.fin_sales_contracts('00000000-0000-4000-8000-0000000000d1')), 0,
  'contrato com vendedores sem ele some da lista');
select throws_ok($q$select public.fin_save_sale(null, '{"contract_id":"00000000-0000-4000-8000-0000000000f1","line_id":"00000000-0000-4000-8000-000000000a11","buyer":"Y","sold_on":"2026-10-20","setup_value":10,"setup_first_month":"2026-11-01"}'::jsonb)$q$,
  '42501', null, 'salvar venda em contrato de outros vendedores dá 42501');
select pg_temp.as_user('00000000-0000-4000-8000-0000000000c6');
select is((select count(*)::int from public.fin_sales_contracts('00000000-0000-4000-8000-0000000000d1')), 1,
  'vendedor listado continua vendo o contrato');

-- Gestor cancela a venda 1: abertas somem, a liquidada fica.
select pg_temp.as_user('00000000-0000-4000-8000-0000000000c4');
select lives_ok(format($q$select public.fin_cancel_sale(%L)$q$, current_setting('tst.s1')), 'gestor cancela venda com comissão liquidada');
select is((select string_agg(kind_tag || ':' || status || ':' || gross, ',') from tst_e), 'recurring:settled:50.00',
  'venda cancelada: só a liquidada fica');
select is((select status from fin_client_sales where id = current_setting('tst.s1')::uuid), 'cancelled', 'venda marcada cancelada');
select is((select count(*)::int from fin_client_sales), 3, 'gestor lê as vendas');

-- Linha de comissão ou contrato com vendas não podem ser apagados (sem cascata silenciosa).
select set_config('tst.snap', (select string_agg(client_sale_id || ':' || competence || ':' || kind_tag || ':' || status || ':' || gross, ',' order by client_sale_id, competence, kind_tag)
  from fin_entries where client_sale_id is not null), true);
select throws_ok($q$delete from fin_contract_lines where id = '00000000-0000-4000-8000-000000000a11'$q$, '23503', null,
  'apagar linha de comissão com vendas dá 23503');
select throws_ok($q$delete from fin_contracts where id = '00000000-0000-4000-8000-0000000000f1'$q$, '23503', null,
  'apagar contrato com vendas dá 23503');
select is((select count(*)::int from fin_client_sales s join fin_contract_lines l on l.id = s.contract_line_id
            where s.contract_id = '00000000-0000-4000-8000-0000000000f1'), 3, 'vendas, linha e contrato continuam');
select is((select string_agg(client_sale_id || ':' || competence || ':' || kind_tag || ':' || status || ':' || gross, ',' order by client_sale_id, competence, kind_tag)
  from fin_entries where client_sale_id is not null), current_setting('tst.snap'), 'entries das vendas inalteradas');

-- Sem register_sales: 42501 em todas as funções.
select pg_temp.as_user('00000000-0000-4000-8000-0000000000c7');
select throws_ok($q$select * from public.fin_sales_contracts('00000000-0000-4000-8000-0000000000d1')$q$, '42501', null, 'sem permissão: fin_sales_contracts');
select throws_ok($q$select * from public.fin_my_sales('00000000-0000-4000-8000-0000000000d1')$q$, '42501', null, 'sem permissão: fin_my_sales');
select throws_ok($q$select public.fin_save_sale(null, '{"contract_id":"00000000-0000-4000-8000-0000000000f1","line_id":"00000000-0000-4000-8000-000000000a11","buyer":"Z","sold_on":"2026-10-20","setup_value":10,"setup_first_month":"2026-11-01"}'::jsonb)$q$,
  '42501', null, 'sem permissão: fin_save_sale');
select throws_ok(format($q$select public.fin_cancel_sale(%L)$q$, current_setting('tst.s3')), '42501', null, 'sem permissão: fin_cancel_sale');

-- Apagar a empresa leva contratos e vendas juntos (o bloqueio vale só para apagar contrato/linha).
select pg_temp.as_pg();
select lives_ok($q$delete from companies where id = '00000000-0000-4000-8000-0000000000d1'$q$, 'apagar a empresa com vendas funciona');

select * from finish();
rollback;
