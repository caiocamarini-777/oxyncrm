begin;
select plan(13);

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
  ('00000000-0000-4000-8000-0000000000d1', 'Fin Baixa', 'tst-fin-ops');

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-0000000000c1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tst-admin@oxyn.test', '{"full_name":"admin"}'),
  ('00000000-0000-4000-8000-0000000000c3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tst-leitor@oxyn.test', '{"full_name":"leitor"}'),
  ('00000000-0000-4000-8000-0000000000c4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tst-manager@oxyn.test', '{"full_name":"manager"}');
update profiles set is_super_admin = true where id = '00000000-0000-4000-8000-0000000000c1';

insert into roles (id, name, description, permissions) values
  ('00000000-0000-4000-8000-0000000000e2', 'tst-LeitorFin', 't', '{"visibility":{"leads":"own","deals":"own","persons":"own","organizations":"own","activities":"own"},"actions":{"create":true,"edit":true,"delete":false,"export":false,"reassign_owner":false},"settings":{"manage_pipelines":false,"manage_custom_fields":false,"manage_products":false,"view_reports":true,"create_dashboards":true,"share_dashboards":false,"view_finance":true}}'::jsonb),
  ('00000000-0000-4000-8000-0000000000e3', 'tst-GerFin', 't', '{"visibility":{"leads":"own","deals":"own","persons":"own","organizations":"own","activities":"own"},"actions":{"create":true,"edit":true,"delete":false,"export":false,"reassign_owner":false},"settings":{"manage_pipelines":false,"manage_custom_fields":false,"manage_products":false,"view_reports":true,"create_dashboards":true,"share_dashboards":false,"manage_finance":true}}'::jsonb);
insert into memberships (user_id, company_id, role_id) values
  ('00000000-0000-4000-8000-0000000000c3', '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000e2'),
  ('00000000-0000-4000-8000-0000000000c4', '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000e3');

select pg_temp.as_user('00000000-0000-4000-8000-0000000000c1');
update companies set finance_enabled = true where id = '00000000-0000-4000-8000-0000000000d1';
select pg_temp.as_user('00000000-0000-4000-8000-0000000000c4');

insert into fin_accounts (id, company_id, name) values
  ('00000000-0000-4000-8000-00000000ac01', '00000000-0000-4000-8000-0000000000d1', 'tst-conta');
insert into fin_contracts (id, company_id, title, status, due_day, retention_rate, end_rule) values
  ('00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-0000000000d1', 'Contrato A', 'active', 10, 0, 'ends');
insert into fin_contract_lines (id, contract_id, company_id, kind, description, amount, first_month, months) values
  ('00000000-0000-4000-8000-000000000a11', '00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-0000000000d1', 'recurring', 'Mensal', 1000, '2026-11-01', 3);
insert into fin_entries (id, company_id, direction, source_kind, due_date, competence, gross, description) values
  ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000d1', 'in', 'manual', '2026-11-05', '2026-11-01', 500, 'avulso 1'),
  ('00000000-0000-4000-8000-0000000000b2', '00000000-0000-4000-8000-0000000000d1', 'in', 'manual', '2026-11-06', '2026-11-01', 700, 'avulso 2'),
  ('00000000-0000-4000-8000-0000000000b3', '00000000-0000-4000-8000-0000000000d1', 'in', 'manual', '2026-11-07', '2026-11-01', 1000, 'avulso 3'),
  ('00000000-0000-4000-8000-0000000000b4', '00000000-0000-4000-8000-0000000000d1', 'in', 'manual', '2026-11-08', '2026-11-01', 100, 'avulso 4');

select is(public.fin_settle_entries(array['00000000-0000-4000-8000-0000000000b1','00000000-0000-4000-8000-0000000000b2']::uuid[], '2026-11-10'), 2,
  'liquidar 2 ids devolve 2');
select is((select count(*)::int from fin_entries where id in ('00000000-0000-4000-8000-0000000000b1','00000000-0000-4000-8000-0000000000b2')
            and status = 'settled' and settled_amount = amount and settled_on = '2026-11-10'), 2, 'ambas settled com o valor líquido');
select is(public.fin_settle_entries(array['00000000-0000-4000-8000-0000000000b1']::uuid[], '2026-11-11'), 0, 'liquidar de novo não muda nada');
select throws_ok($q$select public.fin_settle_entries(array['00000000-0000-4000-8000-0000000000b3','00000000-0000-4000-8000-0000000000b4']::uuid[], '2026-11-10', null, 50)$q$,
  null, 'OXYN_AMOUNT_SINGLE_ONLY', 'p_amount com 2 ids dá erro');
select is(public.fin_settle_entries(array['00000000-0000-4000-8000-0000000000b3']::uuid[], '2026-11-10', '00000000-0000-4000-8000-00000000ac01', 950), 1,
  'liquidar 1 id com valor');
select is((select settled_amount::text || '|' || account_id::text from fin_entries where id = '00000000-0000-4000-8000-0000000000b3'),
  '950.00|00000000-0000-4000-8000-00000000ac01', 'settled_amount 950 e conta aplicada');
select lives_ok($q$select public.fin_reopen_entry('00000000-0000-4000-8000-0000000000b3')$q$, 'reabrir');
select is((select status || '|' || coalesce(settled_on::text, 'null') || '|' || coalesce(settled_amount::text, 'null') from fin_entries where id = '00000000-0000-4000-8000-0000000000b3'),
  'open|null|null', 'reabrir limpa a liquidação');
select throws_ok($q$select public.fin_reopen_entry('00000000-0000-4000-8000-0000000000b4')$q$, null, 'OXYN_ENTRY_NOT_SETTLED', 'reabrir entry aberta dá erro');

-- Trava ao editar valor de entry de contrato; settle não trava; manual não trava.
select is((select locked from fin_entries where contract_line_id = '00000000-0000-4000-8000-000000000a11' order by competence limit 1), false, 'entry de contrato nasce destravada');
select public.fin_settle_entries(array[(select id from fin_entries where contract_line_id = '00000000-0000-4000-8000-000000000a11' order by competence limit 1)], '2026-11-10');
select is((select locked from fin_entries where contract_line_id = '00000000-0000-4000-8000-000000000a11' order by competence limit 1), false, 'baixa não trava');
update fin_entries set gross = 1100 where contract_line_id = '00000000-0000-4000-8000-000000000a11' and competence = '2026-12-01';
update fin_entries set gross = 600 where id = '00000000-0000-4000-8000-0000000000b4';
select is((select locked::text from fin_entries where contract_line_id = '00000000-0000-4000-8000-000000000a11' and competence = '2026-12-01')
  || '|' || (select locked::text from fin_entries where id = '00000000-0000-4000-8000-0000000000b4'), 'true|false', 'editar o gross trava contrato, mas não manual');

select pg_temp.as_user('00000000-0000-4000-8000-0000000000c3');
select throws_ok($q$select public.fin_settle_entries(array['00000000-0000-4000-8000-0000000000b4']::uuid[], '2026-11-10')$q$, '42501', null, 'view_finance não liquida');

select * from finish();
rollback;
