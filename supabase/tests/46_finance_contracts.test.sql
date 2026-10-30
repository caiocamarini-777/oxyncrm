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
  ('00000000-0000-4000-8000-0000000000d1', 'Fin Contratos', 'tst-fin-ct');

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

-- Liga o Financeiro como admin geral (o semeador de serviço exige super admin).
select pg_temp.as_user('00000000-0000-4000-8000-0000000000c1');
update companies set finance_enabled = true where id = '00000000-0000-4000-8000-0000000000d1';

-- Daqui em diante, como gerente financeiro.
select pg_temp.as_user('00000000-0000-4000-8000-0000000000c4');

-- C1: vigência fechada, vencimento 31, retenção 10%.
insert into fin_contracts (id, company_id, title, status, due_day, retention_rate, end_rule) values
  ('00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-0000000000d1', 'Contrato A', 'active', 31, 10, 'ends');
insert into fin_contract_lines (id, contract_id, company_id, kind, description, amount, first_month, months) values
  ('00000000-0000-4000-8000-000000000a11', '00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-0000000000d1', 'recurring', 'Mensal', 1000, '2026-01-01', 3);
insert into fin_contract_lines (id, contract_id, company_id, kind, description, amount, first_month, installments) values
  ('00000000-0000-4000-8000-000000000a12', '00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-0000000000d1', 'setup', 'Implantação', 1000, '2026-01-01', 3);

select is((select count(*)::int from fin_entries where contract_line_id = '00000000-0000-4000-8000-000000000a11'), 3, 'recorrente de 3 meses gera 3 entries');
select is((select array_agg(due_date order by competence) from fin_entries where contract_line_id = '00000000-0000-4000-8000-000000000a11'),
  array['2026-01-31','2026-02-28','2026-03-31']::date[], 'dia 31 vira o último dia em mês curto');
select is((select count(*)::int from fin_entries where contract_line_id = '00000000-0000-4000-8000-000000000a11' and retention = 100 and amount = 900), 3, 'retenção 100 e líquido 900');
select is((select array_agg(gross order by competence) from fin_entries where contract_line_id = '00000000-0000-4000-8000-000000000a12'),
  array[333.33, 333.33, 333.34]::numeric[], 'setup em 3 parcelas: resíduo na última');
select is(public.fin_due_date('2028-02-01', 30), '2028-02-29'::date, 'fin_due_date respeita ano bissexto');

-- C2: auto_renew de 12 meses a partir do mês corrente.
insert into fin_contracts (id, company_id, title, status, due_day, end_rule) values
  ('00000000-0000-4000-8000-0000000000f2', '00000000-0000-4000-8000-0000000000d1', 'Contrato B', 'active', 10, 'auto_renew');
insert into fin_contract_lines (id, contract_id, company_id, kind, description, amount, first_month, months) values
  ('00000000-0000-4000-8000-000000000a21', '00000000-0000-4000-8000-0000000000f2', '00000000-0000-4000-8000-0000000000d1', 'recurring', 'Mensal', 500,
   (public.fin_horizon_end() - interval '36 months')::date, 12);

select is((select count(*)::int || '|' || max(competence)::text from fin_entries where contract_line_id = '00000000-0000-4000-8000-000000000a21'),
  '36|' || (public.fin_horizon_end() - interval '1 month')::date::text, 'auto_renew gera até o mês anterior ao horizonte');
select is((select count(*)::int from fin_entries where contract_line_id = '00000000-0000-4000-8000-000000000a21'
             and is_renewal and not renewal_pending and competence >= (public.fin_horizon_end() - interval '24 months')::date), 24,
  'meses 13+ são renovação sem pendência');
select is((select count(*)::int from fin_entries where contract_line_id = '00000000-0000-4000-8000-000000000a21' and is_renewal), 24,
  'os 12 primeiros meses não são renovação');

-- C3: confirm.
insert into fin_contracts (id, company_id, title, status, due_day, end_rule) values
  ('00000000-0000-4000-8000-0000000000f3', '00000000-0000-4000-8000-0000000000d1', 'Contrato C', 'active', 10, 'confirm');
insert into fin_contract_lines (id, contract_id, company_id, kind, description, amount, first_month, months) values
  ('00000000-0000-4000-8000-000000000a31', '00000000-0000-4000-8000-0000000000f3', '00000000-0000-4000-8000-0000000000d1', 'recurring', 'Mensal', 500,
   (public.fin_horizon_end() - interval '36 months')::date, 12);
select is((select count(*) filter (where renewal_pending)::int || '|' || count(*) filter (where is_renewal)::int
           from fin_entries where contract_line_id = '00000000-0000-4000-8000-000000000a31'), '24|24', 'confirm: renovações pendentes');

-- C4: renew_adjust 10% com renewal_months 12.
insert into fin_contracts (id, company_id, title, status, due_day, end_rule, adjust_kind, adjust_rate, renewal_months) values
  ('00000000-0000-4000-8000-0000000000f4', '00000000-0000-4000-8000-0000000000d1', 'Contrato D', 'active', 10, 'renew_adjust', 'percent', 10, 12);
insert into fin_contract_lines (id, contract_id, company_id, kind, description, amount, first_month, months) values
  ('00000000-0000-4000-8000-000000000a41', '00000000-0000-4000-8000-0000000000f4', '00000000-0000-4000-8000-0000000000d1', 'recurring', 'Mensal', 1000,
   (public.fin_horizon_end() - interval '36 months')::date, 12);
select is((select array_agg(gross order by competence) from fin_entries where contract_line_id = '00000000-0000-4000-8000-000000000a41'
             and competence in ((public.fin_horizon_end() - interval '36 months')::date,
                                (public.fin_horizon_end() - interval '24 months')::date,
                                (public.fin_horizon_end() - interval '12 months')::date)),
  array[1000.00, 1100.00, 1210.00]::numeric[], 'renew_adjust: mês 13 = 1.100, mês 25 = 1.210');

-- Liquida fevereiro, trava janeiro e regenera mudando o valor.
update fin_entries set status = 'settled', settled_on = '2026-02-27', settled_amount = 900
 where contract_line_id = '00000000-0000-4000-8000-000000000a11' and competence = '2026-02-01';
update fin_entries set locked = true, gross = 555
 where contract_line_id = '00000000-0000-4000-8000-000000000a11' and competence = '2026-01-01';
update fin_contract_lines set amount = 2000 where id = '00000000-0000-4000-8000-000000000a11';

select is((select gross from fin_entries where contract_line_id = '00000000-0000-4000-8000-000000000a11' and competence = '2026-02-01'), 1000.00, 'fevereiro liquidado mantém o valor');
select is((select gross from fin_entries where contract_line_id = '00000000-0000-4000-8000-000000000a11' and competence = '2026-03-01'), 2000.00, 'março passa a 2.000');
select is((select count(*)::int from fin_entries where contract_line_id = '00000000-0000-4000-8000-000000000a11' and competence = '2026-02-01'), 1, 'só uma entry de fevereiro');
select is((select count(*)::int || '|' || max(gross)::text from fin_entries where contract_line_id = '00000000-0000-4000-8000-000000000a11' and competence = '2026-01-01'), '1|555.00', 'entry locked sobrevive à regeneração');

-- Cancelar o contrato apaga só as abertas do mês corrente em diante: as de jan–mar/2026 já venceram
-- e ficam (4 abertas vencidas + liquidada + locked).
update fin_contracts set status = 'cancelled' where id = '00000000-0000-4000-8000-0000000000f1';
select is((select count(*)::int from fin_entries where contract_id = '00000000-0000-4000-8000-0000000000f1'), 6, 'contrato cancelado: vencidas abertas, liquidada e locked ficam');

-- Apagar o contrato preserva liquidada e locked (sem vínculo).
delete from fin_contracts where id = '00000000-0000-4000-8000-0000000000f1';
select is((select count(*)::int from fin_entries where contract_id is null and contract_line_id is null and competence in ('2026-01-01','2026-02-01')
             and (locked or status = 'settled')), 2, 'apagar contrato mantém liquidada e locked');

-- C5: rascunho não gera; ativar gera.
insert into fin_contracts (id, company_id, title, status, due_day) values
  ('00000000-0000-4000-8000-0000000000f5', '00000000-0000-4000-8000-0000000000d1', 'Contrato E', 'draft', 5);
insert into fin_contract_lines (contract_id, company_id, kind, description, amount, first_month, months) values
  ('00000000-0000-4000-8000-0000000000f5', '00000000-0000-4000-8000-0000000000d1', 'recurring', 'Mensal', 300, '2026-01-01', 2);
select is((select count(*)::int from fin_entries where contract_id = '00000000-0000-4000-8000-0000000000f5'), 0, 'rascunho não gera entries');
-- rascunho → ativo direto só com a marca que fin_activate_contract põe (o contrato E não tem cliente/conta)
select set_config('oxyn.activating_contract', '00000000-0000-4000-8000-0000000000f5', true);
update fin_contracts set status = 'active' where id = '00000000-0000-4000-8000-0000000000f5';
select set_config('oxyn.activating_contract', '', true);
select is((select count(*)::int from fin_entries where contract_id = '00000000-0000-4000-8000-0000000000f5'), 2, 'ativar gera as entries');

-- C6: comissão.
insert into fin_contracts (id, company_id, title, status, due_day, end_rule) values
  ('00000000-0000-4000-8000-0000000000f6', '00000000-0000-4000-8000-0000000000d1', 'Contrato F', 'active', 15, 'ends');
insert into fin_contract_lines (id, contract_id, company_id, kind, description, recurring_rate, estimated_monthly, first_month, months) values
  ('00000000-0000-4000-8000-000000000a61', '00000000-0000-4000-8000-0000000000f6', '00000000-0000-4000-8000-0000000000d1', 'commission', 'Comissão', 10, 2000, public.fin_current_month(), 3),
  ('00000000-0000-4000-8000-000000000a62', '00000000-0000-4000-8000-0000000000f6', '00000000-0000-4000-8000-0000000000d1', 'commission', 'Comissão sem estimativa', 10, null, public.fin_current_month(), 3);
select is((select count(*)::int from fin_entries where contract_line_id = '00000000-0000-4000-8000-000000000a61' and estimated and gross = 2000), 3, 'comissão estimada gera 3 entries de 2.000');
select is((select count(*)::int from fin_entries where contract_line_id = '00000000-0000-4000-8000-000000000a62'), 0, 'comissão sem estimativa não gera');

select throws_ok($q$insert into fin_contract_lines (contract_id, company_id, kind, description, estimated_monthly, first_month, months) values
  ('00000000-0000-4000-8000-0000000000f6', '00000000-0000-4000-8000-0000000000d1', 'commission', 'x', 100, '2026-01-01', 3)$q$,
  '23514', null, 'comissão sem nenhum % falha no check');
select throws_ok($q$insert into fin_contract_lines (contract_id, company_id, kind, description, amount, first_month) values
  ('00000000-0000-4000-8000-0000000000f6', '00000000-0000-4000-8000-0000000000d1', 'recurring', 'x', 100, '2026-01-01')$q$,
  '23514', null, 'recorrente sem months falha no check');

-- Sem chaves: 0 linhas.
select pg_temp.as_user('00000000-0000-4000-8000-0000000000c2');
select is((select count(*)::int from fin_contracts) + (select count(*)::int from fin_contract_lines) + (select count(*)::int from fin_entries), 0, 'sem chaves lê 0 linhas');

select * from finish();
rollback;
