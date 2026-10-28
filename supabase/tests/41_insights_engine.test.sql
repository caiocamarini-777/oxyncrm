begin;
select plan(30);

create function pg_temp.u(n int) returns uuid language sql immutable as $$
  select ('00000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
create function pg_temp.today() returns date language sql stable as $$
  select (now() at time zone 'America/Sao_Paulo')::date $$;
-- instante ao meio-dia (São Paulo) de um dia
create function pg_temp.at(d date) returns timestamptz language sql immutable as $$
  select (d + time '12:00') at time zone 'America/Sao_Paulo' $$;
create function pg_temp.f(p_filter text, p_op text, p_val jsonb, p_period text default null) returns jsonb
language sql immutable as $$
  select jsonb_build_object('filter', p_filter, 'operands',
    case when p_op is null then '[]'::jsonb else jsonb_build_array(jsonb_build_object('name', p_op, 'defaultValue', p_val)) end,
    'period', p_period) $$;
create function pg_temp.d(p_type text, p_rt text, p_chart text, p_params jsonb) returns jsonb
language sql immutable as $$
  select jsonb_build_object('data_type', p_type, 'report_type', p_rt, 'chart_type', p_chart, 'parameters', p_params) $$;
create function pg_temp.run(p_def jsonb, p_over jsonb default '{}', p_viewer int default 11) returns jsonb language sql as $$
  select public.insights_exec(pg_temp.u(1), p_def, pg_temp.u(p_viewer), p_over) $$;
create function pg_temp.total(p_def jsonb, p_over jsonb default '{}', p_viewer int default 11) returns numeric language sql as $$
  select (pg_temp.run(p_def, p_over, p_viewer)->>'total')::numeric $$;
create function pg_temp.err(p_def jsonb) returns text language plpgsql as $$
begin
  perform pg_temp.run(p_def);
  return 'ok';
exception when others then
  return sqlerrm;
end $$;

insert into companies (id, name, slug) values (pg_temp.u(1), 'Motor Insights', 'tst-mi');
insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data) values
  (pg_temp.u(11), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tst-mi-g@oxyn.test', '{"full_name":"tst-gestor"}'),
  (pg_temp.u(13), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tst-mi-v@oxyn.test', '{"full_name":"tst-vend"}');
insert into roles (id, name, description, permissions) values
  (pg_temp.u(21), 'tst-mi-gestor', 'teste', '{"visibility":{"leads":"company","deals":"company","persons":"company","organizations":"company","activities":"company"},"actions":{"create":true,"edit":true,"delete":true,"export":true,"reassign_owner":true},"settings":{"manage_pipelines":true,"manage_custom_fields":true,"manage_products":true,"view_reports":true,"create_dashboards":true,"share_dashboards":true}}'::jsonb),
  (pg_temp.u(22), 'tst-mi-vend', 'teste', '{"visibility":{"leads":"own","deals":"own","persons":"own","organizations":"own","activities":"own"},"actions":{"create":true,"edit":true,"delete":false,"export":false,"reassign_owner":false},"settings":{"manage_pipelines":false,"manage_custom_fields":false,"manage_products":false,"view_reports":true,"create_dashboards":true,"share_dashboards":false}}'::jsonb);
insert into memberships (user_id, company_id, role_id) values (pg_temp.u(11), pg_temp.u(1), pg_temp.u(21)), (pg_temp.u(13), pg_temp.u(1), pg_temp.u(22));
insert into lead_sources (id, company_id, name) values (pg_temp.u(61), pg_temp.u(1), 'tst-Jitterbit'), (pg_temp.u(62), pg_temp.u(1), 'tst-Prospecção');
insert into labels (id, company_id, name, color) values (pg_temp.u(71), pg_temp.u(1), 'tst-omni', 'blue');
insert into custom_field_defs (company_id, entity, key, label, type, options) values
  (pg_temp.u(1), 'persons', 'canal_de_origem', 'Canal de origem', 'select', '["Jitterbit","Prospecção"]'),
  (pg_temp.u(1), 'deals', 'temperatura', 'Temperatura', 'select', '["Quente","Frio"]');
insert into organizations (id, company_id, owner_id, name) values (pg_temp.u(301), pg_temp.u(1), pg_temp.u(11), 'tst-Org A');
insert into persons (id, company_id, owner_id, full_name, organization_id, custom_fields) values
  (pg_temp.u(311), pg_temp.u(1), pg_temp.u(11), 'tst-P1', pg_temp.u(301), '{"canal_de_origem":"Jitterbit"}'),
  (pg_temp.u(312), pg_temp.u(1), pg_temp.u(13), 'tst-P2', null, '{}');

-- leads: 3 neste mês (2 Jitterbit, 1 sem canal), 1 no mês passado; 1 convertido
insert into leads (id, company_id, owner_id, title, source_id, person_id, organization_id, estimated_value, created_at) values
  (pg_temp.u(101), pg_temp.u(1), pg_temp.u(11), 'tst-l1', pg_temp.u(61), pg_temp.u(311), pg_temp.u(301), 100, pg_temp.at(date_trunc('month', pg_temp.today())::date)),
  (pg_temp.u(102), pg_temp.u(1), pg_temp.u(11), 'tst-l2', pg_temp.u(61), null, null, 200, pg_temp.at(date_trunc('month', pg_temp.today())::date)),
  (pg_temp.u(103), pg_temp.u(1), pg_temp.u(13), 'tst-l3', null, pg_temp.u(312), null, 0, pg_temp.at(date_trunc('month', pg_temp.today())::date)),
  (pg_temp.u(104), pg_temp.u(1), pg_temp.u(11), 'tst-l4', pg_temp.u(62), null, null, 0, pg_temp.at(date_trunc('month', pg_temp.today())::date - 10));
insert into record_labels (label_id, entity, record_id) values (pg_temp.u(71), 'leads', pg_temp.u(101)), (pg_temp.u(71), 'leads', pg_temp.u(103));
select set_config('oxyn.converting', 'on', true);
update leads set status = 'converted', converted_at = now() where id = pg_temp.u(102);
select set_config('oxyn.converting', 'off', true);

-- funil com 3 etapas; negócios: d1 ganho (passou por e1, e2, e3), d2 aberto em e2, d3 perdido em e1
insert into pipelines (id, company_id, name) values (pg_temp.u(401), pg_temp.u(1), 'tst-funil');
insert into stages (id, pipeline_id, company_id, name, position, probability) values
  (pg_temp.u(501), pg_temp.u(401), pg_temp.u(1), 'tst-e1', 0, 10),
  (pg_temp.u(502), pg_temp.u(401), pg_temp.u(1), 'tst-e2', 1, 50),
  (pg_temp.u(503), pg_temp.u(401), pg_temp.u(1), 'tst-e3', 2, 90);
insert into lost_reasons (id, company_id, name) values (pg_temp.u(81), pg_temp.u(1), 'tst-preço');
alter table deals disable trigger deals_status_fields;
alter table deals disable trigger deals_stage_entry;
insert into deals (id, company_id, owner_id, title, pipeline_id, stage_id, status, estimated_value, created_at, won_at, lost_at, lost_reason_id, expected_close_date, custom_fields) values
  (pg_temp.u(201), pg_temp.u(1), pg_temp.u(11), 'tst-d1', pg_temp.u(401), pg_temp.u(503), 'won', 1000, pg_temp.at(pg_temp.today() - 20), pg_temp.at(pg_temp.today()), null, null, null, '{"temperatura":"Quente"}'),
  (pg_temp.u(202), pg_temp.u(1), pg_temp.u(13), 'tst-d2', pg_temp.u(401), pg_temp.u(502), 'open', 500, pg_temp.at(pg_temp.today() - 5), null, null, null, pg_temp.today() + 40, '{}'),
  (pg_temp.u(203), pg_temp.u(1), pg_temp.u(11), 'tst-d3', pg_temp.u(401), pg_temp.u(501), 'lost', 300, pg_temp.at(pg_temp.today() - 5), null, pg_temp.at(pg_temp.today()), pg_temp.u(81), null, '{}');
alter table deals enable trigger deals_status_fields;
alter table deals enable trigger deals_stage_entry;
delete from deal_stage_history where deal_id in (pg_temp.u(201), pg_temp.u(202), pg_temp.u(203));
insert into deal_stage_history (deal_id, company_id, from_stage_id, to_stage_id, moved_at) values
  (pg_temp.u(201), pg_temp.u(1), null, pg_temp.u(501), pg_temp.at(pg_temp.today() - 20)),
  (pg_temp.u(201), pg_temp.u(1), pg_temp.u(501), pg_temp.u(502), pg_temp.at(pg_temp.today() - 18)),
  (pg_temp.u(201), pg_temp.u(1), pg_temp.u(502), pg_temp.u(503), pg_temp.at(pg_temp.today() - 10)),
  (pg_temp.u(202), pg_temp.u(1), null, pg_temp.u(502), pg_temp.at(pg_temp.today() - 5)),
  (pg_temp.u(203), pg_temp.u(1), null, pg_temp.u(501), pg_temp.at(pg_temp.today() - 5));

-- atividades: concluídas hoje, uma no lead 101 com resultado
insert into activities (id, company_id, owner_id, created_by, type_id, channel_id, subject, due_at, lead_id, person_id, done, completed_at, outcome_id)
select pg_temp.u(n), pg_temp.u(1), pg_temp.u(11), pg_temp.u(11),
  (select id from activity_types where company_id = pg_temp.u(1) and name = 'Tarefa'),
  (select id from activity_channels where company_id = pg_temp.u(1) and name = 'WhatsApp'),
  'tst-a' || n, now(), l, p, true, now(),
  (select id from activity_outcomes where company_id = pg_temp.u(1) and name = 'Reunião agendada')
from (values (601, pg_temp.u(101), pg_temp.u(311)), (602, null::uuid, pg_temp.u(312))) v(n, l, p);

-- 1. filtros e operadores
select is(pg_temp.total(pg_temp.d('leads', 'performance', 'scorecard', jsonb_build_object('measure_by', 'count',
  'filter_by', jsonb_build_array(pg_temp.f('addTime', null, null, 'month'))))), 3::numeric, 'leads criados neste mês');
select is(pg_temp.total(pg_temp.d('leads', 'performance', 'scorecard', jsonb_build_object('measure_by', 'count',
  'filter_by', jsonb_build_array(pg_temp.f('addTime', null, null, 'month'), pg_temp.f('active', 'isExactly', 'true'))))), 2::numeric, 'ativos = abertos');
select is(pg_temp.total(pg_temp.d('leads', 'performance', 'scorecard', jsonb_build_object('measure_by', 'count',
  'filter_by', jsonb_build_array(pg_temp.f('label', 'isAnyOf', jsonb_build_array(pg_temp.u(71))))))), 2::numeric, 'etiqueta isAnyOf');
select is(pg_temp.total(pg_temp.d('leads', 'performance', 'scorecard', jsonb_build_object('measure_by', 'count',
  'filter_by', jsonb_build_array(pg_temp.f('channel', 'isNotAnyOf', jsonb_build_array(pg_temp.u(61))))))), 2::numeric,
  'isNotAnyOf mantém os sem valor');
select is(pg_temp.total(pg_temp.d('leads', 'performance', 'scorecard', jsonb_build_object('measure_by', 'count',
  'filter_by', jsonb_build_array(pg_temp.f('channel', 'isEmpty', 'true'))))), 1::numeric, 'isEmpty');
select is(pg_temp.total(pg_temp.d('leads', 'performance', 'scorecard', jsonb_build_object('measure_by', 'count',
  'filter_by', jsonb_build_array(pg_temp.f('title', 'contains', '"l1"'))))), 1::numeric, 'contains');
select is(pg_temp.total(pg_temp.d('leads', 'performance', 'scorecard', jsonb_build_object('measure_by', 'value',
  'filter_by', '[]'::jsonb))), 300::numeric, 'soma do valor do lead');
select is(pg_temp.total(pg_temp.d('leads', 'performance', 'scorecard', jsonb_build_object('measure_by', 'count',
  'filter_by', jsonb_build_array(pg_temp.f('channel', 'isExactly', to_jsonb('00000000-0000-4000-8000-000000000000'::text)))))), 0::numeric,
  'referência inexistente não traz nada');

-- 2. campos ligados e personalizados
select is(pg_temp.total(pg_temp.d('activities', 'performance', 'scorecard', jsonb_build_object('measure_by', 'count',
  'filter_by', jsonb_build_array(pg_temp.f('lead_id_label', 'isExactly', to_jsonb(pg_temp.u(71)::text)))))), 1::numeric, 'atividade pela etiqueta do lead');
select is(pg_temp.total(pg_temp.d('leads', 'performance', 'scorecard', jsonb_build_object('measure_by', 'count',
  'filter_by', jsonb_build_array(pg_temp.f('person_id_canal_de_origem', 'isExactly', '"Jitterbit"'))))), 1::numeric, 'lead pelo campo personalizado da pessoa');
select is(pg_temp.total(pg_temp.d('leads', 'performance', 'scorecard', jsonb_build_object('measure_by', 'count',
  'filter_by', jsonb_build_array(pg_temp.f('activity_id_outcome', 'isAnyOf',
    jsonb_build_array((select id from activity_outcomes where company_id = pg_temp.u(1) and name = 'Reunião agendada'))))))), 1::numeric,
  'lead com atividade de resultado');
select is(pg_temp.total(pg_temp.d('people', 'performance', 'scorecard', jsonb_build_object('measure_by', 'count',
  'filter_by', jsonb_build_array(pg_temp.f('activitiesCount', 'isNotEmpty', 'true'))))), 2::numeric, 'pessoas com atividades');
select is(pg_temp.run(pg_temp.d('deals', 'stats', 'column', jsonb_build_object('measure_by', 'value', 'group_by', jsonb_build_object('filter', 'temperatura'),
  'filter_by', '[]'::jsonb)))->'x'->0->>'label', 'Quente', 'agrupa por campo personalizado');

-- 3. agrupamento, segmento, intervalos
select is(jsonb_array_length(pg_temp.run(pg_temp.d('leads', 'performance', 'bar', jsonb_build_object('measure_by', 'count',
  'group_by', jsonb_build_object('filter', 'addTime', 'interval', 'month'),
  'filter_by', jsonb_build_array(pg_temp.f('addTime', null, null, 'year')))))->'x'),
  extract(month from (date_trunc('year', pg_temp.today()) + interval '1 year - 1 day'))::int, 'meses vazios do ano preenchidos');
select is(pg_temp.run(pg_temp.d('leads', 'performance', 'column', jsonb_build_object('measure_by', 'count',
  'group_by', jsonb_build_object('filter', 'channel', 'interval', false), 'segment_by', 'status', 'filter_by', '[]'::jsonb)))->'segments',
  '[{"key":"open","label":"Aberto"},{"key":"converted","label":"Convertido"}]'::jsonb, 'segmentos na ordem das opções');
select is(pg_temp.run(pg_temp.d('leads', 'performance', 'column', jsonb_build_object('measure_by', 'count',
  'group_by', jsonb_build_object('filter', 'channel'), 'segment_by', 'status', 'filter_by', '[]'::jsonb)))->'values'->0,
  '[1, 1]'::jsonb, 'Jitterbit: 1 aberto e 1 convertido');
select is((pg_temp.run(pg_temp.d('leads', 'performance', 'column', jsonb_build_object('measure_by', 'count',
  'group_by', jsonb_build_object('filter', 'channel'), 'filter_by', '[]'::jsonb)))->'x'->-1->>'label'), '(nenhum)', 'sem valor vira (nenhum)');
select is((pg_temp.run(pg_temp.d('activities', 'performance', 'pie', jsonb_build_object('measure_by', 'count',
  'group_by', jsonb_build_object('filter', 'type'), 'filter_by', '[]'::jsonb)))->'x'->0->>'label'), 'WhatsApp', 'tipo do Pipedrive pelo canal');

-- 4. tipos de relatório
select is(pg_temp.run(pg_temp.d('deals', 'funnel_conversion', 'funnel', jsonb_build_object('measure_by', 'count',
  'stages', jsonb_build_array(pg_temp.u(501), pg_temp.u(502), pg_temp.u(503)), 'filter_by', '[]'::jsonb)))->'totals',
  '[3, 2, 1, 1]'::jsonb, 'funil: chegaram a cada etapa e ganhos');
select is(round((pg_temp.run(pg_temp.d('deals', 'duration', 'column', jsonb_build_object('measure_by', 'duration',
  'group_by', jsonb_build_object('filter', 'dealStageLogStageId'),
  'filter_by', jsonb_build_array(pg_temp.f('status', 'isAnyOf', '["won"]')))))->'totals'->1)::numeric), 8::numeric, 'duração média na etapa 2');
select is(pg_temp.run(pg_temp.d('deals', 'revenue_forecast', 'column', jsonb_build_object('measure_by', 'value',
  'group_by', jsonb_build_object('filter', 'expectedCloseDateOrWonTime', 'interval', 'month'), 'segment_by', 'status',
  'filter_by', '[]'::jsonb)))->'total', '1500'::jsonb, 'previsão: ganhos e abertos, sem perdidos');
select is(pg_temp.total(pg_temp.d('deals', 'conversion_overall', 'scorecard', jsonb_build_object('measure_by', 'count', 'filter_by', '[]'::jsonb))),
  2::numeric, 'conversão geral só com fechados');
select is(pg_temp.total(pg_temp.d('deals', 'stats', 'scorecard', jsonb_build_object('measure_by', 'weightedValue', 'filter_by',
  jsonb_build_array(pg_temp.f('status', 'isExactly', '"open"'))))), 250::numeric, 'valor ponderado pela probabilidade da etapa');

-- 5. número com período anterior, filtros rápidos
select is(pg_temp.run(pg_temp.d('leads', 'performance', 'scorecard', jsonb_build_object('measure_by', 'count',
  'filter_by', jsonb_build_array(pg_temp.f('addTime', null, null, 'month')))))->'previous', '1'::jsonb, 'previous do mês passado');
select is(pg_temp.total(pg_temp.d('leads', 'performance', 'scorecard', jsonb_build_object('measure_by', 'count',
  'filter_by', jsonb_build_array(pg_temp.f('addTime', null, null, 'month')))), '{"period":{"period":"lastMonth"}}'), 1::numeric,
  'período do painel substitui o filtro de data');
select is(pg_temp.total(pg_temp.d('leads', 'performance', 'scorecard', jsonb_build_object('measure_by', 'count',
  'filter_by', '[]'::jsonb)), '{"period":{"period":"lastMonth"}}'), 4::numeric, 'relatório sem data não muda com o período do painel');
select is(pg_temp.total(pg_temp.d('leads', 'performance', 'scorecard', jsonb_build_object('measure_by', 'count',
  'filter_by', jsonb_build_array(pg_temp.f('userId', 'isExactly', to_jsonb(pg_temp.u(11)::text))))),
  jsonb_build_object('user_ids', jsonb_build_array(pg_temp.u(13)))), 1::numeric, 'usuário do painel substitui o proprietário');

-- 6. visibilidade e validação
select is(pg_temp.total(pg_temp.d('leads', 'performance', 'scorecard', jsonb_build_object('measure_by', 'count', 'filter_by', '[]'::jsonb)), '{}', 13),
  1::numeric, 'vendedor só conta os próprios');
select is(pg_temp.err(pg_temp.d('leads', 'performance', 'scorecard', jsonb_build_object('filter_by',
  jsonb_build_array(pg_temp.f('drop table', 'isExactly', '"x"'))))), 'OXYN_INVALID_REPORT', 'campo desconhecido');
select is(pg_temp.err(pg_temp.d('leads', 'performance', 'funnel', '{}')), 'OXYN_INVALID_REPORT', 'gráfico fora do tipo');

select * from finish();
rollback;
