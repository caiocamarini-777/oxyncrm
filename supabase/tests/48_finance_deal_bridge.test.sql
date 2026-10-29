begin;
select plan(24);

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
  ('00000000-0000-4000-8000-0000000000d1', 'Fin Ponte', 'tst-fin-ponte'),
  ('00000000-0000-4000-8000-0000000000d2', 'Fin Desligado', 'tst-fin-off');

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-0000000000c1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tst-admin@oxyn.test', '{"full_name":"admin"}'),
  ('00000000-0000-4000-8000-0000000000c2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tst-vendedor@oxyn.test', '{"full_name":"vendedor"}'),
  ('00000000-0000-4000-8000-0000000000c3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tst-leitorfin@oxyn.test', '{"full_name":"leitor"}'),
  ('00000000-0000-4000-8000-0000000000c4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tst-gerfin@oxyn.test', '{"full_name":"gerente"}');
update profiles set is_super_admin = true where id = '00000000-0000-4000-8000-0000000000c1';

insert into roles (id, name, description, permissions) values
  ('00000000-0000-4000-8000-0000000000e1', 'tst-Vendedor', 't', '{"visibility":{"leads":"company","deals":"company","persons":"company","organizations":"company","activities":"company"},"actions":{"create":true,"edit":true,"delete":false,"export":false,"reassign_owner":false},"settings":{"manage_pipelines":false,"manage_custom_fields":false,"manage_products":false,"view_reports":true,"create_dashboards":true,"share_dashboards":false}}'::jsonb),
  ('00000000-0000-4000-8000-0000000000e2', 'tst-LeitorFin', 't', '{"visibility":{"leads":"own","deals":"own","persons":"own","organizations":"own","activities":"own"},"actions":{"create":true,"edit":true,"delete":false,"export":false,"reassign_owner":false},"settings":{"manage_pipelines":false,"manage_custom_fields":false,"manage_products":false,"view_reports":true,"create_dashboards":true,"share_dashboards":false,"view_finance":true}}'::jsonb),
  ('00000000-0000-4000-8000-0000000000e3', 'tst-GerFin', 't', '{"visibility":{"leads":"own","deals":"own","persons":"own","organizations":"own","activities":"own"},"actions":{"create":true,"edit":true,"delete":false,"export":false,"reassign_owner":false},"settings":{"manage_pipelines":false,"manage_custom_fields":false,"manage_products":false,"view_reports":true,"create_dashboards":true,"share_dashboards":false,"manage_finance":true}}'::jsonb);
insert into memberships (user_id, company_id, role_id) values
  ('00000000-0000-4000-8000-0000000000c2', '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000e1'),
  ('00000000-0000-4000-8000-0000000000c2', '00000000-0000-4000-8000-0000000000d2', '00000000-0000-4000-8000-0000000000e1'),
  ('00000000-0000-4000-8000-0000000000c3', '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000e2'),
  ('00000000-0000-4000-8000-0000000000c4', '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000e3');

insert into pipelines (id, company_id, name) values
  ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000d1', 'tst-funil'),
  ('00000000-0000-4000-8000-0000000000a2', '00000000-0000-4000-8000-0000000000d2', 'tst-funil-off');
insert into stages (id, pipeline_id, company_id, name, position) values
  ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000d1', 'tst-etapa', 0),
  ('00000000-0000-4000-8000-0000000000b2', '00000000-0000-4000-8000-0000000000a2', '00000000-0000-4000-8000-0000000000d2', 'tst-etapa-off', 0);
insert into service_categories (id, company_id, name) values
  ('00000000-0000-4000-8000-00000000ca01', '00000000-0000-4000-8000-0000000000d1', 'tst-cat-1'),
  ('00000000-0000-4000-8000-00000000ca02', '00000000-0000-4000-8000-0000000000d1', 'tst-cat-2');
insert into products (id, company_id, name, kind) values
  ('00000000-0000-4000-8000-00000000aa01', '00000000-0000-4000-8000-0000000000d1', 'tst-implantacao', 'setup'),
  ('00000000-0000-4000-8000-00000000aa02', '00000000-0000-4000-8000-0000000000d1', 'tst-mensal', 'recurring');
insert into organizations (id, company_id, owner_id, name) values
  ('00000000-0000-4000-8000-00000000b001', '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000c2', 'tst-cliente');
insert into fin_accounts (id, company_id, name) values
  ('00000000-0000-4000-8000-00000000ac01', '00000000-0000-4000-8000-0000000000d1', 'tst-conta');

-- D0: empresa com Financeiro desligado.
insert into deals (id, company_id, owner_id, title, pipeline_id, stage_id, mrr, mrr_start, contract_months) values
  ('00000000-0000-4000-8000-00000000de00', '00000000-0000-4000-8000-0000000000d2', '00000000-0000-4000-8000-0000000000c2', 'tst-off',
   '00000000-0000-4000-8000-0000000000a2', '00000000-0000-4000-8000-0000000000b2', 1000, '2026-11-01', 12);
-- D1: sem itens, MRR 5.000 de 12 meses a partir de nov/2026 e setup de 3.000 em 3x.
insert into deals (id, company_id, owner_id, title, pipeline_id, stage_id, organization_id, service_category_id,
                   setup_total, setup_installments, setup_first_due, mrr, mrr_start, contract_months) values
  ('00000000-0000-4000-8000-00000000de01', '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000c2', 'tst-Acme',
   '00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-00000000b001',
   '00000000-0000-4000-8000-00000000ca01', 3000, 3, '2026-11-01', 5000, '2026-11-01', 12);
-- D2: dois itens com categorias diferentes.
insert into deals (id, company_id, owner_id, title, pipeline_id, stage_id, organization_id,
                   setup_installments, setup_first_due, mrr_start, contract_months) values
  ('00000000-0000-4000-8000-00000000de02', '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000c2', 'tst-Itens',
   '00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-00000000b001',
   2, '2026-12-01', '2027-01-01', 6);
insert into deal_items (id, deal_id, company_id, product_id, kind, quantity, unit_price, discount, service_category_id, position) values
  ('00000000-0000-4000-8000-00000000d201', '00000000-0000-4000-8000-00000000de02', '00000000-0000-4000-8000-0000000000d1',
   '00000000-0000-4000-8000-00000000aa01', 'setup', 2, 1000, 500, '00000000-0000-4000-8000-00000000ca01', 0),
  ('00000000-0000-4000-8000-00000000d202', '00000000-0000-4000-8000-00000000de02', '00000000-0000-4000-8000-0000000000d1',
   '00000000-0000-4000-8000-00000000aa02', 'recurring', 1, 800, 0, '00000000-0000-4000-8000-00000000ca02', 1);
-- D3: será ativado.
insert into deals (id, company_id, owner_id, title, pipeline_id, stage_id, organization_id, service_category_id,
                   setup_total, setup_installments, setup_first_due, mrr, mrr_start, contract_months) values
  ('00000000-0000-4000-8000-00000000de03', '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000c2', 'tst-Ativo',
   '00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-00000000b001',
   '00000000-0000-4000-8000-00000000ca01', 3000, 3, '2026-11-01', 5000, '2026-11-01', 12);

-- Liga o Financeiro da empresa d1 como admin geral.
select pg_temp.as_user('00000000-0000-4000-8000-0000000000c1');
update companies set finance_enabled = true where id = '00000000-0000-4000-8000-0000000000d1';

-- O vendedor (sem view_finance) ganha os negócios.
select pg_temp.as_user('00000000-0000-4000-8000-0000000000c2');
update deals set status = 'won' where id in ('00000000-0000-4000-8000-00000000de00', '00000000-0000-4000-8000-00000000de01',
  '00000000-0000-4000-8000-00000000de02', '00000000-0000-4000-8000-00000000de03');
select is((select count(*)::int from fin_contracts), 0, 'vendedor sem view_finance não enxerga contratos');

select pg_temp.as_pg();
select is((select count(*)::int from fin_contracts where deal_id = '00000000-0000-4000-8000-00000000de00'), 0,
  'Financeiro desligado: ganhar não cria contrato');
select is((select status || '|' || title || '|' || organization_id::text from fin_contracts where deal_id = '00000000-0000-4000-8000-00000000de01'),
  'draft|tst-Acme|00000000-0000-4000-8000-00000000b001', 'negócio ganho vira contrato rascunho com título e cliente');
select results_eq(
  $$ select l.kind, l.amount, l.first_month, l.installments, l.months, l.service_category_id
       from fin_contract_lines l join fin_contracts c on c.id = l.contract_id
      where c.deal_id = '00000000-0000-4000-8000-00000000de01' order by l.kind $$,
  $$ values ('recurring'::text, 5000.00::numeric, '2026-11-01'::date, 1, 12, '00000000-0000-4000-8000-00000000ca01'::uuid),
            ('setup', 3000.00, '2026-11-01', 3, null::int, '00000000-0000-4000-8000-00000000ca01') $$,
  'sem itens: uma linha setup e uma recorrente com a categoria do negócio');
select is((select count(*)::int from fin_entries e join fin_contracts c on c.id = e.contract_id
            where c.deal_id = '00000000-0000-4000-8000-00000000de01'), 0, 'rascunho não gera entries');
select results_eq(
  $$ select l.kind, l.amount, l.first_month, l.installments, l.months, l.service_category_id
       from fin_contract_lines l join fin_contracts c on c.id = l.contract_id
      where c.deal_id = '00000000-0000-4000-8000-00000000de02' order by l.kind $$,
  $$ values ('recurring'::text, 800.00::numeric, '2027-01-01'::date, 1, 6, '00000000-0000-4000-8000-00000000ca02'::uuid),
            ('setup', 1500.00, '2026-12-01', 2, null::int, '00000000-0000-4000-8000-00000000ca01') $$,
  'dois itens: duas linhas com o total e a categoria de cada item');

-- Mudanças no negócio ganho com o contrato em rascunho.
select pg_temp.as_user('00000000-0000-4000-8000-0000000000c2');
update deals set mrr = 6000 where id = '00000000-0000-4000-8000-00000000de01';
select pg_temp.as_pg();
select is((select l.amount from fin_contract_lines l join fin_contracts c on c.id = l.contract_id
            where c.deal_id = '00000000-0000-4000-8000-00000000de01' and l.kind = 'recurring'), 6000.00::numeric,
  'mudar o MRR do negócio ganho atualiza a linha do rascunho');

select pg_temp.as_user('00000000-0000-4000-8000-0000000000c2');
update deal_items set service_category_id = '00000000-0000-4000-8000-00000000ca02', unit_price = 900
 where id = '00000000-0000-4000-8000-00000000d202';
select pg_temp.as_pg();
select is((select l.amount::text || '|' || l.service_category_id::text from fin_contract_lines l join fin_contracts c on c.id = l.contract_id
            where c.deal_id = '00000000-0000-4000-8000-00000000de02' and l.kind = 'recurring'),
  '900.00|00000000-0000-4000-8000-00000000ca02', 'mudar o item atualiza a linha do rascunho');
update deal_items set service_category_id = '00000000-0000-4000-8000-00000000ca02' where id = '00000000-0000-4000-8000-00000000d201';
select is((select l.service_category_id from fin_contract_lines l join fin_contracts c on c.id = l.contract_id
            where c.deal_id = '00000000-0000-4000-8000-00000000de02' and l.kind = 'setup'),
  '00000000-0000-4000-8000-00000000ca02'::uuid, 'mudar só a categoria do item reconstrói o rascunho');
delete from deal_items where id = '00000000-0000-4000-8000-00000000d202';
select is((select count(*)::int from fin_contract_lines l join fin_contracts c on c.id = l.contract_id
            where c.deal_id = '00000000-0000-4000-8000-00000000de02'), 1, 'remover o item recorrente remove a linha');

select pg_temp.as_user('00000000-0000-4000-8000-0000000000c2');
update deals set status = 'open' where id = '00000000-0000-4000-8000-00000000de01';
select pg_temp.as_pg();
select is((select count(*)::int from fin_contracts where deal_id = '00000000-0000-4000-8000-00000000de01'), 0,
  'reabrir o negócio com o contrato em rascunho apaga o contrato');

-- Ativação.
select pg_temp.as_user('00000000-0000-4000-8000-0000000000c4');
select is(pg_temp.detail_of($q$select public.fin_activate_contract((select id from fin_contracts where deal_id = '00000000-0000-4000-8000-00000000de03'))$q$),
  'Dia de vencimento, Conta, Regra de fim de vigência', 'ativar sem dia, conta e regra lista o que falta');
select throws_ok($q$select public.fin_activate_contract((select id from fin_contracts where deal_id = '00000000-0000-4000-8000-00000000de03'))$q$,
  'P0001', 'Faltam dados para ativar o contrato', 'mensagem e código da validação');

insert into fin_contracts (id, company_id, title) values
  ('00000000-0000-4000-8000-00000000cf01', '00000000-0000-4000-8000-0000000000d1', 'tst-vazio');
select is(pg_temp.detail_of($q$select public.fin_activate_contract('00000000-0000-4000-8000-00000000cf01')$q$),
  'Cliente, Dia de vencimento, Conta, Regra de fim de vigência, Linhas', 'contrato vazio lista todos os rótulos na ordem');
insert into fin_contract_lines (contract_id, company_id, kind, description, amount, first_month, months) values
  ('00000000-0000-4000-8000-00000000cf01', '00000000-0000-4000-8000-0000000000d1', 'recurring', 'Sem categoria', 100, '2026-11-01', 3);
update fin_contracts set organization_id = '00000000-0000-4000-8000-00000000b001', due_day = 5,
  account_id = '00000000-0000-4000-8000-00000000ac01', end_rule = 'ends' where id = '00000000-0000-4000-8000-00000000cf01';
select is(pg_temp.detail_of($q$select public.fin_activate_contract('00000000-0000-4000-8000-00000000cf01')$q$),
  'Categoria de serviço', 'linha sem categoria impede a ativação');

update fin_contracts set due_day = 10, account_id = '00000000-0000-4000-8000-00000000ac01', end_rule = 'ends'
 where deal_id = '00000000-0000-4000-8000-00000000de03';

select pg_temp.as_user('00000000-0000-4000-8000-0000000000c3');
select throws_ok($q$select public.fin_activate_contract((select id from fin_contracts where deal_id = '00000000-0000-4000-8000-00000000de03'))$q$,
  '42501', null, 'usuário só com view_finance não ativa');
select pg_temp.as_user('00000000-0000-4000-8000-0000000000c2');
select throws_ok($q$select public.fin_activate_contract((select id from fin_contracts where deal_id = '00000000-0000-4000-8000-00000000de01'))$q$,
  '42501', null, 'vendedor sem Financeiro não ativa');

select pg_temp.as_user('00000000-0000-4000-8000-0000000000c4');
select lives_ok($q$select public.fin_activate_contract((select id from fin_contracts where deal_id = '00000000-0000-4000-8000-00000000de03'))$q$,
  'ativação completa');
select is((select status from fin_contracts where deal_id = '00000000-0000-4000-8000-00000000de03'), 'active', 'contrato fica ativo');
select is((select count(*)::int || '|' || sum(gross)::text from fin_entries e join fin_contracts c on c.id = e.contract_id
            where c.deal_id = '00000000-0000-4000-8000-00000000de03'), '15|63000.00', 'ativação gera 3 parcelas de setup e 12 mensalidades');

create temp table tst_before on commit drop as
  select e.id from fin_entries e join fin_contracts c on c.id = e.contract_id where c.deal_id = '00000000-0000-4000-8000-00000000de03';
grant select on tst_before to public;

-- Reabrir o negócio com o contrato ativo.
select pg_temp.as_user('00000000-0000-4000-8000-0000000000c2');
update deals set status = 'open' where id = '00000000-0000-4000-8000-00000000de03';
update deals set mrr = 9000 where id = '00000000-0000-4000-8000-00000000de03';
select pg_temp.as_pg();
select is((select status || '|' || source_changed::text from fin_contracts where deal_id = '00000000-0000-4000-8000-00000000de03'),
  'active|true', 'contrato ativo continua e ganha source_changed');
select is((select l.amount from fin_contract_lines l join fin_contracts c on c.id = l.contract_id
            where c.deal_id = '00000000-0000-4000-8000-00000000de03' and l.kind = 'recurring'), 5000.00::numeric,
  'as linhas do contrato ativo não mudam');
select set_eq($$ select e.id from fin_entries e join fin_contracts c on c.id = e.contract_id
                  where c.deal_id = '00000000-0000-4000-8000-00000000de03' $$,
  $$ select id from tst_before $$, 'as entries continuam as mesmas');

select pg_temp.as_user('00000000-0000-4000-8000-0000000000c4');
select throws_ok($q$select public.fin_draft_from_deal('00000000-0000-4000-8000-00000000de02')$q$,
  '42501', null, 'fin_draft_from_deal não é executável pelo app');

select * from finish();
rollback;
