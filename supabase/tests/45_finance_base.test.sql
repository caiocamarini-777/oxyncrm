begin;
select plan(12);

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


insert into roles (id, name, description, permissions) values
  ('00000000-0000-4000-8000-0000000000e1', 'tst-SemFin', 't', '{"visibility":{"leads":"own","deals":"own","persons":"own","organizations":"own","activities":"own"},"actions":{"create":true,"edit":true,"delete":false,"export":false,"reassign_owner":false},"settings":{"manage_pipelines":false,"manage_custom_fields":false,"manage_products":false,"view_reports":true,"create_dashboards":true,"share_dashboards":false}}'::jsonb),
  ('00000000-0000-4000-8000-0000000000e2', 'tst-VerFin', 't', '{"visibility":{"leads":"own","deals":"own","persons":"own","organizations":"own","activities":"own"},"actions":{"create":true,"edit":true,"delete":false,"export":false,"reassign_owner":false},"settings":{"manage_pipelines":false,"manage_custom_fields":false,"manage_products":false,"view_reports":true,"create_dashboards":true,"share_dashboards":false,"view_finance":true}}'::jsonb),
  ('00000000-0000-4000-8000-0000000000e3', 'tst-GerFin', 't', '{"visibility":{"leads":"own","deals":"own","persons":"own","organizations":"own","activities":"own"},"actions":{"create":true,"edit":true,"delete":false,"export":false,"reassign_owner":false},"settings":{"manage_pipelines":false,"manage_custom_fields":false,"manage_products":false,"view_reports":true,"create_dashboards":true,"share_dashboards":false,"manage_finance":true}}'::jsonb);
insert into memberships (user_id, company_id, role_id) values
  ('00000000-0000-4000-8000-0000000000c2', '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000e1'),
  ('00000000-0000-4000-8000-0000000000c3', '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000e2'),
  ('00000000-0000-4000-8000-0000000000c4', '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000e3');

insert into companies (id, name, slug) values
  ('00000000-0000-4000-8000-0000000000d2', 'Fin Outra', 'tst-fin2');

-- Liga o Financeiro como admin geral (o semeador de serviço exige super admin).
select pg_temp.as_user('00000000-0000-4000-8000-0000000000c1');
update companies set finance_enabled = true where id in
  ('00000000-0000-4000-8000-0000000000d1','00000000-0000-4000-8000-0000000000d2');

select is((select count(*)::int from fin_expense_categories where company_id = '00000000-0000-4000-8000-0000000000d1'), 12, 'ligar cria 12 categorias de despesa');
select is((select count(*)::int from fin_income_categories where company_id = '00000000-0000-4000-8000-0000000000d1'), 4, 'ligar cria 4 categorias de receita');
select is((select count(*)::int from service_categories where company_id = '00000000-0000-4000-8000-0000000000d1'), 6, 'ligar cria 6 categorias de serviço');
select is((select default_nature from fin_expense_categories where company_id = '00000000-0000-4000-8000-0000000000d1' and name = 'Pró-labore'), 'fixed', 'Pró-labore é fixa');

-- Religar não duplica.
update companies set finance_enabled = false where id = '00000000-0000-4000-8000-0000000000d1';
update companies set finance_enabled = true where id = '00000000-0000-4000-8000-0000000000d1';
select is((select count(*)::int from fin_expense_categories where company_id = '00000000-0000-4000-8000-0000000000d1')
        + (select count(*)::int from fin_income_categories where company_id = '00000000-0000-4000-8000-0000000000d1')
        + (select count(*)::int from service_categories where company_id = '00000000-0000-4000-8000-0000000000d1'), 22, 'religar não duplica');

-- Gerente insere conta e saldo.
select pg_temp.as_user('00000000-0000-4000-8000-0000000000c4');
select lives_ok($q$insert into fin_accounts (id, company_id, name, bank) values ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000d1', 'Caixa', 'Itaú')$q$, 'manage_finance insere conta');
select lives_ok($q$insert into fin_balance_snapshots (company_id, account_id, as_of, balance) values ('00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000a1', '2026-10-01', 1000.50)$q$, 'manage_finance insere saldo');

-- Duplicidade conta/data.
select throws_ok($q$insert into fin_balance_snapshots (company_id, account_id, as_of, balance) values ('00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000a1', '2026-10-01', 5)$q$, '23505', null, 'mesmo saldo conta+data falha');

-- Conta de outra empresa.
select pg_temp.as_pg();
insert into fin_accounts (id, company_id, name) values ('00000000-0000-4000-8000-0000000000a2', '00000000-0000-4000-8000-0000000000d2', 'Outra');
select pg_temp.as_user('00000000-0000-4000-8000-0000000000c4');
select throws_ok($q$insert into fin_balance_snapshots (company_id, account_id, as_of, balance) values ('00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000a2', '2026-10-02', 5)$q$, 'P0001', 'OXYN_CROSS_COMPANY', 'saldo com conta de outra empresa é rejeitado');

-- view_finance lê, não insere.
select pg_temp.as_user('00000000-0000-4000-8000-0000000000c3');
select is((select count(*)::int from fin_accounts where company_id = '00000000-0000-4000-8000-0000000000d1'), 1, 'view_finance lê a conta');
select throws_ok($q$insert into fin_accounts (company_id, name) values ('00000000-0000-4000-8000-0000000000d1', 'Nova')$q$, '42501', null, 'view_finance não insere conta');

-- Sem chaves: 0 linhas.
select pg_temp.as_user('00000000-0000-4000-8000-0000000000c2');
select is((select count(*)::int from fin_accounts) + (select count(*)::int from fin_balance_snapshots)
        + (select count(*)::int from fin_expense_categories) + (select count(*)::int from fin_income_categories), 0, 'sem chaves lê 0 linhas');

select * from finish();
rollback;
