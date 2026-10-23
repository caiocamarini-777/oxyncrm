begin;
select plan(34);

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
-- spec de preset; período padrão: março de 2026
create function pg_temp.p(p_kind text, p_params jsonb default '{}', p_filters jsonb default '[]',
  p_period jsonb default '{"from":"2026-03-01","to":"2026-03-31"}') returns jsonb
language sql immutable as $$
  select jsonb_strip_nulls(jsonb_build_object('kind', p_kind, 'params', p_params, 'filters', p_filters, 'period', p_period)) $$;
create function pg_temp.a() returns uuid[] language sql immutable as $$ select array[pg_temp.u(1)] $$;
create function pg_temp.pf() returns jsonb language sql immutable as $$
  select '[{"field":"pipeline","op":"eq","value":"00000000-0000-4000-8000-000000000401"}]'::jsonb $$;
grant execute on function pg_temp.u(int), pg_temp.as_user(uuid), pg_temp.as_pg(),
  pg_temp.p(text, jsonb, jsonb, jsonb), pg_temp.a(), pg_temp.pf() to public;

insert into companies (id, name, slug) values (pg_temp.u(1), 'Volt Teste', 'tst-volt');
insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data) values
  (pg_temp.u(11), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tst-g@oxyn.test', '{"full_name":"tst-gestor"}'),
  (pg_temp.u(13), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tst-v@oxyn.test', '{"full_name":"tst-vend"}');
insert into roles (id, name, description, permissions) values
  (pg_temp.u(21), 'tst-Gestor', 'teste', '{"visibility":{"leads":"company","deals":"company","persons":"company","organizations":"company","activities":"company"},"actions":{"create":true,"edit":true,"delete":true,"export":true,"reassign_owner":true},"settings":{"manage_pipelines":true,"manage_custom_fields":true,"manage_products":true,"view_reports":true,"create_dashboards":true,"share_dashboards":true}}'::jsonb),
  (pg_temp.u(22), 'tst-Vendedor', 'teste', '{"visibility":{"leads":"own","deals":"own","persons":"own","organizations":"own","activities":"own"},"actions":{"create":true,"edit":true,"delete":false,"export":false,"reassign_owner":false},"settings":{"manage_pipelines":false,"manage_custom_fields":false,"manage_products":false,"view_reports":true,"create_dashboards":true,"share_dashboards":false}}'::jsonb);
insert into memberships (user_id, company_id, role_id) values
  (pg_temp.u(11), pg_temp.u(1), pg_temp.u(21)), (pg_temp.u(13), pg_temp.u(1), pg_temp.u(22));
insert into teams (id, name) values (pg_temp.u(31), 'tst-time-v');
insert into team_members (team_id, user_id) values (pg_temp.u(31), pg_temp.u(13));

-- Funil próprio (a empresa também recebe o "Funil de vendas" padrão)
insert into pipelines (id, company_id, name) values (pg_temp.u(401), pg_temp.u(1), 'tst-funil');
insert into stages (id, pipeline_id, company_id, name, position, probability) values
  (pg_temp.u(501), pg_temp.u(401), pg_temp.u(1), 'tst-e1', 0, 10),
  (pg_temp.u(502), pg_temp.u(401), pg_temp.u(1), 'tst-e2', 1, 50),
  (pg_temp.u(503), pg_temp.u(401), pg_temp.u(1), 'tst-e3', 2, 90);
insert into lost_reasons (id, company_id, name) values (pg_temp.u(601), pg_temp.u(1), 'tst-preco');

-- Leads: L1 vai ser convertido; L2 segue aberto
insert into leads (id, company_id, owner_id, title, created_at) values
  (pg_temp.u(101), pg_temp.u(1), pg_temp.u(11), 'tst-l1', '2026-03-01 09:00-03'),
  (pg_temp.u(102), pg_temp.u(1), pg_temp.u(11), 'tst-l2', '2026-01-10 09:00-03');

-- Negócios com datas conhecidas (gatilhos de status e de entrada na etapa desligados só na fixture)
alter table deals disable trigger deals_status_fields;
alter table deals disable trigger deals_stage_entry;
insert into deals (id, company_id, owner_id, title, pipeline_id, stage_id, status, created_at, stage_entered_at,
  won_at, lost_at, lost_reason_id, lead_id, estimated_value, expected_close_date,
  setup_total, setup_first_due, mrr, mrr_start, contract_months) values
  -- ganho: setup 1000 em março, MRR 100 de abril em diante (12 meses) = 2200
  (pg_temp.u(201), pg_temp.u(1), pg_temp.u(11), 'tst-d1', pg_temp.u(401), pg_temp.u(502), 'won', '2026-03-12 10:00-03', '2026-03-15 10:00-03',
   '2026-03-20 12:00-03', null, null, pg_temp.u(101), null, null, 1000, '2026-03-01', 100, '2026-04-01', 12),
  -- aberto na etapa de 50%: setup 400 em abril
  (pg_temp.u(202), pg_temp.u(1), pg_temp.u(11), 'tst-d2', pg_temp.u(401), pg_temp.u(502), 'open', '2026-02-01 10:00-03', '2026-03-16 10:00-03',
   null, null, null, null, null, '2026-04-15', 400, '2026-04-01', 0, null, null),
  -- perdido por preço, só com valor estimado
  (pg_temp.u(203), pg_temp.u(1), pg_temp.u(13), 'tst-d3', pg_temp.u(401), pg_temp.u(501), 'lost', '2026-03-02 10:00-03', '2026-03-02 10:00-03',
   null, '2026-03-25 12:00-03', pg_temp.u(601), null, 300, null, 0, null, 0, null, null),
  -- aberto do vendedor na etapa de 10%, sem cronograma
  (pg_temp.u(204), pg_temp.u(1), pg_temp.u(13), 'tst-d4', pg_temp.u(401), pg_temp.u(501), 'open', '2026-03-05 10:00-03', '2026-03-05 10:00-03',
   null, null, null, null, 1000, '2026-04-20', 0, null, 0, null, null);
alter table deals enable trigger deals_status_fields;
alter table deals enable trigger deals_stage_entry;
delete from deal_stage_history where deal_id in (pg_temp.u(201), pg_temp.u(202), pg_temp.u(203), pg_temp.u(204));
insert into deal_stage_history (deal_id, company_id, from_stage_id, to_stage_id, moved_at) values
  (pg_temp.u(201), pg_temp.u(1), null, pg_temp.u(501), '2026-03-12 10:00-03'),
  (pg_temp.u(201), pg_temp.u(1), pg_temp.u(501), pg_temp.u(502), '2026-03-15 10:00-03'),
  (pg_temp.u(202), pg_temp.u(1), null, pg_temp.u(501), '2026-02-01 10:00-03'),
  (pg_temp.u(202), pg_temp.u(1), pg_temp.u(501), pg_temp.u(502), '2026-03-16 10:00-03'),
  (pg_temp.u(203), pg_temp.u(1), null, pg_temp.u(501), '2026-03-02 10:00-03'),
  (pg_temp.u(204), pg_temp.u(1), null, pg_temp.u(501), '2026-03-05 10:00-03');

select set_config('oxyn.converting', 'on', true);
update leads set status = 'converted', converted_at = '2026-03-12 10:00-03', converted_deal_id = pg_temp.u(201)
 where id = pg_temp.u(101);
select set_config('oxyn.converting', 'off', true);

-- Atividades da jornada
insert into activities (id, company_id, owner_id, created_by, type_id, channel_id, subject, due_at, done, completed_at,
  outcome_id, meeting_outcome, booked_by_activity_id, origin_channel_id, lead_id, deal_id, legacy)
select pg_temp.u(n), pg_temp.u(1), o, o,
  (select id from activity_types where company_id = pg_temp.u(1) and name = t),
  (select id from activity_channels where company_id = pg_temp.u(1) and name = ch),
  'tst-ativ-' || n, coalesce(c, due), c is not null, c,
  (select id from activity_outcomes where company_id = pg_temp.u(1) and name = oc),
  mo, null::uuid,
  (select id from activity_channels where company_id = pg_temp.u(1) and name = och),
  ld, dl, lg
from (values
  -- 3 tentativas no LinkedIn em L1, a última agendou a reunião
  (301, pg_temp.u(11), 'Mensagem', 'LinkedIn', '2026-03-02 10:00-03'::timestamptz, null::timestamptz, 'Sem resposta', null, null, pg_temp.u(101), pg_temp.u(201), false),
  (302, pg_temp.u(11), 'Mensagem', 'LinkedIn', '2026-03-03 10:00-03', null, 'Sem resposta', null, null, pg_temp.u(101), pg_temp.u(201), false),
  (303, pg_temp.u(11), 'Mensagem', 'LinkedIn', '2026-03-04 10:00-03', null, 'Reunião agendada', null, null, pg_temp.u(101), pg_temp.u(201), false),
  -- a reunião agendada pelo LinkedIn foi realizada
  (304, pg_temp.u(11), 'Reunião', 'LinkedIn', '2026-03-10 10:00-03', null, null, 'held', 'LinkedIn', pg_temp.u(101), pg_temp.u(201), false),
  -- 2 tentativas por e-mail em L2, nenhuma agendou
  (305, pg_temp.u(11), 'E-mail', 'E-mail', '2026-03-05 10:00-03', null, 'Respondeu, pediu retorno', null, null, pg_temp.u(102), null, false),
  (306, pg_temp.u(11), 'E-mail', 'E-mail', '2026-03-06 10:00-03', null, 'Sem resposta', null, null, pg_temp.u(102), null, false),
  -- legada e apagada não contam
  (307, pg_temp.u(11), 'Mensagem', 'LinkedIn', '2026-03-07 10:00-03', null, 'Reunião agendada', null, null, pg_temp.u(102), null, true),
  (308, pg_temp.u(11), 'Mensagem', 'LinkedIn', '2026-03-08 10:00-03', null, 'Sem resposta', null, null, pg_temp.u(102), null, false),
  -- abertas: uma atrasada do gestor e uma futura do vendedor
  (309, pg_temp.u(11), 'Tarefa', 'Telefone', null, '2026-01-05 10:00-03', null, null, null, pg_temp.u(102), null, false),
  (310, pg_temp.u(13), 'Tarefa', 'Telefone', null, '2099-01-05 10:00-03', null, null, null, null, pg_temp.u(204), false)
) v(n, o, t, ch, c, due, oc, mo, och, ld, dl, lg);
update activities set deleted_at = now() where id = pg_temp.u(308);
update activities set booked_by_activity_id = pg_temp.u(303) where id = pg_temp.u(304);

-- 1. funil por canal -----------------------------------------------------------------------------
select pg_temp.as_user(pg_temp.u(11));
select is(run_report_self(pg_temp.p('channel_funnel'), pg_temp.a()),
  '{"columns":[{"key":"channel","label":"Canal","type":"text"},{"key":"attempts","label":"Tentativas","type":"number"},{"key":"meetings_booked","label":"Reuniões agendadas","type":"number"},{"key":"meetings_held","label":"Reuniões realizadas","type":"number"},{"key":"opportunities","label":"Oportunidades","type":"number"},{"key":"won","label":"Ganhos","type":"number"},{"key":"booked_rate","label":"Taxa de agendamento","type":"percent"},{"key":"held_rate","label":"Taxa de comparecimento","type":"percent"},{"key":"opportunity_rate","label":"Taxa de oportunidade","type":"percent"},{"key":"won_rate","label":"Taxa de ganho","type":"percent"}],"rows":[["LinkedIn",3,1,1,1,1,33.3,100.0,100.0,100.0],["E-mail",2,0,0,0,0,0,0,0,0]],"total":null}'::jsonb,
  'channel_funnel: LinkedIn 3/1/1/1/1 e e-mail 2/0/0/0/0 com taxas 0');
select is(run_report_self(pg_temp.p('channel_funnel', '{}', '[]',
  '{"from":"2026-03-11","to":"2026-03-31"}'), pg_temp.a())->'rows',
  '[["LinkedIn",0,0,0,1,1,0,0,0,100.0]]'::jsonb,
  'channel_funnel: período em completed_at das tentativas e da reunião, converted_at e won_at nos demais');
select is(run_report_self(pg_temp.p('channel_funnel', '{}',
  '[{"field":"owner","op":"eq","value":"00000000-0000-4000-8000-000000000013"}]'), pg_temp.a())->'rows',
  '[]'::jsonb, 'channel_funnel: filtro owner restringe');

-- 2. sucesso por canal ---------------------------------------------------------------------------
select is(run_report_self(pg_temp.p('channel_success'), pg_temp.a()),
  '{"columns":[{"key":"channel","label":"Canal","type":"text"},{"key":"done","label":"Concluídas","type":"number"},{"key":"success","label":"Sucesso","type":"number"},{"key":"neutral","label":"Neutro","type":"number"},{"key":"failure","label":"Fracasso","type":"number"},{"key":"no_outcome","label":"Sem resultado","type":"number"},{"key":"success_rate","label":"Taxa de sucesso","type":"percent"}],"rows":[["LinkedIn",4,1,0,2,1,25.0],["E-mail",2,0,1,1,0,0]],"total":null}'::jsonb,
  'channel_success conta por classificação');

-- 3. influência na conversão ---------------------------------------------------------------------
select is(run_report_self(pg_temp.p('conversion_influence'), pg_temp.a()),
  '{"columns":[{"key":"channel","label":"Canal","type":"text"},{"key":"conversions","label":"Leads convertidos","type":"number"},{"key":"stage_advances","label":"Avanços de etapa","type":"number"},{"key":"wins","label":"Ganhos","type":"number"}],"rows":[["LinkedIn",1,1,1]],"total":null}'::jsonb,
  'conversion_influence credita LinkedIn na conversão, no avanço e no ganho');

-- 4. conversão por etapa -------------------------------------------------------------------------
select is(run_report_self(pg_temp.p('stage_conversion', '{"pipeline":"00000000-0000-4000-8000-000000000401"}', '[]',
  '{"from":"2026-01-01","to":"2026-12-31"}'), pg_temp.a()),
  '{"columns":[{"key":"stage","label":"Etapa","type":"text"},{"key":"entered","label":"Entraram","type":"number"},{"key":"advanced","label":"Avançaram","type":"number"},{"key":"rate","label":"Taxa de conversão","type":"percent"}],"rows":[["tst-e1",4,2,50.0],["tst-e2",2,1,50.0],["tst-e3",0,0,0]],"total":null}'::jsonb,
  'stage_conversion dá as contagens por etapa (ganho conta como saída)');
select is(run_report_self(pg_temp.p('stage_conversion',
  '{"pipeline":"00000000-0000-4000-8000-000000000401","group_by":"owner"}', '[]',
  '{"from":"2026-01-01","to":"2026-12-31"}'), pg_temp.a()),
  '{"columns":[{"key":"owner","label":"Responsável","type":"text"},{"key":"stage","label":"Etapa","type":"text"},{"key":"entered","label":"Entraram","type":"number"},{"key":"advanced","label":"Avançaram","type":"number"},{"key":"rate","label":"Taxa de conversão","type":"percent"}],"rows":[["tst-gestor","tst-e1",2,2,100.0],["tst-gestor","tst-e2",2,1,50.0],["tst-vend","tst-e1",2,0,0]],"total":null}'::jsonb,
  'stage_conversion agrupado por owner');
select is(run_report_self(pg_temp.p('stage_conversion',
  '{"pipeline":"00000000-0000-4000-8000-000000000401","group_by":"month"}', '[]',
  '{"from":"2026-03-01","to":"2026-03-31"}'), pg_temp.a())->'rows',
  '[["2026-03-01","tst-e1",3,1,33.3],["2026-03-01","tst-e2",2,1,50.0]]'::jsonb,
  'stage_conversion agrupado por mês de entrada');

-- 5. forecast ------------------------------------------------------------------------------------
select is(run_report_self(pg_temp.p('forecast', '{}', '[]', '{"from":"2026-03-01","to":"2026-04-30"}'), pg_temp.a()),
  '{"columns":[{"key":"month","label":"Mês","type":"month"},{"key":"open_count","label":"Previstos","type":"number"},{"key":"open_value","label":"Valor previsto","type":"currency"},{"key":"won_count","label":"Ganhos","type":"number"},{"key":"won_value","label":"Valor realizado","type":"currency"}],"rows":[["2026-03-01",0,0,1,2200],["2026-04-01",2,1400,0,0]],"total":null}'::jsonb,
  'forecast dá o previsto (contrato ou estimado) e o realizado no mês');

-- 6. receita mês a mês ---------------------------------------------------------------------------
select is(run_report_self(pg_temp.p('revenue_monthly', '{}', '[]', '{"from":"2026-03-01","to":"2026-04-30"}'), pg_temp.a()),
  '{"columns":[{"key":"month","label":"Mês","type":"month"},{"key":"setup_contracted","label":"Setup contratado","type":"currency"},{"key":"mrr_contracted","label":"MRR contratado","type":"currency"},{"key":"setup_forecast","label":"Setup previsto","type":"currency"},{"key":"mrr_forecast","label":"MRR previsto","type":"currency"},{"key":"estimated_forecast","label":"Estimado previsto (sem cronograma)","type":"currency"}],"rows":[["2026-03-01",1000,0,0,0,0],["2026-04-01",0,100,200,0,100]],"total":null}'::jsonb,
  'revenue_monthly: Setup e MRR contratados, previsto ponderado por 0.5 e estimado por 0.1');

-- 7. visão do funil ------------------------------------------------------------------------------
select is(run_report_self(pg_temp.p('pipeline_overview', '{}', pg_temp.pf(), null), pg_temp.a()),
  '{"columns":[{"key":"pipeline","label":"Funil","type":"text"},{"key":"stage","label":"Etapa","type":"text"},{"key":"count","label":"Quantidade","type":"number"},{"key":"value","label":"Valor","type":"currency"}],"rows":[["tst-funil","tst-e1",1,1000],["tst-funil","tst-e2",1,400],["tst-funil","tst-e3",0,0]],"total":null}'::jsonb,
  'pipeline_overview dá os totais dos abertos por etapa');
select is(jsonb_array_length(run_report_self(pg_temp.p('pipeline_overview', '{}', '[]', null), pg_temp.a())->'rows'),
  8, 'pipeline_overview sem filtro lista as etapas de todos os funis');

-- 8. aging ---------------------------------------------------------------------------------------
select is(jsonb_path_query_array(run_report_self(pg_temp.p('aging', '{}', '[]', null), pg_temp.a())->'rows', '$[*][1]'),
  '["tst-l2","tst-d2","tst-d4"]'::jsonb, 'aging ordena pela idade, do mais antigo');
select is((run_report_self(pg_temp.p('aging', '{}', '[]', null), pg_temp.a())->'rows'->0) - 4,
  '["Lead","tst-l2","tst-gestor",null,null]'::jsonb, 'aging: lead sem etapa e sem dias na etapa');
select ok((run_report_self(pg_temp.p('aging', '{}', '[]', null), pg_temp.a())->'rows'->1->>5)::int
  = floor(extract(epoch from now() - '2026-03-16 10:00-03'::timestamptz) / 86400)::int, 'aging: dias na etapa do negócio');
select is(jsonb_path_query_array(run_report_self(pg_temp.p('aging', '{}', pg_temp.pf(), null), pg_temp.a())->'rows', '$[*][1]'),
  '["tst-d2","tst-d4"]'::jsonb, 'aging com filtro de funil tira os leads');

-- 9. atividades por usuário ----------------------------------------------------------------------
select is(run_report_self(pg_temp.p('activities_by_user'), pg_temp.a()),
  '{"columns":[{"key":"owner","label":"Responsável","type":"text"},{"key":"done","label":"Concluídas","type":"number"},{"key":"overdue","label":"Atrasadas","type":"number"},{"key":"open","label":"Abertas","type":"number"}],"rows":[["tst-gestor",6,1,1],["tst-vend",0,0,1]],"total":null}'::jsonb,
  'activities_by_user conta concluídas, atrasadas e abertas');

-- 10. motivos de perda ---------------------------------------------------------------------------
select is(run_report_self(pg_temp.p('lost_reasons'), pg_temp.a()),
  '{"columns":[{"key":"lost_reason","label":"Motivo de perda","type":"text"},{"key":"count","label":"Quantidade","type":"number"},{"key":"value","label":"Valor","type":"currency"}],"rows":[["tst-preco",1,300]],"total":null}'::jsonb,
  'lost_reasons dá a contagem e o valor');
select is(run_report_self(pg_temp.p('lost_reasons', '{}',
  '[{"field":"team","op":"in","value":["00000000-0000-4000-8000-000000000031"]}]'), pg_temp.a())->'rows',
  '[["tst-preco",1,300]]'::jsonb, 'filtro team mantém o negócio do vendedor');
select is(run_report_self(pg_temp.p('lost_reasons', '{}',
  '[{"field":"company","op":"eq","value":"00000000-0000-4000-8000-000000000002"}]'), pg_temp.a())->'rows',
  '[]'::jsonb, 'filtro company fora das empresas dá vazio');

-- 11. visibilidade do vendedor own ---------------------------------------------------------------
select pg_temp.as_user(pg_temp.u(13));
select is(run_report_self(pg_temp.p('pipeline_overview', '{}', pg_temp.pf(), null), pg_temp.a())->'rows',
  '[["tst-funil","tst-e1",1,1000],["tst-funil","tst-e2",0,0],["tst-funil","tst-e3",0,0]]'::jsonb,
  'vendedor own não vê os negócios do gestor no pipeline_overview');
select is(run_report_self(pg_temp.p('forecast', '{}', '[]', '{"from":"2026-03-01","to":"2026-04-30"}'), pg_temp.a())->'rows',
  '[["2026-04-01",1,1000,0,0]]'::jsonb, 'vendedor own não vê o ganho nem o aberto do gestor no forecast');
select is(run_report_self(pg_temp.p('revenue_monthly', '{}', '[]', '{"from":"2026-03-01","to":"2026-04-30"}'), pg_temp.a())->'rows',
  '[["2026-04-01",0,0,0,0,100]]'::jsonb, 'vendedor own só vê a própria receita prevista');
select is(run_report_self(pg_temp.p('channel_funnel'), pg_temp.a())->'rows', '[]'::jsonb,
  'vendedor own não vê as atividades do gestor no funil por canal');
select is(run_report_self(pg_temp.p('activities_by_user'), pg_temp.a())->'rows', '[["tst-vend",0,0,1]]'::jsonb,
  'vendedor own só vê as próprias atividades');

-- 12. acesso e validação -------------------------------------------------------------------------
select throws_ok($$ select report_preset_forecast('{}'::jsonb, pg_temp.a(), pg_temp.u(13), null, null) $$,
  '42501', null, 'authenticated não executa a função do preset direto');
select pg_temp.as_user(pg_temp.u(11));
select throws_ok($$ select run_report_self(pg_temp.p('ranking_secreto'), pg_temp.a()) $$,
  'P0001', 'OXYN_INVALID_REPORT', 'preset desconhecido');
select throws_ok($$ select run_report_self(pg_temp.p('stage_conversion'), pg_temp.a()) $$,
  'P0001', 'OXYN_INVALID_REPORT', 'stage_conversion sem pipeline');
select throws_ok($$ select run_report_self(pg_temp.p('stage_conversion',
  '{"pipeline":"00000000-0000-4000-8000-000000000401","group_by":"stage"}'), pg_temp.a()) $$,
  'P0001', 'OXYN_INVALID_REPORT', 'stage_conversion com agrupamento desconhecido');
select throws_ok($$ select run_report_self(pg_temp.p('forecast', '{"pipeline":"00000000-0000-4000-8000-000000000401"}'), pg_temp.a()) $$,
  'P0001', 'OXYN_INVALID_REPORT', 'param desconhecido');
select throws_ok($$ select run_report_self(pg_temp.p('channel_funnel', '{}', pg_temp.pf()), pg_temp.a()) $$,
  'P0001', 'OXYN_INVALID_REPORT', 'filtro de funil em preset de atividades');
select throws_ok($$ select run_report_self(pg_temp.p('forecast', '{}',
  '[{"field":"status","op":"eq","value":"won"}]'), pg_temp.a()) $$,
  'P0001', 'OXYN_INVALID_REPORT', 'filtro fora dos comuns');
select throws_ok($$ select run_report_self(pg_temp.p('forecast', '{}', '[]',
  '{"field":"won_at","from":"2026-03-01","to":"2026-03-31"}'), pg_temp.a()) $$,
  'P0001', 'OXYN_INVALID_REPORT', 'período de preset não escolhe campo');
select throws_ok($$ select run_report_self(pg_temp.p('forecast', '{}', '[]',
  '{"from":"2026-03-31","to":"2026-03-01"}'), pg_temp.a()) $$,
  'P0001', 'OXYN_INVALID_REPORT', 'período invertido');

select * from finish();
rollback;
