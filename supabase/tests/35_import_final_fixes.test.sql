begin;
select plan(16);

create function pg_temp.u(n int) returns uuid language sql immutable as $$
  select ('00000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
create function pg_temp.imp(p_entity text, p_rows jsonb) returns jsonb language sql as $$
  select public.import_upsert(pg_temp.u(701), p_entity, p_rows) $$;
create function pg_temp.rec(p_entity text, p_ext text) returns uuid language sql as $$
  select record_id from public.external_ids
  where source = 'pipedrive' and entity = p_entity and external_id = p_ext and company_id = pg_temp.u(1) $$;
create function pg_temp.res(c int, u int, s int, n int, e int) returns jsonb language sql immutable as $$
  select jsonb_build_object('created', c, 'updated', u, 'skipped', s, 'unchanged', n, 'errors', e) $$;
grant execute on function pg_temp.u(int) to public;

-- Fixture: uma empresa, um funil com 2 etapas, um usuário membro e um job em execução --------------------------
insert into companies (id, name, slug) values (pg_temp.u(1), 'Volt Teste', 'tst-volt');
insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data)
values (pg_temp.u(11), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tst-fin11@oxyn.test',
  '{"full_name":"x"}');
insert into roles (id, name, description, permissions) values
  (pg_temp.u(21), 'tst-Gestor', 'teste', '{"visibility":{"leads":"company","deals":"company","persons":"company","organizations":"company","activities":"company"},"actions":{"create":true,"edit":true,"delete":true,"export":true,"reassign_owner":true},"settings":{"manage_pipelines":true,"manage_custom_fields":true,"manage_products":true,"view_reports":true,"create_dashboards":true,"share_dashboards":true}}'::jsonb);
insert into memberships (user_id, company_id, role_id) values (pg_temp.u(11), pg_temp.u(1), pg_temp.u(21));
insert into pipelines (id, company_id, name) values (pg_temp.u(401), pg_temp.u(1), 'tst-funil');
insert into stages (id, pipeline_id, company_id, name, position) values
  (pg_temp.u(501), pg_temp.u(401), pg_temp.u(1), 'tst-e1', 0), (pg_temp.u(502), pg_temp.u(401), pg_temp.u(1), 'tst-e2', 1);
insert into custom_field_defs (company_id, entity, key, label, type, options) values
  (pg_temp.u(1), 'persons', 'linkedin', 'Linkedin', 'text', '[]'),
  (pg_temp.u(1), 'persons', 'canal', 'Canal', 'select', '["Site", "Evento"]');
insert into import_jobs (id, source, status, created_by) values (pg_temp.u(701), 'pipedrive', 'running', pg_temp.u(11));


-- 1. Campos personalizados: só as chaves inválidas saem, com um aviso por chave ---------------------------------------
select is(pg_temp.imp('persons', '[
  {"external_id": "p1", "company_id": "00000000-0000-4000-8000-000000000001", "owner_id": "00000000-0000-4000-8000-000000000011",
   "name": "tst-Ana", "custom_fields": {"linkedin": "in/ana", "canal": "Feira", "inexistente": 1}}]'),
  pg_temp.res(1, 0, 0, 0, 0), 'pessoa criada com campos parcialmente inválidos');
select is((select custom_fields from persons where id = pg_temp.rec('persons', 'p1')), '{"linkedin": "in/ana"}'::jsonb,
  'só as chaves inválidas são descartadas');
select is((select count(*)::int from import_jobs, jsonb_array_elements(warnings) w
  where id = pg_temp.u(701) and w->>'external_id' = 'p1'), 2, 'um aviso por chave descartada');
select ok((select bool_and(w->>'reason' like 'aviso: campo personalizado % descartado%')
    and bool_or(w->>'reason' like '%campo personalizado canal %') and bool_or(w->>'reason' like '%campo personalizado inexistente %')
  from import_jobs, jsonb_array_elements(warnings) w where id = pg_temp.u(701) and w->>'external_id' = 'p1'),
  'cada aviso nomeia a chave descartada');
select is(pg_temp.imp('persons', '[
  {"external_id": "p2", "company_id": "00000000-0000-4000-8000-000000000001", "owner_id": "00000000-0000-4000-8000-000000000011",
   "name": "tst-Bia", "custom_fields": {"linkedin": "in/bia", "canal": "Site"}}]'),
  pg_temp.res(1, 0, 0, 0, 0), 'pessoa com campos válidos criada');
select ok((select custom_fields = '{"linkedin": "in/bia", "canal": "Site"}'::jsonb from persons where id = pg_temp.rec('persons', 'p2'))
  and not exists (select 1 from import_jobs, jsonb_array_elements(warnings) w
                  where id = pg_temp.u(701) and w->>'external_id' = 'p2'),
  'campos válidos ficam todos e sem aviso');
select is(pg_temp.imp('persons', '[
  {"external_id": "p3", "company_id": "00000000-0000-4000-8000-000000000001", "owner_id": "00000000-0000-4000-8000-000000000011",
   "name": "tst-Caio", "custom_fields": ["x"]}]'), pg_temp.res(1, 0, 0, 0, 0), 'campos fora de objeto não derrubam a linha');
select ok((select custom_fields = '{}'::jsonb from persons where id = pg_temp.rec('persons', 'p3'))
  and exists (select 1 from import_jobs, jsonb_array_elements(warnings) w
              where id = pg_temp.u(701) and w->>'external_id' = 'p3'), 'campos fora de objeto viram aviso');

-- 2. Negócios: won_at gravado vale na atualização; seconds_in_previous não fica negativo ------------------------------
select is(pg_temp.imp('deals', '[
  {"external_id": "d1", "company_id": "00000000-0000-4000-8000-000000000001", "owner_id": "00000000-0000-4000-8000-000000000011",
   "pipeline_id": "00000000-0000-4000-8000-000000000401", "stage_id": "00000000-0000-4000-8000-000000000501",
   "title": "tst-Neg", "status": "won", "mrr": 100, "contract_months": 12, "won_at": "2024-02-10T12:00:00Z",
   "expected_close_date": "2024-06-15", "stage_entered_at": "2024-03-01T12:00:00Z", "created_at": "2024-01-05T12:00:00Z"}]'),
  pg_temp.res(1, 0, 0, 0, 0), 'negócio ganho criado');
select is(pg_temp.imp('deals', '[
  {"external_id": "d1", "company_id": "00000000-0000-4000-8000-000000000001", "owner_id": "00000000-0000-4000-8000-000000000011",
   "pipeline_id": "00000000-0000-4000-8000-000000000401", "stage_id": "00000000-0000-4000-8000-000000000502",
   "title": "tst-Neg 2", "status": "won", "mrr": 100, "contract_months": 12, "won_at": null,
   "expected_close_date": "2024-06-15", "stage_entered_at": "2024-01-01T12:00:00Z", "created_at": "2024-01-05T12:00:00Z"}]'),
  pg_temp.res(0, 1, 0, 0, 0), 'negócio reimportado sem won_at e com etapa de data anterior');
select ok((select won_at = '2024-02-10T12:00:00Z' and mrr_start = '2024-02-01' from deals where id = pg_temp.rec('deals', 'd1')),
  'sem won_at na origem, o contrato segue o won_at gravado (não a previsão de fechamento)');
select is((select seconds_in_previous from deal_stage_history
  where deal_id = pg_temp.rec('deals', 'd1') and to_stage_id = pg_temp.u(502)), 0,
  'entrada na etapa anterior à entrada gravada: seconds_in_previous = 0');

-- 3. Atividades: duração ----------------------------------------------------------------------------------------------
select is(pg_temp.imp('activities', '[
  {"external_id": "a1", "company_id": "00000000-0000-4000-8000-000000000001", "owner_id": "00000000-0000-4000-8000-000000000011",
   "type": "meeting", "subject": "tst-Reuniao", "due_at": "2024-01-10T15:00:00Z", "done": false, "deal_external_id": "d1",
   "duration_minutes": 90},
  {"external_id": "a2", "company_id": "00000000-0000-4000-8000-000000000001", "owner_id": "00000000-0000-4000-8000-000000000011",
   "type": "task", "subject": "tst-Tarefa", "due_at": "2024-01-10T15:00:00Z", "done": false, "deal_external_id": "d1"},
  {"external_id": "a3", "company_id": "00000000-0000-4000-8000-000000000001", "owner_id": "00000000-0000-4000-8000-000000000011",
   "type": "task", "subject": "tst-Longa", "due_at": "2024-01-10T15:00:00Z", "done": false, "deal_external_id": "d1",
   "duration_minutes": 5000}]'),
  pg_temp.res(3, 0, 0, 0, 0), 'atividades criadas');
select is((select duration_minutes from activities where id = pg_temp.rec('activities', 'a1')), 90, 'duração da origem é gravada');
select ok((select bool_and(duration_minutes = 30) from activities
  where id in (pg_temp.rec('activities', 'a2'), pg_temp.rec('activities', 'a3'))), 'sem duração ou fora da faixa: 30 minutos');
select is(pg_temp.imp('activities', '[
  {"external_id": "a1", "company_id": "00000000-0000-4000-8000-000000000001", "owner_id": "00000000-0000-4000-8000-000000000011",
   "type": "meeting", "subject": "tst-Reuniao", "due_at": "2024-01-10T15:00:00Z", "done": false, "deal_external_id": "d1",
   "duration_minutes": 45}]'), pg_temp.res(0, 1, 0, 0, 0), 'duração nova atualiza a atividade');

select * from finish();
rollback;
