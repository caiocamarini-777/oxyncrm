begin;
select plan(28);

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
-- mês corrente (São Paulo) deslocado em n meses
create function pg_temp.m(n int) returns date language sql as $$
  select (public.fin_current_month() + make_interval(months => n))::date;
$$;
grant execute on function pg_temp.as_user(uuid), pg_temp.as_pg(), pg_temp.m(int) to public;

insert into companies (id, name, slug) values
  ('00000000-0000-4000-8000-0000000000d1', 'Fin Ajustes', 'tst-fin-fix'),
  ('00000000-0000-4000-8000-0000000000d2', 'Fin Ajustes Off', 'tst-fin-fix-off');

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-0000000000c1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tst-admin@oxyn.test', '{"full_name":"admin"}'),
  ('00000000-0000-4000-8000-0000000000c2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tst-vendedor@oxyn.test', '{"full_name":"vendedor"}'),
  ('00000000-0000-4000-8000-0000000000c4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tst-gerfin@oxyn.test', '{"full_name":"gerente"}');
update profiles set is_super_admin = true where id = '00000000-0000-4000-8000-0000000000c1';

insert into roles (id, name, description, permissions) values
  ('00000000-0000-4000-8000-0000000000e1', 'tst-Vendedor', 't', '{"visibility":{"leads":"company","deals":"company","persons":"company","organizations":"company","activities":"company"},"actions":{"create":true,"edit":true,"delete":false,"export":false,"reassign_owner":false},"settings":{"manage_pipelines":false,"manage_custom_fields":false,"manage_products":false,"view_reports":true,"create_dashboards":true,"share_dashboards":false}}'::jsonb),
  ('00000000-0000-4000-8000-0000000000e3', 'tst-GerFin', 't', '{"visibility":{"leads":"own","deals":"own","persons":"own","organizations":"own","activities":"own"},"actions":{"create":true,"edit":true,"delete":false,"export":false,"reassign_owner":false},"settings":{"manage_pipelines":false,"manage_custom_fields":false,"manage_products":false,"view_reports":true,"create_dashboards":true,"share_dashboards":false,"manage_finance":true}}'::jsonb);
insert into memberships (user_id, company_id, role_id) values
  ('00000000-0000-4000-8000-0000000000c2', '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000e1'),
  ('00000000-0000-4000-8000-0000000000c4', '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000e3'),
  ('00000000-0000-4000-8000-0000000000c4', '00000000-0000-4000-8000-0000000000d2', '00000000-0000-4000-8000-0000000000e3');

select pg_temp.as_user('00000000-0000-4000-8000-0000000000c1');
update companies set finance_enabled = true where id = '00000000-0000-4000-8000-0000000000d1';
select pg_temp.as_pg();

insert into pipelines (id, company_id, name) values
  ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000d1', 'tst-funil');
insert into stages (id, pipeline_id, company_id, name, position) values
  ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000d1', 'tst-etapa', 0);
insert into service_categories (id, company_id, name) values
  ('00000000-0000-4000-8000-00000000ca01', '00000000-0000-4000-8000-0000000000d1', 'tst-cat-1');
insert into products (id, company_id, name, kind) values
  ('00000000-0000-4000-8000-00000000aa02', '00000000-0000-4000-8000-0000000000d1', 'tst-mensal', 'recurring');
insert into organizations (id, company_id, owner_id, name) values
  ('00000000-0000-4000-8000-00000000b001', '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000c2', 'tst-cliente');
insert into fin_accounts (id, company_id, name) values
  ('00000000-0000-4000-8000-00000000ac01', '00000000-0000-4000-8000-0000000000d1', 'tst-conta');

-- ===== 1. Comissão estimada: só do mês corrente em diante e nunca somada à real =====
insert into fin_contracts (id, company_id, organization_id, account_id, title, status, due_day, end_rule) values
  ('00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-00000000b001',
   '00000000-0000-4000-8000-00000000ac01', 'tst-Comissão', 'active', 10, 'ends');
insert into fin_contract_lines (id, contract_id, company_id, kind, description, recurring_rate, estimated_monthly, first_month, months) values
  ('00000000-0000-4000-8000-000000000a11', '00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-0000000000d1',
   'commission', 'Comissão', 10, 1000, pg_temp.m(-2), 6);

create temp view tst_est as
  select competence from fin_entries
   where contract_line_id = '00000000-0000-4000-8000-000000000a11' and estimated and status = 'open';
select is((select count(*)::int || '|' || min(competence)::text from tst_est), '4|' || pg_temp.m(0)::text,
  'estimativa: só do mês corrente em diante (4 de 6 meses)');

insert into fin_client_sales (id, company_id, contract_id, contract_line_id, buyer, sold_on, recurring_value, recurring_start, recurring_months) values
  ('00000000-0000-4000-8000-000000005a01', '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000f1',
   '00000000-0000-4000-8000-000000000a11', 'tst-Comprador', pg_temp.m(0), 5000, pg_temp.m(0), 1);
select is((select count(*)::int || '|' || min(competence)::text || '|' || sum(gross)::text from fin_entries
            where client_sale_id = '00000000-0000-4000-8000-000000005a01'), '1|' || pg_temp.m(1)::text || '|500.00',
  'venda gera a comissão real no mês seguinte');
select is((select count(*)::int from tst_est where competence = pg_temp.m(1)), 0,
  'competência com comissão real perde a estimativa');
select is((select count(*)::int || '|' || sum(gross)::text from fin_entries
            where contract_id = '00000000-0000-4000-8000-0000000000f1' and competence = pg_temp.m(1) and status <> 'cancelled'),
  '1|500.00', 'a competência soma só a comissão real');
select is((select count(*)::int from tst_est), 3, 'as outras estimativas continuam');

update fin_entries set status = 'cancelled' where client_sale_id = '00000000-0000-4000-8000-000000005a01';
select is((select count(*)::int from tst_est where competence = pg_temp.m(1)), 1,
  'cancelar o lançamento de venda devolve a estimativa');
update fin_entries set status = 'open' where client_sale_id = '00000000-0000-4000-8000-000000005a01';
select is((select count(*)::int from tst_est where competence = pg_temp.m(1)), 0,
  'reabrir o lançamento de venda tira a estimativa de novo');

update fin_contract_lines set estimated_monthly = 1200 where id = '00000000-0000-4000-8000-000000000a11';
select is((select count(*)::int from tst_est where competence = pg_temp.m(1)), 0,
  'regerar o contrato não recria a estimativa onde há venda');

update fin_client_sales set status = 'cancelled' where id = '00000000-0000-4000-8000-000000005a01';
select is((select count(*)::int from tst_est), 4, 'cancelar a venda devolve a estimativa');

-- ===== 5. Cancelar contrato / inativar despesa: as abertas vencidas ficam =====
insert into fin_contracts (id, company_id, title, status, due_day, end_rule) values
  ('00000000-0000-4000-8000-0000000000f2', '00000000-0000-4000-8000-0000000000d1', 'tst-Cancelado', 'active', 10, 'ends');
insert into fin_contract_lines (contract_id, company_id, kind, description, amount, first_month, months) values
  ('00000000-0000-4000-8000-0000000000f2', '00000000-0000-4000-8000-0000000000d1', 'recurring', 'Mensal', 100, pg_temp.m(-2), 4);
select is((select count(*)::int from fin_entries where contract_id = '00000000-0000-4000-8000-0000000000f2'), 4, 'contrato gera 4 meses');
update fin_contracts set status = 'cancelled' where id = '00000000-0000-4000-8000-0000000000f2';
select is((select string_agg(competence::text, ',' order by competence) from fin_entries
            where contract_id = '00000000-0000-4000-8000-0000000000f2' and status = 'open'),
  pg_temp.m(-2)::text || ',' || pg_temp.m(-1)::text, 'contrato cancelado mantém as abertas vencidas e tira as do mês corrente em diante');

insert into fin_recurring_expenses (id, company_id, description, expense_category_id, nature, amount, due_day, start_month, installments) values
  ('00000000-0000-4000-8000-000000000e01', '00000000-0000-4000-8000-0000000000d1', 'tst-Aluguel',
   (select id from fin_expense_categories where company_id = '00000000-0000-4000-8000-0000000000d1' order by position, name limit 1),
   'fixed', 500, 5, pg_temp.m(-2), 4);
update fin_recurring_expenses set active = false where id = '00000000-0000-4000-8000-000000000e01';
select is((select string_agg(competence::text, ',' order by competence) from fin_entries
            where recurring_expense_id = '00000000-0000-4000-8000-000000000e01'),
  pg_temp.m(-2)::text || ',' || pg_temp.m(-1)::text, 'despesa inativada mantém as abertas vencidas');
update fin_recurring_expenses set active = true where id = '00000000-0000-4000-8000-000000000e01';
select is((select count(*)::int from fin_entries where recurring_expense_id = '00000000-0000-4000-8000-000000000e01'), 4,
  'reativar a despesa volta aos 4 meses sem duplicar');

-- ===== 3. Retenção nunca passa do bruto =====
insert into fin_entries (company_id, direction, source_kind, due_date, competence, gross, retention, description) values
  ('00000000-0000-4000-8000-0000000000d1', 'in', 'manual', pg_temp.m(0), pg_temp.m(0), 100, 10, 'tst-retencao');
select throws_ok($q$update fin_entries set gross = 5 where description = 'tst-retencao'$q$, '23514', null,
  'bruto menor que a retenção viola o check');
select throws_ok($q$insert into fin_entries (company_id, direction, source_kind, due_date, competence, gross, retention, description)
  values ('00000000-0000-4000-8000-0000000000d1', 'in', 'manual', '2026-10-01', '2026-10-01', 1, 2, 'x')$q$, '23514', null,
  'inserir com retenção maior que o bruto falha');

-- ===== 9. Rascunho → ativo só por fin_activate_contract =====
insert into fin_contracts (id, company_id, organization_id, account_id, title, status, due_day, end_rule) values
  ('00000000-0000-4000-8000-0000000000f3', '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-00000000b001',
   '00000000-0000-4000-8000-00000000ac01', 'tst-Rascunho', 'draft', 10, 'ends');
insert into fin_contract_lines (contract_id, company_id, kind, description, amount, first_month, months, service_category_id) values
  ('00000000-0000-4000-8000-0000000000f3', '00000000-0000-4000-8000-0000000000d1', 'recurring', 'Mensal', 100, pg_temp.m(0), 2,
   '00000000-0000-4000-8000-00000000ca01');
select pg_temp.as_user('00000000-0000-4000-8000-0000000000c4');
select throws_ok($q$update fin_contracts set status = 'active' where id = '00000000-0000-4000-8000-0000000000f3'$q$,
  'P0001', 'OXYN_CONTRACT_ACTIVATE_VIA_RPC', 'gestor não ativa rascunho com UPDATE direto');
select pg_temp.as_pg();
select throws_ok($q$update fin_contracts set status = 'active' where id = '00000000-0000-4000-8000-0000000000f3'$q$,
  'P0001', 'OXYN_CONTRACT_ACTIVATE_VIA_RPC', 'nem o dono do banco sem a marca');
select pg_temp.as_user('00000000-0000-4000-8000-0000000000c4');
select lives_ok($q$select public.fin_activate_contract('00000000-0000-4000-8000-0000000000f3')$q$, 'fin_activate_contract ativa');
select is((select status || '|' || coalesce(current_setting('oxyn.activating_contract', true), '') from fin_contracts
            where id = '00000000-0000-4000-8000-0000000000f3'), 'active|', 'ativo, e a marca é limpa depois');
select lives_ok($q$update fin_contracts set status = 'cancelled' where id = '00000000-0000-4000-8000-0000000000f3'$q$,
  'outras mudanças de status seguem livres');
select pg_temp.as_pg();

-- ===== 6. Ponte: só a transição para ganho cria rascunho =====
select pg_temp.as_user('00000000-0000-4000-8000-0000000000c2');
insert into deals (id, company_id, owner_id, title, pipeline_id, stage_id, organization_id, service_category_id, mrr, mrr_start, contract_months) values
  ('00000000-0000-4000-8000-00000000de01', '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000c2', 'tst-Ganho',
   '00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-00000000b001',
   '00000000-0000-4000-8000-00000000ca01', 1000, pg_temp.m(1), 12);
update deals set status = 'won' where id = '00000000-0000-4000-8000-00000000de01';
select pg_temp.as_pg();
select is((select count(*)::int from fin_contracts where deal_id = '00000000-0000-4000-8000-00000000de01'), 1, 'ganhar cria o rascunho');
delete from fin_contracts where deal_id = '00000000-0000-4000-8000-00000000de01';
select pg_temp.as_user('00000000-0000-4000-8000-0000000000c2');
update deals set title = 'tst-Ganho editado' where id = '00000000-0000-4000-8000-00000000de01';
insert into deal_items (deal_id, company_id, product_id, kind, quantity, unit_price, discount, position) values
  ('00000000-0000-4000-8000-00000000de01', '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-00000000aa02', 'recurring', 1, 800, 0, 0);
select pg_temp.as_pg();
select is((select count(*)::int from fin_contracts where deal_id = '00000000-0000-4000-8000-00000000de01'), 0,
  'editar negócio já ganho (título e itens) sem contrato não cria rascunho');
select pg_temp.as_user('00000000-0000-4000-8000-0000000000c2');
update deals set status = 'open' where id = '00000000-0000-4000-8000-00000000de01';
update deals set status = 'won' where id = '00000000-0000-4000-8000-00000000de01';
select pg_temp.as_pg();
select is((select count(*)::int from fin_contracts where deal_id = '00000000-0000-4000-8000-00000000de01'), 1,
  'reabrir e ganhar de novo cria o rascunho');

-- ===== 8. fin_extend_horizon: isola erros por linha e ignora empresa desligada =====
insert into fin_contracts (id, company_id, title, status, due_day, end_rule) values
  ('00000000-0000-4000-8000-0000000000f4', '00000000-0000-4000-8000-0000000000d2', 'tst-Desligada', 'active', 10, 'auto_renew'),
  ('00000000-0000-4000-8000-0000000000f5', '00000000-0000-4000-8000-0000000000d1', 'tst-BOOM', 'active', 10, 'auto_renew'),
  ('00000000-0000-4000-8000-0000000000f6', '00000000-0000-4000-8000-0000000000d1', 'tst-Saudável', 'active', 10, 'auto_renew');
insert into fin_contract_lines (contract_id, company_id, kind, description, amount, first_month, months) values
  ('00000000-0000-4000-8000-0000000000f4', '00000000-0000-4000-8000-0000000000d2', 'recurring', 'Mensal', 100, pg_temp.m(0), 12),
  ('00000000-0000-4000-8000-0000000000f5', '00000000-0000-4000-8000-0000000000d1', 'recurring', 'Mensal', 100, pg_temp.m(0), 12),
  ('00000000-0000-4000-8000-0000000000f6', '00000000-0000-4000-8000-0000000000d1', 'recurring', 'Mensal', 100, pg_temp.m(0), 12);
delete from fin_entries where contract_id in ('00000000-0000-4000-8000-0000000000f4', '00000000-0000-4000-8000-0000000000f6');
create function public.tst_boom() returns trigger language plpgsql as $$
begin
  if new.description like 'tst-BOOM%' then raise exception 'tst boom'; end if;
  return new;
end $$;
create trigger tst_boom before insert on fin_entries for each row execute function public.tst_boom();
select lives_ok($q$select public.fin_extend_horizon()$q$, 'um contrato com erro não derruba o job');
select is((select count(*)::int from fin_entries where contract_id = '00000000-0000-4000-8000-0000000000f6'), 36,
  'o contrato saudável é regenerado mesmo com outro falhando');
select is((select count(*)::int from fin_entries where contract_id = '00000000-0000-4000-8000-0000000000f4'), 0,
  'empresa com Financeiro desligado é ignorada');
drop trigger tst_boom on fin_entries;

-- ===== 7. fin_my_companies: acesso em todas as empresas numa chamada =====
select pg_temp.as_user('00000000-0000-4000-8000-0000000000c4');
select is((select string_agg(company_id::text || '|' || can_view || '|' || can_manage || '|' || can_sell, ',')
             from public.fin_my_companies() where company_id in ('00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000d2')),
  '00000000-0000-4000-8000-0000000000d1|true|true|true', 'gestor: só a empresa com Financeiro ligado, com as três permissões');
select pg_temp.as_user('00000000-0000-4000-8000-0000000000c2');
select is((select count(*)::int from public.fin_my_companies() where company_id = '00000000-0000-4000-8000-0000000000d1'), 0,
  'membro sem chaves de Financeiro não recebe a empresa');
select pg_temp.as_pg();

select * from finish();
rollback;
