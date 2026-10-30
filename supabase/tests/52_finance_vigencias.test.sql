begin;
select plan(23);

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
  ('00000000-0000-4000-8000-0000000000d1', 'Fin Vigências', 'tst-fin-vig'),
  ('00000000-0000-4000-8000-0000000000d2', 'Fin Vigências Outra', 'tst-fin-vig-outra');

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-0000000000c1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tst-admin@oxyn.test', '{"full_name":"admin"}');
update profiles set is_super_admin = true where id = '00000000-0000-4000-8000-0000000000c1';

select pg_temp.as_user('00000000-0000-4000-8000-0000000000c1');
update companies set finance_enabled = true
 where id in ('00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000d2');
select pg_temp.as_pg();

insert into fin_income_categories (id, company_id, name) values
  ('00000000-0000-4000-8000-0000000001c1', '00000000-0000-4000-8000-0000000000d1', 'tst-Vendas'),
  ('00000000-0000-4000-8000-0000000001c2', '00000000-0000-4000-8000-0000000000d2', 'tst-Vendas outra');
insert into fin_expense_categories (id, company_id, name, default_nature) values
  ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000d1', 'tst-Aluguel', 'fixed');
insert into service_categories (id, company_id, name) values
  ('00000000-0000-4000-8000-00000000ca01', '00000000-0000-4000-8000-0000000000d1', 'tst-cat-1'),
  ('00000000-0000-4000-8000-00000000ca02', '00000000-0000-4000-8000-0000000000d2', 'tst-cat-outra');
insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-0000000000c2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tst-dono@oxyn.test', '{"full_name":"dono"}');
insert into organizations (id, company_id, owner_id, name) values
  ('00000000-0000-4000-8000-00000000b001', '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000c2', 'tst-cliente'),
  ('00000000-0000-4000-8000-00000000b002', '00000000-0000-4000-8000-0000000000d2', '00000000-0000-4000-8000-0000000000c2', 'tst-cliente-outra');

-- ===== 1. Item de entrada gera entries de entrada =====
insert into fin_recurring_expenses (id, company_id, direction, description, income_category_id, service_category_id,
    organization_id, amount, due_day, start_month, end_month) values
  ('00000000-0000-4000-8000-000000000e01', '00000000-0000-4000-8000-0000000000d1', 'in', 'tst-Receita fixa',
   '00000000-0000-4000-8000-0000000001c1', '00000000-0000-4000-8000-00000000ca01', '00000000-0000-4000-8000-00000000b001',
   1000, 10, '2026-11-01', '2027-01-01');
select is((select count(*)::int || '|' || min(competence)::text || '|' || max(competence)::text from fin_entries
            where recurring_expense_id = '00000000-0000-4000-8000-000000000e01'),
  '3|2026-11-01|2027-01-01', 'entrada mensal de nov/26 a jan/27 gera 3 entries');
select is((select count(*)::int from fin_entries
            where recurring_expense_id = '00000000-0000-4000-8000-000000000e01'
              and direction = 'in' and nature is null and expense_category_id is null and gross = 1000
              and income_category_id = '00000000-0000-4000-8000-0000000001c1'), 3,
  'entries de entrada, sem natureza, com a categoria de receita');
select is((select count(*)::int from fin_entries
            where recurring_expense_id = '00000000-0000-4000-8000-000000000e01'
              and service_category_id = '00000000-0000-4000-8000-00000000ca01'
              and organization_id = '00000000-0000-4000-8000-00000000b001'), 3,
  'entries levam a categoria de serviço e a organização do item');

-- Entrada só com categoria de serviço também vale.
select lives_ok($q$insert into fin_recurring_expenses (company_id, direction, description, service_category_id, amount, due_day, start_month, end_month)
  values ('00000000-0000-4000-8000-0000000000d1', 'in', 'tst-só serviço', '00000000-0000-4000-8000-00000000ca01', 50, 5, '2026-11-01', '2026-11-01')$q$,
  'entrada com só a categoria de serviço é aceita');

-- ===== 2. Checks de sentido =====
select throws_ok($q$insert into fin_recurring_expenses (company_id, description, expense_category_id, amount, due_day, start_month, end_month)
  values ('00000000-0000-4000-8000-0000000000d1', 'x', '00000000-0000-4000-8000-0000000000b1', 10, 1, '2026-11-01', '2026-12-01')$q$,
  '23514', null, 'saída sem natureza é rejeitada');
select throws_ok($q$insert into fin_recurring_expenses (company_id, description, nature, amount, due_day, start_month, end_month)
  values ('00000000-0000-4000-8000-0000000000d1', 'x', 'fixed', 10, 1, '2026-11-01', '2026-12-01')$q$,
  '23514', null, 'saída sem categoria de despesa é rejeitada');
select throws_ok($q$insert into fin_recurring_expenses (company_id, direction, description, income_category_id, nature, amount, due_day, start_month, end_month)
  values ('00000000-0000-4000-8000-0000000000d1', 'in', 'x', '00000000-0000-4000-8000-0000000001c1', 'fixed', 10, 1, '2026-11-01', '2026-12-01')$q$,
  '23514', null, 'entrada com natureza é rejeitada');
select throws_ok($q$insert into fin_recurring_expenses (company_id, direction, description, amount, due_day, start_month, end_month)
  values ('00000000-0000-4000-8000-0000000000d1', 'in', 'x', 10, 1, '2026-11-01', '2026-12-01')$q$,
  '23514', null, 'entrada sem categoria é rejeitada');
select throws_ok($q$insert into fin_recurring_expenses (company_id, direction, description, amount, due_day, start_month, end_month)
  values ('00000000-0000-4000-8000-0000000000d1', 'sideways', 'x', 10, 1, '2026-11-01', '2026-12-01')$q$,
  '23514', null, 'sentido inválido é rejeitado');

-- ===== 3. Mesma empresa nos vínculos novos =====
select throws_ok($q$insert into fin_recurring_expenses (company_id, direction, description, income_category_id, amount, due_day, start_month, end_month)
  values ('00000000-0000-4000-8000-0000000000d1', 'in', 'x', '00000000-0000-4000-8000-0000000001c2', 10, 1, '2026-11-01', '2026-12-01')$q$,
  'P0001', 'OXYN_CROSS_COMPANY', 'categoria de receita de outra empresa é rejeitada');
select throws_ok($q$insert into fin_recurring_expenses (company_id, direction, description, service_category_id, amount, due_day, start_month, end_month)
  values ('00000000-0000-4000-8000-0000000000d1', 'in', 'x', '00000000-0000-4000-8000-00000000ca02', 10, 1, '2026-11-01', '2026-12-01')$q$,
  'P0001', 'OXYN_CROSS_COMPANY', 'categoria de serviço de outra empresa é rejeitada');
select throws_ok($q$insert into fin_recurring_expenses (company_id, direction, description, income_category_id, organization_id, amount, due_day, start_month, end_month)
  values ('00000000-0000-4000-8000-0000000000d1', 'in', 'x', '00000000-0000-4000-8000-0000000001c1', '00000000-0000-4000-8000-00000000b002', 10, 1, '2026-11-01', '2026-12-01')$q$,
  'P0001', 'OXYN_CROSS_COMPANY', 'organização de outra empresa é rejeitada');

-- ===== 4. Fim obrigatório (NOT VALID: legado sem fim continua) =====
select throws_ok($q$insert into fin_recurring_expenses (company_id, description, expense_category_id, nature, amount, due_day, start_month)
  values ('00000000-0000-4000-8000-0000000000d1', 'x', '00000000-0000-4000-8000-0000000000b1', 'fixed', 10, 1, '2026-11-01')$q$,
  '23514', null, 'item sem end_month é rejeitado');
select is((select convalidated from pg_constraint
            where conrelid = 'public.fin_recurring_expenses'::regclass and conname = 'fin_recurring_expenses_end_month_required'),
  false, 'o check de fim é NOT VALID (itens legados sem fim continuam válidos)');

-- Simula um item legado: tira o check só nesta transação, insere sem fim e recoloca igual.
alter table fin_recurring_expenses drop constraint fin_recurring_expenses_end_month_required;
insert into fin_recurring_expenses (id, company_id, description, expense_category_id, nature, amount, due_day, start_month) values
  ('00000000-0000-4000-8000-000000000e09', '00000000-0000-4000-8000-0000000000d1', 'tst-Legado', '00000000-0000-4000-8000-0000000000b1',
   'fixed', 300, 5, public.fin_current_month());
alter table fin_recurring_expenses add constraint fin_recurring_expenses_end_month_required check (end_month is not null or not active) not valid;
select is((select count(*)::int from fin_entries where recurring_expense_id = '00000000-0000-4000-8000-000000000e09'), 36,
  'item legado sem fim gera até o horizonte');
select lives_ok($q$select public.fin_regenerate_recurring('00000000-0000-4000-8000-000000000e09')$q$,
  'item legado sem fim continua regenerando');
select throws_ok($q$update fin_recurring_expenses set amount = 350 where id = '00000000-0000-4000-8000-000000000e09'$q$,
  '23514', null, 'alterar item legado sem informar o fim é rejeitado');
select lives_ok($q$update fin_recurring_expenses set active = false where id = '00000000-0000-4000-8000-000000000e09'$q$,
  'item legado sem fim pode ser desativado');
select throws_ok($q$update fin_recurring_expenses set active = true where id = '00000000-0000-4000-8000-000000000e09'$q$,
  '23514', null, 'reativar item sem fim é rejeitado');
select lives_ok($q$update fin_recurring_expenses set amount = 350, end_month = (public.fin_current_month() + interval '5 months')::date
  where id = '00000000-0000-4000-8000-000000000e09'$q$, 'alterar item legado informando o fim é aceito');

-- ===== 5. Valor original na edição manual =====
insert into fin_contracts (id, company_id, title, status, due_day, end_rule) values
  ('00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-0000000000d1', 'tst-Contrato', 'active', 10, 'ends');
insert into fin_contract_lines (id, contract_id, company_id, kind, description, amount, first_month, months) values
  ('00000000-0000-4000-8000-000000000a11', '00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-0000000000d1',
   'recurring', 'Mensal', 1000, '2026-11-01', 3);

create temp table tst_old as
  select competence, due_date from fin_entries where contract_line_id = '00000000-0000-4000-8000-000000000a11';
grant select on tst_old to public;

update fin_entries set gross = 1200
 where contract_line_id = '00000000-0000-4000-8000-000000000a11' and competence = '2026-11-01';
select is((select locked::text || '|' || original_gross::text || '|' || original_due_date::text from fin_entries
            where contract_line_id = '00000000-0000-4000-8000-000000000a11' and competence = '2026-11-01'),
  'true|1000.00|' || (select due_date::text from tst_old where competence = '2026-11-01'),
  'primeira edição trava e guarda o bruto e o vencimento originais');

update fin_entries set gross = 1300, due_date = '2026-11-25'
 where contract_line_id = '00000000-0000-4000-8000-000000000a11' and competence = '2026-11-01';
select is((select gross::text || '|' || original_gross::text || '|' || original_due_date::text from fin_entries
            where contract_line_id = '00000000-0000-4000-8000-000000000a11' and competence = '2026-11-01'),
  '1300.00|1000.00|' || (select due_date::text from tst_old where competence = '2026-11-01'),
  'segunda edição não sobrescreve os originais');

update fin_entries set status = 'settled', settled_on = '2026-12-10', settled_amount = 1000
 where contract_line_id = '00000000-0000-4000-8000-000000000a11' and competence = '2026-12-01';
select is((select locked::text || '|' || coalesce(original_gross::text, 'null') || '|' || coalesce(original_due_date::text, 'null')
            from fin_entries
            where contract_line_id = '00000000-0000-4000-8000-000000000a11' and competence = '2026-12-01'),
  'false|null|null', 'liquidar não trava nem preenche os originais');

select * from finish();
rollback;
