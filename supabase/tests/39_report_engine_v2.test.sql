begin;
select plan(27);

create function pg_temp.u(n int) returns uuid language sql immutable as $$
  select ('00000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
create function pg_temp.run(p jsonb, p_viewer int default 11) returns jsonb language sql as $$
  select public.run_report(p, array[pg_temp.u(1)], pg_temp.u(p_viewer)) $$;
create function pg_temp.sp(p_base text, p_chart text default 'number', p_extra jsonb default '{}') returns jsonb
language sql immutable as $$
  select jsonb_build_object('kind', 'custom', 'base', p_base, 'metric', jsonb_build_object('op', 'count'),
    'chart', p_chart) || p_extra $$;
create function pg_temp.bad(p jsonb) returns text language plpgsql as $$
begin
  perform public.validate_report_spec(p);
  return 'ok';
exception when others then
  return sqlerrm;
end $$;

insert into companies (id, name, slug) values (pg_temp.u(1), 'Motor v2', 'tst-mv2');
insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data) values
  (pg_temp.u(11), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tst-mv2g@oxyn.test', '{"full_name":"tst-gestor"}'),
  (pg_temp.u(13), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tst-mv2v@oxyn.test', '{"full_name":"tst-vend"}');
insert into roles (id, name, description, permissions) values
  (pg_temp.u(21), 'tst-Gestor-mv2', 'teste', '{"visibility":{"leads":"company","deals":"company","persons":"company","organizations":"company","activities":"company"},"actions":{"create":true,"edit":true,"delete":true,"export":true,"reassign_owner":true},"settings":{"manage_pipelines":true,"manage_custom_fields":true,"manage_products":true,"view_reports":true,"create_dashboards":true,"share_dashboards":true}}'::jsonb),
  (pg_temp.u(22), 'tst-Vend-mv2', 'teste', '{"visibility":{"leads":"own","deals":"own","persons":"own","organizations":"own","activities":"own"},"actions":{"create":true,"edit":true,"delete":false,"export":false,"reassign_owner":false},"settings":{"manage_pipelines":false,"manage_custom_fields":false,"manage_products":false,"view_reports":true,"create_dashboards":true,"share_dashboards":false}}'::jsonb);
insert into memberships (user_id, company_id, role_id) values
  (pg_temp.u(11), pg_temp.u(1), pg_temp.u(21)), (pg_temp.u(13), pg_temp.u(1), pg_temp.u(22));
insert into lead_sources (id, company_id, name) values (pg_temp.u(61), pg_temp.u(1), 'tst-Jitterbit'), (pg_temp.u(62), pg_temp.u(1), 'tst-Prospecção');
insert into organizations (id, company_id, owner_id, name, created_at) values
  (pg_temp.u(301), pg_temp.u(1), pg_temp.u(11), 'tst-Org A', now()),
  (pg_temp.u(302), pg_temp.u(1), pg_temp.u(13), 'tst-Org B', now());
insert into persons (id, company_id, owner_id, full_name, organization_id, custom_fields) values
  (pg_temp.u(311), pg_temp.u(1), pg_temp.u(11), 'tst-P1', pg_temp.u(301), '{}'),
  (pg_temp.u(312), pg_temp.u(1), pg_temp.u(13), 'tst-P2', pg_temp.u(302), '{}');
insert into custom_field_defs (company_id, entity, key, label, type, options) values
  (pg_temp.u(1), 'persons', 'canal_de_origem', 'Canal de origem', 'select', '["Jitterbit","Prospecção"]');
update persons set custom_fields = '{"canal_de_origem":"Jitterbit"}' where id = pg_temp.u(311);

-- leads: 3 neste mês (2 Jitterbit, 1 Prospecção), 1 no mês passado
insert into leads (id, company_id, owner_id, title, source_id, organization_id, person_id, created_at) values
  (pg_temp.u(101), pg_temp.u(1), pg_temp.u(11), 'tst-l1', pg_temp.u(61), pg_temp.u(301), pg_temp.u(311), (date_trunc('month', now() at time zone 'America/Sao_Paulo') + interval '12 hours') at time zone 'America/Sao_Paulo'),
  (pg_temp.u(102), pg_temp.u(1), pg_temp.u(11), 'tst-l2', pg_temp.u(61), pg_temp.u(301), null, (date_trunc('month', now() at time zone 'America/Sao_Paulo') + interval '13 hours') at time zone 'America/Sao_Paulo'),
  (pg_temp.u(103), pg_temp.u(1), pg_temp.u(13), 'tst-l3', pg_temp.u(62), pg_temp.u(302), pg_temp.u(312), (date_trunc('month', now() at time zone 'America/Sao_Paulo') + interval '14 hours') at time zone 'America/Sao_Paulo'),
  (pg_temp.u(104), pg_temp.u(1), pg_temp.u(11), 'tst-l4', pg_temp.u(62), null, null, (date_trunc('month', now() at time zone 'America/Sao_Paulo') + interval '-10 days') at time zone 'America/Sao_Paulo');
select set_config('oxyn.converting', 'on', true);
update leads set status = 'converted', converted_at = now() where id = pg_temp.u(102);
select set_config('oxyn.converting', 'off', true);

-- atividade concluída com resultado no lead 101
insert into activities (id, company_id, owner_id, created_by, type_id, channel_id, subject, due_at, lead_id, done, completed_at, outcome_id)
select pg_temp.u(201), pg_temp.u(1), pg_temp.u(11), pg_temp.u(11),
  (select id from activity_types where company_id = pg_temp.u(1) and name = 'Tarefa'),
  (select id from activity_channels where company_id = pg_temp.u(1) and name = 'WhatsApp'),
  'tst-a', now(), pg_temp.u(101), true, now(),
  (select id from activity_outcomes where company_id = pg_temp.u(1) and name = 'Reunião agendada');

-- 1. validação
select is(pg_temp.bad(pg_temp.sp('organizations')), 'ok', 'base organizations é aceita');
select is(pg_temp.bad(pg_temp.sp('leads', 'column', '{"group_by":"source","segment_by":"status"}')), 'ok', 'segmento aceito');
select is(pg_temp.bad(pg_temp.sp('leads', 'column', '{"segment_by":"status"}')), 'OXYN_INVALID_REPORT', 'segmento sem grupo é recusado');
select is(pg_temp.bad(pg_temp.sp('leads', 'number', '{"period":{"field":"created_at","relative":"this_month"}}')), 'ok', 'período relativo aceito');
select is(pg_temp.bad(pg_temp.sp('leads', 'number', '{"period":{"field":"created_at","relative":"ontem"}}')), 'OXYN_INVALID_REPORT', 'relativo desconhecido é recusado');
select is(pg_temp.bad(pg_temp.sp('deals', 'list', '{"columns":["title","value","custom:temperatura"]}')), 'ok', 'lista com colunas válidas');
select is(pg_temp.bad(pg_temp.sp('deals', 'list', '{"columns":["drop table"]}')), 'OXYN_INVALID_REPORT', 'coluna desconhecida é recusada');
select is(pg_temp.bad(pg_temp.sp('deals', 'list')), 'OXYN_INVALID_REPORT', 'lista sem colunas é recusada');
select is(pg_temp.bad(pg_temp.sp('leads', 'number', '{"filters":[{"field":"person.custom:x; drop","op":"eq","value":"a"}]}')),
  'OXYN_INVALID_REPORT', 'chave personalizada inválida é recusada');

-- 2. relativo e comparação
select is((pg_temp.run(pg_temp.sp('leads', 'number', '{"period":{"field":"created_at","relative":"this_month"}}'))->>'total')::int,
  3, 'este mês conta 3 leads');
select is((pg_temp.run(pg_temp.sp('leads', 'number', '{"period":{"field":"created_at","relative":"this_month"}}'))->>'previous')::int,
  1, 'previous traz o mês passado');
select ok(not (pg_temp.run(pg_temp.sp('leads', 'number'))) ? 'previous', 'sem período não há previous');
select is((public.report_relative_bounds('last_week', 0)).d_to - (public.report_relative_bounds('last_week', 0)).d_from, 6, 'semana tem 7 dias');
select is(extract(dow from (public.report_relative_bounds('this_week', 0)).d_from)::int, 0, 'semana começa no domingo');

-- 3. segmento
select is(pg_temp.run(pg_temp.sp('leads', 'column', '{"group_by":"source","segment_by":"status"}'))->'rows',
  '[["tst-Jitterbit","Aberto",1],["tst-Jitterbit","Convertido",1],["tst-Prospecção","Aberto",2]]'::jsonb,
  'linhas [grupo, segmento, valor] na ordem do total do grupo');
select is(jsonb_array_length(pg_temp.run(pg_temp.sp('leads', 'column', '{"group_by":"source","segment_by":"status"}'))->'columns'),
  3, 'colunas de grupo, segmento e valor');

-- 4. filtros novos
select is((pg_temp.run(pg_temp.sp('leads', 'number', jsonb_build_object('filters', jsonb_build_array(jsonb_build_object(
  'field', 'activity_outcome', 'op', 'in', 'value', jsonb_build_array(
    (select id from activity_outcomes where company_id = pg_temp.u(1) and name = 'Reunião agendada')))))))->>'total')::int,
  1, 'lead com atividade de resultado X (exists)');
select is((pg_temp.run(pg_temp.sp('leads', 'number', '{"filters":[{"field":"person.custom:canal_de_origem","op":"eq","value":"Jitterbit"}]}'))->>'total')::int,
  1, 'filtro pelo campo personalizado da pessoa');
select is((pg_temp.run(pg_temp.sp('leads', 'number', jsonb_build_object('filters', jsonb_build_array(jsonb_build_object(
  'field', 'source', 'op', 'not_in', 'value', jsonb_build_array(pg_temp.u(61)))))))->>'total')::int,
  2, 'não é nenhum de');
select is((pg_temp.run(pg_temp.sp('leads', 'number', '{"filters":[{"field":"activities_count","op":"gte","value":1}]}'))->>'total')::int,
  1, 'leads com atividade');

-- 5. organizações e visibilidade
select is((pg_temp.run(pg_temp.sp('organizations'))->>'total')::int, 2, 'gestor vê as 2 organizações');
select is((pg_temp.run(pg_temp.sp('organizations'), 13)->>'total')::int, 1, 'vendedor vê só a dele');
select is((pg_temp.run(pg_temp.sp('organizations', 'number', '{"period":{"field":"lead_created_at","relative":"this_month"}}'))->>'total')::int,
  2, 'organizações com lead criado no mês (período por registro ligado)');

-- 6. lista
select is(pg_temp.run(pg_temp.sp('leads', 'list', '{"columns":["title","source","organization"],"filters":[{"field":"status","op":"eq","value":"open"}]}'))->'rows'->0,
  '["tst-l3","tst-Prospecção","tst-Org B"]'::jsonb, 'lista traz as colunas, mais recente primeiro');

-- 7. restrict_filters
select is((public.restrict_filters(pg_temp.sp('leads', 'number', '{"period":{"field":"created_at","from":"2020-01-01","to":"2020-01-31"}}'),
  '{"period":{"relative":"this_month"}}', array[pg_temp.u(1)])).spec->'period',
  '{"field":"created_at","relative":"this_month"}'::jsonb, 'período do painel substitui o do widget');
select is(coalesce(jsonb_array_length((public.restrict_filters(pg_temp.sp('leads'), jsonb_build_object('pipeline', jsonb_build_array(pg_temp.u(9))),
  array[pg_temp.u(1)])).spec->'filters'), 0), 0, 'funil é ignorado em base sem funil');
select is((public.restrict_filters(pg_temp.sp('deals'), jsonb_build_object('pipeline', jsonb_build_array(pg_temp.u(9))),
  array[pg_temp.u(1)])).spec->'filters'->0->>'field', 'pipeline', 'funil vira filtro em negócios');

select * from finish();
rollback;
