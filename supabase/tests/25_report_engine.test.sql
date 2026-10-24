begin;
select plan(39);

create function pg_temp.u(n int) returns uuid language sql immutable as $$
  select ('00000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
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
-- monta uma spec custom; chart padrão "bar"
create function pg_temp.spec(p_base text, p_op text, p_field text default null, p_group text default null,
  p_filters jsonb default '[]', p_period jsonb default null, p_chart text default 'bar') returns jsonb
language sql immutable as $$
  select jsonb_build_object('kind', 'custom', 'base', p_base,
    'metric', jsonb_build_object('op', p_op, 'field', p_field),
    'group_by', p_group, 'filters', p_filters, 'period', p_period, 'chart', p_chart) $$;
create function pg_temp.a() returns uuid[] language sql immutable as $$ select array[pg_temp.u(1)] $$;
grant execute on function pg_temp.u(int), pg_temp.as_user(uuid), pg_temp.as_pg(),
  pg_temp.spec(text, text, text, text, jsonb, jsonb, text), pg_temp.a() to public;

insert into companies (id, name, slug) values (pg_temp.u(1), 'Volt Teste', 'tst-volt'), (pg_temp.u(2), 'Naia Teste', 'tst-naia');
insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data) values
  (pg_temp.u(11), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tst-g@oxyn.test', '{"full_name":"tst-gestor"}'),
  (pg_temp.u(12), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tst-n@oxyn.test', '{"full_name":"tst-naia"}'),
  (pg_temp.u(13), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tst-v@oxyn.test', '{"full_name":"tst-vend"}'),
  (pg_temp.u(14), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tst-s@oxyn.test', '{"full_name":"tst-semrel"}');
insert into roles (id, name, description, permissions) values
  (pg_temp.u(21), 'tst-Gestor', 'teste', '{"visibility":{"leads":"company","deals":"company","persons":"company","organizations":"company","activities":"company"},"actions":{"create":true,"edit":true,"delete":true,"export":true,"reassign_owner":true},"settings":{"manage_pipelines":true,"manage_custom_fields":true,"manage_products":true,"view_reports":true,"create_dashboards":true,"share_dashboards":true}}'::jsonb),
  (pg_temp.u(22), 'tst-Vendedor', 'teste', '{"visibility":{"leads":"own","deals":"own","persons":"own","organizations":"own","activities":"own"},"actions":{"create":true,"edit":true,"delete":false,"export":false,"reassign_owner":false},"settings":{"manage_pipelines":false,"manage_custom_fields":false,"manage_products":false,"view_reports":true,"create_dashboards":true,"share_dashboards":false}}'::jsonb),
  (pg_temp.u(24), 'tst-SemRel', 'teste', '{"visibility":{"leads":"company","deals":"company","persons":"company","organizations":"company","activities":"company"},"actions":{"create":true,"edit":true,"delete":false,"export":false,"reassign_owner":false},"settings":{"manage_pipelines":false,"manage_custom_fields":false,"manage_products":false,"view_reports":false,"create_dashboards":false,"share_dashboards":false}}'::jsonb);
insert into memberships (user_id, company_id, role_id) values
  (pg_temp.u(11), pg_temp.u(1), pg_temp.u(21)), (pg_temp.u(12), pg_temp.u(2), pg_temp.u(21)),
  (pg_temp.u(13), pg_temp.u(1), pg_temp.u(22)), (pg_temp.u(14), pg_temp.u(1), pg_temp.u(24));
-- vendedor em dois times, gestor em nenhum
insert into teams (id, name) values (pg_temp.u(31), 'tst-time-a'), (pg_temp.u(32), 'tst-time-b');
insert into team_members (team_id, user_id) values (pg_temp.u(31), pg_temp.u(13)), (pg_temp.u(32), pg_temp.u(13));

insert into custom_field_defs (company_id, entity, key, label, type, options) values
  (pg_temp.u(1), 'leads', 'segmento', 'Segmento', 'select', '["Varejo","Indústria"]'),
  (pg_temp.u(1), 'leads', 'nota', 'Nota', 'text', '[]');

-- Leads: 4 na Volt (1 convertido), 1 apagado, 1 na Naia
insert into leads (id, company_id, owner_id, title, created_at, custom_fields) values
  (pg_temp.u(102), pg_temp.u(1), pg_temp.u(13), 'tst-l2', '2026-03-05 10:00-03', '{"segmento":"Varejo"}'),
  (pg_temp.u(103), pg_temp.u(1), pg_temp.u(11), 'tst-l3', '2026-03-06 10:00-03', '{}'),
  (pg_temp.u(104), pg_temp.u(1), pg_temp.u(11), 'tst-l4', '2026-03-07 10:00-03', '{}'),
  (pg_temp.u(105), pg_temp.u(1), pg_temp.u(13), 'tst-l5', '2026-03-08 10:00-03', '{}'),
  (pg_temp.u(106), pg_temp.u(2), pg_temp.u(12), 'tst-l6', '2026-03-09 10:00-03', '{}');
select set_config('oxyn.converting', 'on', true);
insert into leads (id, company_id, owner_id, title, created_at, status, converted_at, custom_fields) values
  (pg_temp.u(101), pg_temp.u(1), pg_temp.u(13), 'tst-l1', '2026-03-01 10:00-03', 'converted', '2026-03-11 10:00-03', '{"segmento":"Varejo"}');
select set_config('oxyn.converting', 'off', true);
update leads set deleted_at = now() where id = pg_temp.u(105);
insert into labels (id, company_id, name, color) values (pg_temp.u(41), pg_temp.u(1), 'tst-quente', 'teal');
insert into record_labels (label_id, entity, record_id) values
  (pg_temp.u(41), 'leads', pg_temp.u(101)), (pg_temp.u(41), 'leads', pg_temp.u(103));

-- Negócios com datas conhecidas (gatilho de status desligado só na fixture)
insert into pipelines (id, company_id, name) values (pg_temp.u(401), pg_temp.u(1), 'tst-funil');
insert into stages (id, pipeline_id, company_id, name, position) values
  (pg_temp.u(501), pg_temp.u(401), pg_temp.u(1), 'tst-e1', 0), (pg_temp.u(502), pg_temp.u(401), pg_temp.u(1), 'tst-e2', 1);
insert into lost_reasons (id, company_id, name) values (pg_temp.u(601), pg_temp.u(1), 'tst-preco');
alter table deals disable trigger deals_status_fields;
insert into deals (id, company_id, owner_id, title, pipeline_id, stage_id, status, won_at, lost_at, lost_reason_id,
  setup_total, setup_first_due, mrr, mrr_start, contract_months) values
  -- 1000 + 100*12 = 2200, ganho em março
  (pg_temp.u(201), pg_temp.u(1), pg_temp.u(11), 'tst-d1', pg_temp.u(401), pg_temp.u(501), 'won', '2026-03-10 12:00-03', null, null,
   1000, '2026-03-01', 100, '2026-03-01', 12),
  (pg_temp.u(202), pg_temp.u(1), pg_temp.u(11), 'tst-d2', pg_temp.u(401), pg_temp.u(501), 'won', '2026-03-25 12:00-03', null, null,
   500, '2026-03-01', 0, null, null),
  -- 01/04 02:30 UTC ainda é 31/03 em São Paulo
  (pg_temp.u(203), pg_temp.u(1), pg_temp.u(11), 'tst-d3', pg_temp.u(401), pg_temp.u(501), 'won', '2026-04-01 02:30+00', null, null,
   400, '2026-04-01', 0, null, null),
  (pg_temp.u(204), pg_temp.u(1), pg_temp.u(13), 'tst-d4', pg_temp.u(401), pg_temp.u(501), 'open', null, null, null,
   50, '2026-03-01', 0, null, null),
  (pg_temp.u(205), pg_temp.u(1), pg_temp.u(11), 'tst-d5', pg_temp.u(401), pg_temp.u(502), 'won', '2026-04-10 12:00-03', null, null,
   300, '2026-05-01', 0, null, null),
  (pg_temp.u(206), pg_temp.u(1), pg_temp.u(11), 'tst-d6', pg_temp.u(401), pg_temp.u(501), 'lost', null, '2026-03-20 12:00-03', pg_temp.u(601),
   700, '2026-03-01', 0, null, null);
alter table deals enable trigger deals_status_fields;
insert into deal_stage_history (deal_id, company_id, from_stage_id, to_stage_id, moved_at, seconds_in_previous) values
  (pg_temp.u(201), pg_temp.u(1), pg_temp.u(501), pg_temp.u(502), '2026-02-10 12:00-03', 2 * 86400),
  (pg_temp.u(202), pg_temp.u(1), pg_temp.u(501), pg_temp.u(502), '2026-02-12 12:00-03', 4 * 86400),
  (pg_temp.u(204), pg_temp.u(1), pg_temp.u(501), pg_temp.u(502), '2026-03-12 12:00-03', 30 * 86400);

-- Atividades
insert into activities (id, company_id, owner_id, created_by, type_id, channel_id, subject, due_at, lead_id)
select pg_temp.u(n), pg_temp.u(1), o, o,
  (select id from activity_types where company_id = pg_temp.u(1) and name = t),
  (select id from activity_channels where company_id = pg_temp.u(1) and name = 'Telefone'),
  'tst-ativ-' || n, '2026-03-15 10:00-03', pg_temp.u(102)
from (values (301, pg_temp.u(13), 'Ligação'), (302, pg_temp.u(11), 'Tarefa'), (303, pg_temp.u(11), 'Tarefa'), (304, pg_temp.u(11), 'Ligação')) v(n, o, t);
update activities set deleted_at = now() where id = pg_temp.u(304);

-- 1. visibilidade por viewer ------------------------------------------------------------------
select pg_temp.as_user(pg_temp.u(13));
select is(run_report_self(pg_temp.spec('leads', 'count', null, 'owner'), pg_temp.a()),
  '{"columns":[{"key":"owner","label":"Responsável","type":"text"},{"key":"value","label":"Quantidade","type":"number"}],"rows":[["tst-vend",2]],"total":2,"truncated":false}'::jsonb,
  'vendedor own conta só os próprios leads (sem o apagado)');
select is(run_report_self(pg_temp.spec('activities', 'count', null, 'type'), pg_temp.a())->'rows',
  '[["Ligação",1]]'::jsonb, 'vendedor vê só as próprias atividades');
select is((run_report_self(pg_temp.spec('revenue', 'sum', 'total', null, '[]',
  '{"field":"month","from":"2026-03-01","to":"2026-03-31"}'), pg_temp.a())->>'total')::numeric, 50::numeric,
  'revenue do vendedor só tem o negócio dele');

select pg_temp.as_user(pg_temp.u(11));
select is(run_report_self(pg_temp.spec('leads', 'count', null, 'owner'), pg_temp.a())->'rows',
  '[["tst-gestor",2],["tst-vend",2]]'::jsonb, 'gestor company vê todos os leads da empresa');
select is((run_report_self(pg_temp.spec('leads', 'count'), pg_temp.a())->>'total')::int, 4, 'total sem agrupamento');
select is(run_report_self(pg_temp.spec('leads', 'count'), pg_temp.a())->'rows', '[[4]]'::jsonb, 'sem agrupamento: uma linha');
select is(run_report_self(pg_temp.spec('activities', 'count', null, 'type'), pg_temp.a())->'rows',
  '[["Tarefa",2],["Ligação",1]]'::jsonb, 'atividades por tipo, sem a apagada');

-- 2. métricas ---------------------------------------------------------------------------------
select is(run_report_self(pg_temp.spec('deals', 'sum', 'contract_value', 'month',
  '[{"field":"status","op":"eq","value":"won"}]', '{"field":"won_at","from":"2026-01-01","to":"2026-12-31"}', 'line'), pg_temp.a()),
  '{"columns":[{"key":"month","label":"Mês","type":"month"},{"key":"value","label":"Soma de Valor do contrato","type":"currency"}],"rows":[["2026-03-01",3100],["2026-04-01",300]],"total":3400,"truncated":false}'::jsonb,
  'soma de contract_value dos ganhos por mês (fuso São Paulo)');
select is((run_report_self(pg_temp.spec('leads', 'conversion_rate', null, null, '[]', null, 'number'), pg_temp.a())->>'total')::numeric,
  25.0, 'conversion_rate de leads: 1 de 4 = 25.0');
select is(run_report_self(pg_temp.spec('leads', 'conversion_rate', null, null, '[]',
  '{"field":"created_at","from":"2000-01-01","to":"2000-01-31"}', 'number'), pg_temp.a())->'total',
  '0'::jsonb, 'conversion_rate sem leads dá 0');
select is((run_report_self(pg_temp.spec('deals', 'conversion_rate', null, null, '[]', null, 'number'), pg_temp.a())->>'total')::numeric,
  80.0, 'conversion_rate de negócios: 4 ganhos / 5 fechados');
select is(run_report_self(pg_temp.spec('revenue', 'sum', 'total', null, '[]',
  '{"field":"month","from":"2026-03-01","to":"2026-03-31"}'), pg_temp.a())->'total',
  '1650'::jsonb, 'revenue de março ignora o negócio perdido (1000 + 100 + 500 + 50)');
select is(run_report_self(pg_temp.spec('revenue', 'sum', 'setup', 'deal_status', '[]',
  '{"field":"month","from":"2026-03-01","to":"2026-03-31"}'), pg_temp.a())->'rows',
  '[["Ganho",1500],["Aberto",50]]'::jsonb, 'revenue por status do negócio, sem perdido');
select is(run_report_self(pg_temp.spec('stage_history', 'avg_days', null, null, '[]',
  '{"field":"moved_at","from":"2026-02-01","to":"2026-02-28"}', 'number'), pg_temp.a())->'total',
  '3.0'::jsonb, 'avg_days em stage_history: (2 + 4) / 2 = 3.0');
select is(run_report_self(pg_temp.spec('stage_history', 'count', null, 'to_stage', '[]',
  '{"field":"moved_at","from":"2026-02-01","to":"2026-03-31"}'), pg_temp.a())->'rows',
  '[["tst-e2",3]]'::jsonb, 'stage_history por etapa de destino');
select is((run_report_self(pg_temp.spec('leads', 'avg_days', null, null, '[]', null, 'number'), pg_temp.a())->>'total')::numeric,
  10.0, 'avg_days de leads: converted_at - created_at');
select is((run_report_self(pg_temp.spec('deals', 'avg', 'contract_value', null,
  '[{"field":"status","op":"in","value":["won"]}]'), pg_temp.a())->>'total')::numeric, 850.00, 'avg de contract_value dos ganhos');

-- 3. dimensões ------------------------------------------------------------------------------
select is(run_report_self(pg_temp.spec('leads', 'count', null, 'team'), pg_temp.a()),
  '{"columns":[{"key":"team","label":"Equipe","type":"text"},{"key":"value","label":"Quantidade","type":"number"}],"rows":[["Sem equipe",2],["tst-time-a",2],["tst-time-b",2]],"total":4,"truncated":false}'::jsonb,
  'team: dono em dois times conta em cada; total não duplica');
select is(run_report_self(pg_temp.spec('leads', 'count', null, 'label'), pg_temp.a())->'rows',
  '[["Sem etiqueta",2],["tst-quente",2]]'::jsonb, 'label com bucket Sem etiqueta');
select is(run_report_self(pg_temp.spec('leads', 'count', null, 'custom:segmento'), pg_temp.a()),
  '{"columns":[{"key":"custom:segmento","label":"Segmento","type":"text"},{"key":"value","label":"Quantidade","type":"number"}],"rows":[["Sem valor",2],["Varejo",2]],"total":4,"truncated":false}'::jsonb,
  'custom field select agrupa pelo valor');
select is(run_report_self(pg_temp.spec('leads', 'count', null, 'status'), pg_temp.a())->'rows',
  '[["Aberto",3],["Convertido",1]]'::jsonb, 'status traduzido');
select is(run_report_self(pg_temp.spec('deals', 'count', null, 'stage',
  '[{"field":"owner","op":"eq","value":"00000000-0000-4000-8000-000000000011"}]', null, 'table'), pg_temp.a()),
  '{"columns":[{"key":"stage","label":"Etapa","type":"text"},{"key":"value","label":"Quantidade","type":"number"}],"rows":[["tst-e1",4],["tst-e2",1]],"total":null,"truncated":false}'::jsonb,
  'filtro por owner e tabela sem total');
select is(run_report_self(pg_temp.spec('deals', 'count', null, null,
  '[{"field":"team","op":"in","value":["00000000-0000-4000-8000-000000000031"]}]'), pg_temp.a())->'total',
  '1'::jsonb, 'filtro por team');
select is(run_report_self(pg_temp.spec('deals', 'sum', 'setup_total', null,
  '[{"field":"won_at","op":"between","value":["2026-03-31","2026-04-10"]}]'), pg_temp.a())->'total',
  '700'::jsonb, 'filtro between em data (fuso São Paulo)');
select is(run_report_self(pg_temp.spec('leads', 'count', null, null,
  '[{"field":"status","op":"eq","value":"x''; drop table leads; --"}]'), pg_temp.a())->'total',
  '0'::jsonb, 'valor de filtro entra por parâmetro');

-- 4. acesso -------------------------------------------------------------------------------
select pg_temp.as_user(pg_temp.u(13));
select throws_ok($$ select run_report_self(pg_temp.spec('leads', 'count'), array[pg_temp.u(1), pg_temp.u(2)]) $$,
  'P0001', 'OXYN_FORBIDDEN', 'empresa fora do acesso gera OXYN_FORBIDDEN');
select pg_temp.as_user(pg_temp.u(14));
select throws_ok($$ select run_report_self(pg_temp.spec('leads', 'count'), pg_temp.a()) $$,
  'P0001', 'OXYN_FORBIDDEN', 'sem view_reports gera OXYN_FORBIDDEN');
select throws_ok($$ select run_report(pg_temp.spec('leads', 'count'), pg_temp.a(), pg_temp.u(14)) $$,
  '42501', null, 'authenticated não executa run_report direto');
select pg_temp.as_pg();
update profiles set active = false where id = pg_temp.u(11);
select pg_temp.as_user(pg_temp.u(11));
select throws_ok($$ select run_report_self(pg_temp.spec('leads', 'count'), pg_temp.a()) $$,
  'P0001', 'OXYN_FORBIDDEN', 'usuário inativo gera OXYN_FORBIDDEN');
select pg_temp.as_pg();
update profiles set active = true where id = pg_temp.u(11);

-- 5. validação da spec ---------------------------------------------------------------------
select pg_temp.as_user(pg_temp.u(11));
select throws_ok($$ select run_report_self(pg_temp.spec('leads', 'sum', 'id; drop table leads'), pg_temp.a()) $$,
  'P0001', 'OXYN_INVALID_REPORT', 'campo de métrica fora da lista');
select throws_ok($$ select run_report_self(pg_temp.spec('leads', 'count', null, 'id; drop table leads'), pg_temp.a()) $$,
  'P0001', 'OXYN_INVALID_REPORT', 'dimensão fora da lista');
select throws_ok($$ select run_report_self(pg_temp.spec('leads', 'count', null, null,
  '[{"field":"id; drop table leads","op":"eq","value":"x"}]'), pg_temp.a()) $$,
  'P0001', 'OXYN_INVALID_REPORT', 'campo de filtro fora da lista');
select throws_ok($$ select run_report_self(pg_temp.spec('contas', 'count'), pg_temp.a()) $$,
  'P0001', 'OXYN_INVALID_REPORT', 'base desconhecida');
select throws_ok($$ select run_report_self(pg_temp.spec('leads', 'median'), pg_temp.a()) $$,
  'P0001', 'OXYN_INVALID_REPORT', 'métrica desconhecida');
select throws_ok($$ select run_report_self(pg_temp.spec('leads', 'count', null, null,
  '[{"field":"status","op":"like","value":"x"}]'), pg_temp.a()) $$,
  'P0001', 'OXYN_INVALID_REPORT', 'operador de filtro desconhecido');
select throws_ok($$ select run_report_self('{}'::jsonb, pg_temp.a()) $$,
  'P0001', 'OXYN_INVALID_REPORT', 'spec vazia');
select throws_ok($$ select run_report_self(pg_temp.spec('activities', 'conversion_rate'), pg_temp.a()) $$,
  'P0001', 'OXYN_INVALID_REPORT', 'conversion_rate em activities');
select throws_ok($$ select run_report_self(pg_temp.spec('leads', 'count', null, 'custom:nota'), pg_temp.a()) $$,
  'P0001', 'OXYN_INVALID_REPORT', 'custom field que não é select');
select throws_ok($$ select run_report_self(pg_temp.spec('leads', 'count', null, null, '[]',
  '{"field":"created_at","from":"2026-03-31","to":"2026-03-01"}'), pg_temp.a()) $$,
  'P0001', 'OXYN_INVALID_REPORT', 'período invertido');

select * from finish();
rollback;
