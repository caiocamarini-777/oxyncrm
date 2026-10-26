begin;
select plan(33);

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
grant execute on function pg_temp.u(int), pg_temp.as_user(uuid), pg_temp.as_pg() to public;

insert into companies (id, name, slug) values (pg_temp.u(1), 'Volt Teste', 'tst-volt');
insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data)
select pg_temp.u(n), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tst-imp' || n || '@oxyn.test', '{"full_name":"x"}'
from unnest(array[11, 18]) n;
-- 11 gestor da empresa, 18 admin geral
update profiles set is_super_admin = true where id = pg_temp.u(18);
insert into roles (id, name, description, permissions) values
  (pg_temp.u(21), 'tst-Gestor', 'teste', '{"visibility":{"leads":"company","deals":"company","persons":"company","organizations":"company","activities":"company"},"actions":{"create":true,"edit":true,"delete":true,"export":true,"reassign_owner":true},"settings":{"manage_pipelines":true,"manage_custom_fields":true,"manage_products":true,"view_reports":true,"create_dashboards":true,"share_dashboards":true}}'::jsonb);
insert into memberships (user_id, company_id, role_id) values (pg_temp.u(11), pg_temp.u(1), pg_temp.u(21));

insert into pipelines (id, company_id, name) values (pg_temp.u(401), pg_temp.u(1), 'tst-funil');
insert into stages (id, pipeline_id, company_id, name, position) values
  (pg_temp.u(501), pg_temp.u(401), pg_temp.u(1), 'tst-e1', 0), (pg_temp.u(502), pg_temp.u(401), pg_temp.u(1), 'tst-e2', 1);
insert into lost_reasons (id, company_id, name) values (pg_temp.u(601), pg_temp.u(1), 'tst-motivo');

insert into import_jobs (id, source, status, created_by) values (pg_temp.u(701), 'pipedrive', 'draft', pg_temp.u(18));
insert into external_ids (source, entity, external_id, company_id, record_id, job_id)
values ('pipedrive', 'deals', '1', pg_temp.u(1), pg_temp.u(501), pg_temp.u(701));

-- 1. RLS -----------------------------------------------------------------------------------------
select pg_temp.as_user(pg_temp.u(11));
select is((select count(*) from import_jobs), 0::bigint, 'usuário logado não lê import_jobs');
select is((select count(*) from external_ids), 0::bigint, 'usuário logado não lê external_ids');
select throws_ok($$ insert into import_jobs (source, status) values ('pipedrive', 'draft') $$, '42501', null,
  'usuário logado não cria import_jobs');
select pg_temp.as_user(pg_temp.u(18));
select is((select count(*) from import_jobs), 1::bigint, 'admin geral lê import_jobs');
select is((select count(*) from external_ids), 1::bigint, 'admin geral lê external_ids');
select lives_ok($$ update import_jobs set status = 'running' where id = pg_temp.u(701) $$, 'admin geral escreve import_jobs');
select is((select status from import_jobs where id = pg_temp.u(701)), 'running', 'update do admin geral aplicado');
select throws_ok($$ insert into external_ids (source, entity, external_id, company_id, record_id)
  values ('pipedrive', 'deals', '2', pg_temp.u(1), pg_temp.u(502)) $$, '42501', null,
  'nem o admin geral escreve em external_ids');
select pg_temp.as_pg();
select throws_ok($$ insert into import_jobs (source, status) values ('hubspot', 'draft') $$, '23514', null,
  'source só aceita pipedrive');
select ok(not has_table_privilege('service_role', 'public.external_ids', 'insert'),
  'external_ids: escrita só por funções definer');

-- 2. importing() ---------------------------------------------------------------------------------
select ok(not public.importing(), 'importing() falso sem o GUC');
select set_config('oxyn.importing', 'x', true);
select ok(public.importing(), 'importing() verdadeiro como postgres com o GUC');
select pg_temp.as_user(pg_temp.u(11));
select set_config('oxyn.importing', 'x', true);
select ok(not public.importing(), 'importing() falso para authenticated mesmo com o GUC');
insert into deals (id, company_id, owner_id, title, pipeline_id, stage_id, status, won_at, created_by)
values (pg_temp.u(210), pg_temp.u(1), pg_temp.u(11), 'tst-neg-logado', pg_temp.u(401), pg_temp.u(501), 'won', '2024-03-10', pg_temp.u(11));
select ok((select won_at > now() - interval '1 minute' from deals where id = pg_temp.u(210)),
  'authenticated com o GUC não preserva won_at');
select pg_temp.as_pg();

-- 3. Datas históricas em negócios ------------------------------------------------------------------
select set_config('oxyn.importing', 'on', true);
insert into deals (id, company_id, owner_id, title, pipeline_id, stage_id, status, won_at, created_at, stage_entered_at) values
  (pg_temp.u(201), pg_temp.u(1), pg_temp.u(11), 'tst-neg-ganho', pg_temp.u(401), pg_temp.u(501), 'won',
   '2024-03-10', '2024-01-05', '2024-02-01');
insert into deals (id, company_id, owner_id, title, pipeline_id, stage_id, status, lost_at, lost_reason_id) values
  (pg_temp.u(202), pg_temp.u(1), pg_temp.u(11), 'tst-neg-perdido', pg_temp.u(401), pg_temp.u(501), 'lost',
   '2024-04-11', pg_temp.u(601));
select is((select won_at from deals where id = pg_temp.u(201)), '2024-03-10'::timestamptz, 'com o GUC won_at é preservado');
select is((select created_at from deals where id = pg_temp.u(201)), '2024-01-05'::timestamptz, 'com o GUC created_at é preservado');
select is((select stage_entered_at from deals where id = pg_temp.u(201)), '2024-02-01'::timestamptz,
  'com o GUC stage_entered_at é preservado');
select is((select lost_at from deals where id = pg_temp.u(202)), '2024-04-11'::timestamptz, 'com o GUC lost_at é preservado');
update deals set stage_id = pg_temp.u(502), stage_entered_at = '2024-02-20' where id = pg_temp.u(201);
select is((select stage_entered_at from deals where id = pg_temp.u(201)), '2024-02-20'::timestamptz,
  'com o GUC a troca de etapa respeita stage_entered_at informado');
select set_config('oxyn.importing', '', true);
insert into deals (id, company_id, owner_id, title, pipeline_id, stage_id, status, won_at, stage_entered_at) values
  (pg_temp.u(203), pg_temp.u(1), pg_temp.u(11), 'tst-neg-sem-guc', pg_temp.u(401), pg_temp.u(501), 'won',
   '2024-03-10', '2024-02-01');
select ok((select won_at > now() - interval '1 minute' from deals where id = pg_temp.u(203)), 'sem o GUC o trigger sobrescreve won_at');
select ok((select stage_entered_at > now() - interval '1 minute' from deals where id = pg_temp.u(203)),
  'sem o GUC o trigger sobrescreve stage_entered_at');

-- 4. Lead convertido ----------------------------------------------------------------------------------
select throws_ok($$ insert into leads (company_id, owner_id, title, status, converted_deal_id, converted_at)
  values (pg_temp.u(1), pg_temp.u(11), 'tst-lead-x', 'converted', pg_temp.u(201), '2024-03-01') $$,
  'P0001', 'OXYN_INVALID_TRANSITION', 'sem o GUC lead convertido é recusado');
select set_config('oxyn.importing', 'on', true);
select lives_ok($$ insert into leads (id, company_id, owner_id, title, status, converted_deal_id, converted_at)
  values (pg_temp.u(301), pg_temp.u(1), pg_temp.u(11), 'tst-lead-conv', 'converted', pg_temp.u(201), '2024-03-01') $$,
  'com o GUC lead convertido é aceito');
select is((select converted_at from leads where id = pg_temp.u(301)), '2024-03-01'::timestamptz, 'converted_at preservado');

-- 5. Sem linha do tempo ---------------------------------------------------------------------------------
insert into persons (id, company_id, owner_id, full_name) values (pg_temp.u(311), pg_temp.u(1), pg_temp.u(11), 'tst-pessoa');
insert into organizations (id, company_id, owner_id, name) values (pg_temp.u(312), pg_temp.u(1), pg_temp.u(11), 'tst-org');
insert into labels (id, company_id, name, color) values (pg_temp.u(313), pg_temp.u(1), 'tst-etq', 'teal');
insert into record_labels (label_id, entity, record_id) values (pg_temp.u(313), 'leads', pg_temp.u(301));
insert into notes (id, company_id, entity, record_id, body, created_by) values (pg_temp.u(314), pg_temp.u(1), 'deals', pg_temp.u(201), 'tst-nota', pg_temp.u(11));
select lives_ok($$ insert into activities (id, company_id, owner_id, type_id, channel_id, subject, due_at, deal_id, lead_id,
    done, completed_at, outcome_id, legacy, created_at)
  values (pg_temp.u(315), pg_temp.u(1), pg_temp.u(11),
    (select id from activity_types where company_id = pg_temp.u(1) and name = 'Ligação'),
    (select id from activity_channels where company_id = pg_temp.u(1) and is_legacy),
    'tst-ativ-legada', '2024-03-02', pg_temp.u(201), pg_temp.u(301),
    true, '2024-03-02', (select id from activity_outcomes where company_id = pg_temp.u(1) order by position limit 1), true, '2024-03-01') $$,
  'com o GUC atividade legada concluída com desfecho é aceita');
update deals set title = 'tst-neg-ganho-2' where id = pg_temp.u(201);
select is((select count(*) from timeline_events
  where record_id in (pg_temp.u(201), pg_temp.u(202), pg_temp.u(301), pg_temp.u(311), pg_temp.u(312))), 0::bigint,
  'com o GUC lead, negócio, pessoa, organização, etiqueta, anotação e atividade não criam timeline_events');
select set_config('oxyn.importing', '', true);
insert into notes (company_id, entity, record_id, body, created_by) values (pg_temp.u(1), 'deals', pg_temp.u(201), 'tst-nota-2', pg_temp.u(11));
select is((select count(*) from timeline_events where record_id = pg_temp.u(201)), 1::bigint,
  'sem o GUC a anotação volta a registrar na linha do tempo');

-- 6. Lembretes ignoram atividades legadas ---------------------------------------------------------------
select set_config('oxyn.importing', 'on', true);
insert into activities (id, company_id, owner_id, type_id, channel_id, subject, due_at, deal_id, reminder_minutes, legacy)
values (pg_temp.u(316), pg_temp.u(1), pg_temp.u(11),
  (select id from activity_types where company_id = pg_temp.u(1) and name = 'Ligação'),
  (select id from activity_channels where company_id = pg_temp.u(1) and is_legacy),
  'tst-ativ-legada-aberta', now() - interval '1 hour', pg_temp.u(201), 10, true);
select set_config('oxyn.importing', '', true);
select public.generate_activity_reminders();
select is((select count(*) from notifications where activity_id = pg_temp.u(316)), 0::bigint,
  'generate_activity_reminders ignora atividade legada');

-- 7. import_log_error ------------------------------------------------------------------------------------
select public.import_log_error(pg_temp.u(701), 'deals', n::text, 'tst-motivo-' || n) from generate_series(1, 1005) n;
select is((select jsonb_array_length(errors) from import_jobs where id = pg_temp.u(701)), 1000,
  'errors guarda no máximo 1000 itens');
select is((select (counters->'deals'->>'errors')::int from import_jobs where id = pg_temp.u(701)), 1005,
  'counters.deals.errors conta todos os erros');
select is((select errors->0 from import_jobs where id = pg_temp.u(701)),
  '{"entity":"deals","external_id":"1","reason":"tst-motivo-1"}'::jsonb, 'formato do item de erro');
select ok(not has_function_privilege('authenticated', 'public.import_log_error(uuid, text, text, text)', 'execute')
  and not has_function_privilege('anon', 'public.import_log_error(uuid, text, text, text)', 'execute'),
  'import_log_error é interna');
select ok((select prosecdef from pg_proc where oid = 'public.import_log_error(uuid, text, text, text)'::regprocedure),
  'import_log_error é security definer');

select * from finish();
rollback;
