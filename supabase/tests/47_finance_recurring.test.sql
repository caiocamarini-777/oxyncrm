begin;
select plan(19);

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
  ('00000000-0000-4000-8000-0000000000d1', 'Fin Recorrentes', 'tst-fin-rc'),
  ('00000000-0000-4000-8000-0000000000d2', 'Fin Outra', 'tst-fin-rc2');

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-0000000000c1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tst-admin@oxyn.test', '{"full_name":"admin"}'),
  ('00000000-0000-4000-8000-0000000000c2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tst-nokeys@oxyn.test', '{"full_name":"nokeys"}'),
  ('00000000-0000-4000-8000-0000000000c4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tst-manager@oxyn.test', '{"full_name":"manager"}');
update profiles set is_super_admin = true where id = '00000000-0000-4000-8000-0000000000c1';

insert into roles (id, name, description, permissions) values
  ('00000000-0000-4000-8000-0000000000e1', 'tst-SemFin', 't', '{"visibility":{"leads":"own","deals":"own","persons":"own","organizations":"own","activities":"own"},"actions":{"create":true,"edit":true,"delete":false,"export":false,"reassign_owner":false},"settings":{"manage_pipelines":false,"manage_custom_fields":false,"manage_products":false,"view_reports":true,"create_dashboards":true,"share_dashboards":false}}'::jsonb),
  ('00000000-0000-4000-8000-0000000000e3', 'tst-GerFin', 't', '{"visibility":{"leads":"own","deals":"own","persons":"own","organizations":"own","activities":"own"},"actions":{"create":true,"edit":true,"delete":false,"export":false,"reassign_owner":false},"settings":{"manage_pipelines":false,"manage_custom_fields":false,"manage_products":false,"view_reports":true,"create_dashboards":true,"share_dashboards":false,"manage_finance":true}}'::jsonb);
insert into memberships (user_id, company_id, role_id) values
  ('00000000-0000-4000-8000-0000000000c2', '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000e1'),
  ('00000000-0000-4000-8000-0000000000c4', '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000e3');

select pg_temp.as_user('00000000-0000-4000-8000-0000000000c1');
update companies set finance_enabled = true where id = '00000000-0000-4000-8000-0000000000d1';

select pg_temp.as_pg();
insert into fin_expense_categories (id, company_id, name, default_nature) values
  ('00000000-0000-4000-8000-0000000000b2', '00000000-0000-4000-8000-0000000000d2', 'Outra empresa', 'fixed');

select pg_temp.as_user('00000000-0000-4000-8000-0000000000c4');
insert into fin_expense_categories (id, company_id, name, default_nature) values
  ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000d1', 'Aluguel', 'fixed');

-- A: mensal de 500, 10 parcelas a partir de 2026-10.
insert into fin_recurring_expenses (id, company_id, description, expense_category_id, nature, amount, due_day, start_month, end_month, installments) values
  ('00000000-0000-4000-8000-000000000e01', '00000000-0000-4000-8000-0000000000d1', 'Aluguel sala', '00000000-0000-4000-8000-0000000000b1', 'fixed', 500, 5, '2026-10-01', '2027-07-01', 10);
select is((select count(*)::int from fin_entries where recurring_expense_id = '00000000-0000-4000-8000-000000000e01'), 10, 'mensal com 10 parcelas gera 10 entries');
select is((select max(competence)::text || '|' || (array_agg(description order by competence desc))[1] from fin_entries where recurring_expense_id = '00000000-0000-4000-8000-000000000e01'),
  '2027-07-01|Aluguel sala (10/10)', 'última parcela em 2027-07 com (10/10)');
select is((select count(*)::int from fin_entries where recurring_expense_id = '00000000-0000-4000-8000-000000000e01'
             and direction = 'out' and source_kind = 'recurring' and nature = 'fixed'
             and expense_category_id = '00000000-0000-4000-8000-0000000000b1' and gross = 500 and retention = 0), 10,
  'entries de saída com natureza, categoria e valor da despesa');

-- B: trimestral até o fim do horizonte, do início do horizonte.
insert into fin_recurring_expenses (id, company_id, description, expense_category_id, nature, amount, frequency, due_day, start_month, end_month) values
  ('00000000-0000-4000-8000-000000000e02', '00000000-0000-4000-8000-0000000000d1', 'Seguro', '00000000-0000-4000-8000-0000000000b1', 'fixed', 900, 'quarterly', 10,
   (public.fin_horizon_end() - interval '36 months')::date, (public.fin_horizon_end() - interval '1 month')::date);
select is((select count(*)::int || '|' || max(competence)::text from fin_entries where recurring_expense_id = '00000000-0000-4000-8000-000000000e02'),
  '12|' || (public.fin_horizon_end() - interval '3 months')::date::text, 'trimestral: de 3 em 3 meses até o horizonte');
insert into fin_recurring_expenses (id, company_id, description, expense_category_id, nature, amount, frequency, due_day, start_month, end_month) values
  ('00000000-0000-4000-8000-000000000e05', '00000000-0000-4000-8000-0000000000d1', 'Anuidade', '00000000-0000-4000-8000-0000000000b1', 'fixed', 1200, 'yearly', 10,
   (public.fin_horizon_end() - interval '36 months')::date, (public.fin_horizon_end() - interval '1 month')::date);
select is((select count(*)::int from fin_entries where recurring_expense_id = '00000000-0000-4000-8000-000000000e05'), 3, 'anual: 3 ocorrências em 36 meses');

-- C: end_month inclusive.
insert into fin_recurring_expenses (id, company_id, description, expense_category_id, nature, amount, due_day, start_month, end_month) values
  ('00000000-0000-4000-8000-000000000e03', '00000000-0000-4000-8000-0000000000d1', 'Software', '00000000-0000-4000-8000-0000000000b1', 'variable', 100, 15, '2026-10-01', '2026-12-01');
select is((select count(*)::int || '|' || max(competence)::text from fin_entries where recurring_expense_id = '00000000-0000-4000-8000-000000000e03'),
  '3|2026-12-01', 'end_month inclusive: última competência é dezembro');

-- D: reajuste de 5% em janeiro.
insert into fin_recurring_expenses (id, company_id, description, expense_category_id, nature, amount, due_day, start_month, end_month, adjust_rate, adjust_month) values
  ('00000000-0000-4000-8000-000000000e04', '00000000-0000-4000-8000-0000000000d1', 'Internet', '00000000-0000-4000-8000-0000000000b1', 'fixed', 500, 20, '2026-10-01', '2028-12-01', 5, 1);
select is((select array_agg(gross order by competence) from fin_entries where recurring_expense_id = '00000000-0000-4000-8000-000000000e04'
             and competence in ('2026-10-01','2026-11-01','2026-12-01','2027-01-01','2028-01-01')),
  array[500.00, 500.00, 500.00, 525.00, 551.25]::numeric[], 'reajuste anual: 500 até dez, 525 em jan/27, 551,25 em jan/28');

-- Liquidada + travada + edição.
update fin_entries set status = 'settled', settled_on = '2026-11-20', settled_amount = 500
 where recurring_expense_id = '00000000-0000-4000-8000-000000000e04' and competence = '2026-11-01';
update fin_entries set locked = true, gross = 999
 where recurring_expense_id = '00000000-0000-4000-8000-000000000e04' and competence = '2026-10-01';
update fin_recurring_expenses set amount = 600 where id = '00000000-0000-4000-8000-000000000e04';
select is((select gross from fin_entries where recurring_expense_id = '00000000-0000-4000-8000-000000000e04' and competence = '2026-11-01'), 500.00, 'liquidada preservada');
select is((select count(*)::int from fin_entries where recurring_expense_id = '00000000-0000-4000-8000-000000000e04' and competence = '2026-11-01'), 1, 'liquidada não duplica');
select is((select gross from fin_entries where recurring_expense_id = '00000000-0000-4000-8000-000000000e04' and competence = '2026-10-01'), 999.00, 'locked preservada');
select is((select gross from fin_entries where recurring_expense_id = '00000000-0000-4000-8000-000000000e04' and competence = '2026-12-01'), 600.00, 'aberta regenerada com o novo valor');

-- Inativar apaga as abertas.
update fin_entries set status = 'settled', settled_on = '2026-10-05', settled_amount = 500
 where recurring_expense_id = '00000000-0000-4000-8000-000000000e01' and competence = '2026-10-01';
update fin_recurring_expenses set active = false where id = '00000000-0000-4000-8000-000000000e01';
select is((select count(*)::int from fin_entries where recurring_expense_id = '00000000-0000-4000-8000-000000000e01'), 1, 'inativar mantém só a liquidada');

-- Apagar a despesa: mantém liquidadas, sem vínculo.
delete from fin_recurring_expenses where id = '00000000-0000-4000-8000-000000000e04';
select is((select count(*)::int from fin_entries where recurring_expense_id is null and source_kind = 'recurring' and description like 'Internet%'), 2,
  'apagar despesa mantém liquidada e locked');

-- Cross-company.
select throws_ok($q$insert into fin_recurring_expenses (company_id, description, expense_category_id, nature, amount, due_day, start_month, end_month) values
  ('00000000-0000-4000-8000-0000000000d1', 'x', '00000000-0000-4000-8000-0000000000b2', 'fixed', 10, 1, '2026-10-01', '2026-12-01')$q$,
  'P0001', 'OXYN_CROSS_COMPANY', 'categoria de outra empresa é rejeitada');
select throws_ok($q$insert into fin_recurring_expenses (company_id, description, expense_category_id, nature, amount, due_day, start_month, end_month) values
  ('00000000-0000-4000-8000-0000000000d1', 'x', '00000000-0000-4000-8000-0000000000b1', 'fixed', 10, 1, '2026-10-15', '2026-12-01')$q$,
  '23514', null, 'start_month precisa ser dia 1');

-- fin_extend_horizon: contrato "ends" encerrado vira ended; ativo permanece.
insert into fin_contracts (id, company_id, title, status, due_day, end_rule) values
  ('00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-0000000000d1', 'Antigo', 'active', 10, 'ends'),
  ('00000000-0000-4000-8000-0000000000f2', '00000000-0000-4000-8000-0000000000d1', 'Vigente', 'active', 10, 'auto_renew');
insert into fin_contract_lines (contract_id, company_id, kind, description, amount, first_month, months) values
  ('00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-0000000000d1', 'recurring', 'Mensal', 100, '2026-01-01', 3),
  ('00000000-0000-4000-8000-0000000000f2', '00000000-0000-4000-8000-0000000000d1', 'recurring', 'Mensal', 100, '2026-01-01', 12);
select pg_temp.as_pg();
select public.fin_extend_horizon();
select is((select status from fin_contracts where id = '00000000-0000-4000-8000-0000000000f1'), 'ended', 'contrato ends encerrado vira ended');
select is((select status from fin_contracts where id = '00000000-0000-4000-8000-0000000000f2'), 'active', 'contrato auto_renew segue ativo');
select is((select count(*)::int from fin_entries where contract_id = '00000000-0000-4000-8000-0000000000f1'), 3, 'ended preserva as entries abertas vencidas');
select is((select count(*)::int from cron.job where jobname = 'fin-extend-horizon' and schedule = '0 6 1 * *'), 1, 'agendado no pg_cron');

select * from finish();
rollback;
