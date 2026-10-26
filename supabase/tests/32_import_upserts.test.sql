begin;
select plan(66);

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
-- chama import_upsert no job em execução
create function pg_temp.imp(p_entity text, p_rows jsonb) returns jsonb language sql as $$
  select public.import_upsert(pg_temp.u(701), p_entity, p_rows) $$;
-- id do registro importado
create function pg_temp.rec(p_entity text, p_ext text, p_company int default 1) returns uuid language sql as $$
  select record_id from public.external_ids
  where source = 'pipedrive' and entity = p_entity and external_id = p_ext and company_id = pg_temp.u(p_company) $$;
create function pg_temp.res(c int, u int, s int, n int, e int) returns jsonb language sql immutable as $$
  select jsonb_build_object('created', c, 'updated', u, 'skipped', s, 'unchanged', n, 'errors', e) $$;
grant execute on function pg_temp.u(int), pg_temp.as_user(uuid), pg_temp.as_pg() to public;

-- Fixture: duas empresas, um funil com 2 etapas, dois usuários e um job em execução --------------------
insert into companies (id, name, slug) values
  (pg_temp.u(1), 'Volt Teste', 'tst-volt'), (pg_temp.u(2), 'Ohm Teste', 'tst-ohm');
insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data)
select pg_temp.u(n), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tst-ups' || n || '@oxyn.test', '{"full_name":"x"}'
from unnest(array[11, 12, 18]) n;
update profiles set is_super_admin = true where id = pg_temp.u(18);
insert into roles (id, name, description, permissions) values
  (pg_temp.u(21), 'tst-Gestor', 'teste', '{"visibility":{"leads":"company","deals":"company","persons":"company","organizations":"company","activities":"company"},"actions":{"create":true,"edit":true,"delete":true,"export":true,"reassign_owner":true},"settings":{"manage_pipelines":true,"manage_custom_fields":true,"manage_products":true,"view_reports":true,"create_dashboards":true,"share_dashboards":true}}'::jsonb);
insert into memberships (user_id, company_id, role_id) values
  (pg_temp.u(11), pg_temp.u(1), pg_temp.u(21)), (pg_temp.u(12), pg_temp.u(1), pg_temp.u(21)),
  (pg_temp.u(11), pg_temp.u(2), pg_temp.u(21));
insert into pipelines (id, company_id, name) values (pg_temp.u(401), pg_temp.u(1), 'tst-funil');
insert into stages (id, pipeline_id, company_id, name, position) values
  (pg_temp.u(501), pg_temp.u(401), pg_temp.u(1), 'tst-e1', 0), (pg_temp.u(502), pg_temp.u(401), pg_temp.u(1), 'tst-e2', 1);
insert into custom_field_defs (company_id, entity, key, label, type) values
  (pg_temp.u(1), 'persons', 'linkedin', 'Linkedin', 'text');
insert into import_jobs (id, source, status, created_by) values
  (pg_temp.u(701), 'pipedrive', 'running', pg_temp.u(18)),
  (pg_temp.u(702), 'pipedrive', 'draft', pg_temp.u(18));

-- 1. Acesso e pré-condições ----------------------------------------------------------------------
select pg_temp.as_user(pg_temp.u(18));
select throws_ok($$ select public.import_upsert(pg_temp.u(701), 'organizations', '[]') $$, '42501', null,
  'authenticated (mesmo admin geral) não executa import_upsert');
select throws_ok($$ select public.import_rebuild_deal_derivatives(pg_temp.u(701)) $$, '42501', null,
  'authenticated não executa import_rebuild_deal_derivatives');
select pg_temp.as_pg();
select ok(has_function_privilege('service_role', 'public.import_upsert(uuid, text, jsonb)', 'execute'),
  'service_role executa import_upsert');
select throws_ok($$ select public.import_upsert(pg_temp.u(702), 'organizations', '[]') $$, 'P0001',
  'OXYN_IMPORT_NOT_RUNNING', 'job fora de running é recusado');
select throws_ok($$ select pg_temp.imp('widgets', '[]') $$, 'P0001', 'OXYN_IMPORT_INVALID_ENTITY',
  'entidade desconhecida é recusada');

-- 2. Organizações ---------------------------------------------------------------------------------
select is(pg_temp.imp('organizations', '[
  {"external_id": "o1", "company_id": "00000000-0000-4000-8000-000000000001", "owner_id": "00000000-0000-4000-8000-000000000011",
   "name": "tst-Org Um", "address": "Rua A, 10", "created_at": "2023-05-01T10:00:00Z"}]'),
  pg_temp.res(1, 0, 0, 0, 0), 'organização criada');
select ok((select name = 'tst-Org Um' and created_at = '2023-05-01T10:00:00Z' and address->>'street' = 'Rua A, 10'
  from organizations where id = pg_temp.rec('organizations', 'o1')), 'organização com nome, endereço e created_at da origem');
select ok((select e.record_updated_at = o.updated_at and e.job_id = pg_temp.u(701)
  from external_ids e join organizations o on o.id = e.record_id
  where e.entity = 'organizations' and e.external_id = 'o1'), 'external_ids guarda record_updated_at e job');

-- 3. Pessoas: vínculo, contatos, duas empresas, campos personalizados -----------------------------------
select is(pg_temp.imp('persons', '[
  {"external_id": "p1", "company_id": "00000000-0000-4000-8000-000000000001", "owner_id": "00000000-0000-4000-8000-000000000011",
   "name": "tst-Ana", "emails": [{"value": "Ana@X.com", "label": "work"}, ""], "phones": ["(11) 99999-0000"],
   "organization_external_id": "o1", "custom_fields": {"linkedin": "in/ana"}, "created_at": "2023-05-02T10:00:00Z"},
  {"external_id": "p2", "company_id": "00000000-0000-4000-8000-000000000001", "owner_id": "00000000-0000-4000-8000-000000000012",
   "name": "tst-Bia", "emails": [], "phones": [], "custom_fields": {"inexistente": 1}, "created_at": "2023-05-02T10:00:00Z"}]'),
  pg_temp.res(2, 0, 0, 0, 0), 'pessoas criadas (campo personalizado inválido não derruba a linha)');
select ok((select organization_id = pg_temp.rec('organizations', 'o1') and full_name = 'tst-Ana'
  and emails = '[{"value": "ana@x.com", "label": "work"}]'::jsonb and phones->0->>'value' = '11999990000'
  and custom_fields = '{"linkedin": "in/ana"}'::jsonb
  from persons where id = pg_temp.rec('persons', 'p1')), 'pessoa com organização resolvida, contatos e campos');
select is((select custom_fields from persons where id = pg_temp.rec('persons', 'p2')), '{}'::jsonb,
  'campos personalizados inválidos são descartados');
select is((select (counters->'persons'->>'warnings')::int from import_jobs where id = pg_temp.u(701)), 1,
  'descarte de campos conta como aviso');
select ok((select counters->'persons'->'errors' is null from import_jobs where id = pg_temp.u(701)),
  'aviso não conta como erro');
select ok((select errors @> '[{"entity": "persons", "external_id": "p2"}]' and (errors->-1->>'reason') like 'aviso:%'
  from import_jobs where id = pg_temp.u(701)), 'aviso vai para o log com o prefixo aviso:');
select is(pg_temp.imp('persons', '[
  {"external_id": "p1", "company_id": "00000000-0000-4000-8000-000000000002", "owner_id": "00000000-0000-4000-8000-000000000011",
   "name": "tst-Ana", "organization_external_id": "o1", "created_at": "2023-05-02T10:00:00Z"}]'),
  pg_temp.res(1, 0, 0, 0, 0), 'mesma pessoa na segunda empresa é criada');
select is((select count(*) from external_ids where entity = 'persons' and external_id = 'p1'), 2::bigint,
  'pessoa em duas empresas: duas linhas em external_ids');
select ok(pg_temp.rec('persons', 'p1', 1) <> pg_temp.rec('persons', 'p1', 2), 'pessoa em duas empresas: dois registros');
select is((select organization_id from persons where id = pg_temp.rec('persons', 'p1', 2)), null::uuid,
  'vínculo com organização de outra empresa não é resolvido');
select is(pg_temp.imp('persons', '[
  {"external_id": "p1", "company_id": "00000000-0000-4000-8000-000000000001", "owner_id": "00000000-0000-4000-8000-000000000011",
   "name": "tst-Ana", "emails": [{"value": "Ana@X.com", "label": "work"}, ""], "phones": ["(11) 99999-0000"],
   "organization_external_id": "o1", "custom_fields": {"linkedin": "in/ana"}, "created_at": "2023-05-02T10:00:00Z"}]'),
  pg_temp.res(0, 0, 0, 1, 0), 'reimportação idêntica: nada criado nem alterado');
select is((select count(*) from persons where company_id = pg_temp.u(1) and full_name = 'tst-Ana'), 1::bigint,
  'reimportação idêntica não duplica');

-- 4. Leads: origem, etiquetas ---------------------------------------------------------------------------
select is(pg_temp.imp('leads', '[
  {"external_id": "l1", "company_id": "00000000-0000-4000-8000-000000000001", "owner_id": "00000000-0000-4000-8000-000000000011",
   "title": "tst-Lead Um", "value": 1500, "person_external_id": "p1", "organization_external_id": "o1",
   "source_name": "indicacao", "labels": ["Hot", "OXYN"], "status": "open", "created_at": "2023-06-01T10:00:00Z"},
  {"external_id": "l2", "company_id": "00000000-0000-4000-8000-000000000001", "owner_id": "00000000-0000-4000-8000-000000000011",
   "title": "tst-Lead Dois", "person_external_id": "inexistente", "labels": ["hot"], "status": "archived",
   "created_at": "2023-06-02T10:00:00Z"}]'),
  pg_temp.res(2, 0, 0, 0, 0), 'leads criados');
select ok((select person_id = pg_temp.rec('persons', 'p1') and organization_id = pg_temp.rec('organizations', 'o1')
  and estimated_value = 1500 and status = 'open'
  and source_id = (select id from lead_sources where company_id = pg_temp.u(1) and name = 'Indicação')
  from leads where id = pg_temp.rec('leads', 'l1')), 'lead com vínculos e origem casada sem acento');
select is((select count(*) from record_labels where entity = 'leads' and record_id = pg_temp.rec('leads', 'l1')), 2::bigint,
  'lead com duas etiquetas');
select is((select count(*) from labels where company_id = pg_temp.u(1) and lower(name) = 'hot'), 1::bigint,
  'etiqueta reaproveitada pelo nome');
select ok((select status = 'archived' and person_id is null from leads where id = pg_temp.rec('leads', 'l2')),
  'lead arquivado; vínculo opcional ausente é descartado');

-- 5. Negócios ---------------------------------------------------------------------------------------------
select is(pg_temp.imp('deals', '[
  {"external_id": "d1", "company_id": "00000000-0000-4000-8000-000000000001", "owner_id": "00000000-0000-4000-8000-000000000011",
   "pipeline_id": "00000000-0000-4000-8000-000000000401", "stage_id": "00000000-0000-4000-8000-000000000502",
   "title": "tst-Neg Ganho", "status": "won", "value": 20000, "setup_total": 1000, "mrr": 500, "contract_months": 12,
   "won_at": "2024-03-10T12:00:00Z", "stage_entered_at": "2024-02-01T12:00:00Z", "person_external_id": "p1",
   "organization_external_id": "o1", "lead_external_id": "l1", "created_at": "2024-01-05T12:00:00Z"},
  {"external_id": "d2", "company_id": "00000000-0000-4000-8000-000000000001", "owner_id": "00000000-0000-4000-8000-000000000011",
   "pipeline_id": "00000000-0000-4000-8000-000000000401", "stage_id": "00000000-0000-4000-8000-000000000501",
   "title": "tst-Neg Perdido", "status": "lost", "lost_at": "2024-04-11T12:00:00Z", "created_at": "2024-01-06T12:00:00Z"},
  {"external_id": "d3", "company_id": "00000000-0000-4000-8000-000000000001", "owner_id": "00000000-0000-4000-8000-000000000011",
   "pipeline_id": "00000000-0000-4000-8000-000000000401", "stage_id": "00000000-0000-4000-8000-000000000501",
   "title": "tst-Neg Preço", "status": "lost", "lost_reason": "preco", "lost_at": "2024-04-12T12:00:00Z",
   "created_at": "2024-01-07T12:00:00Z"},
  {"external_id": "d4", "company_id": "00000000-0000-4000-8000-000000000001", "owner_id": "00000000-0000-4000-8000-000000000012",
   "pipeline_id": "00000000-0000-4000-8000-000000000401", "stage_id": "00000000-0000-4000-8000-000000000501",
   "title": "tst-Neg Aberto", "status": "open", "mrr": 300, "created_at": "2024-01-08T12:00:00Z"}]'),
  pg_temp.res(4, 0, 0, 0, 0), 'negócios criados (contrato inválido não derruba a linha)');
select ok((select status = 'won' and won_at = '2024-03-10T12:00:00Z' and created_at = '2024-01-05T12:00:00Z'
  and stage_entered_at = '2024-02-01T12:00:00Z' and estimated_value = 20000
  and person_id = pg_temp.rec('persons', 'p1') and organization_id = pg_temp.rec('organizations', 'o1')
  and lead_id = pg_temp.rec('leads', 'l1')
  from deals where id = pg_temp.rec('deals', 'd1')), 'negócio ganho com datas históricas e vínculos');
select ok((select mrr = 500 and contract_months = 12 and mrr_start = '2024-03-01' and setup_total = 1000
  and setup_first_due = '2024-03-01' from deals where id = pg_temp.rec('deals', 'd1')),
  'contrato válido: início no mês do ganho');
select ok((select status = 'converted' and converted_deal_id = pg_temp.rec('deals', 'd1')
  and converted_at = '2024-01-05T12:00:00Z' from leads where id = pg_temp.rec('leads', 'l1')),
  'lead do negócio vira convertido e ligado');
select is((select r.name from deals d join lost_reasons r on r.id = d.lost_reason_id where d.id = pg_temp.rec('deals', 'd2')),
  'Importado sem motivo', 'perdido sem motivo recebe "Importado sem motivo"');
select ok((select lost_at = '2024-04-11T12:00:00Z' from deals where id = pg_temp.rec('deals', 'd2')), 'lost_at preservado');
select is((select r.name from deals d join lost_reasons r on r.id = d.lost_reason_id where d.id = pg_temp.rec('deals', 'd3')),
  'Preço', 'motivo de perda casado pelo nome');
select is((select mrr from deals where id = pg_temp.rec('deals', 'd4')), 0::numeric, 'MRR sem prazo é gravado como 0');
select is((select (counters->'deals'->>'warnings')::int from import_jobs where id = pg_temp.u(701)), 1,
  'contrato inválido conta como aviso');
select is((select count(*) from deal_stage_history where deal_id = pg_temp.rec('deals', 'd1')), 0::bigint,
  'antes da reconstrução não há histórico de etapas');

select is(public.import_rebuild_deal_derivatives(pg_temp.u(701)), 4, 'reconstrução percorre os negócios do job');
select is((select count(*) from deal_stage_history where deal_id = pg_temp.rec('deals', 'd1')), 1::bigint,
  'negócio ganho com uma linha de histórico');
select ok((select from_stage_id is null and to_stage_id = pg_temp.u(502) and moved_at = '2024-02-01T12:00:00Z'
  from deal_stage_history where deal_id = pg_temp.rec('deals', 'd1')), 'histórico inicial na data de entrada da etapa');
select is((select count(*) from deal_revenue_schedule where deal_id = pg_temp.rec('deals', 'd1')), 12::bigint,
  'cronograma de receita gerado');
select is((select sum(setup) + sum(mrr) from deal_revenue_schedule where deal_id = pg_temp.rec('deals', 'd1')), 7000::numeric,
  'cronograma soma setup e MRR');
select is(public.import_rebuild_deal_derivatives(pg_temp.u(701)), 4, 'reconstrução é idempotente');
select is((select count(*) from deal_stage_history where deal_id = pg_temp.rec('deals', 'd1')), 1::bigint,
  'segunda reconstrução não duplica o histórico');

-- 6. Atividades ----------------------------------------------------------------------------------------------
select is(pg_temp.imp('activities', '[
  {"external_id": "a1", "company_id": "00000000-0000-4000-8000-000000000001", "owner_id": "00000000-0000-4000-8000-000000000011",
   "type": "task", "channel_name": "whatsapp", "subject": "tst-Mensagem", "due_at": "2024-02-02T12:00:00Z",
   "done": true, "completed_at": "2024-02-02T13:00:00Z", "deal_external_id": "d1", "created_at": "2024-02-01T12:00:00Z"},
  {"external_id": "a2", "company_id": "00000000-0000-4000-8000-000000000001", "owner_id": "00000000-0000-4000-8000-000000000011",
   "type": "meeting", "channel_name": null, "subject": "tst-Reunião", "due_at": "2024-02-03T12:00:00Z",
   "done": true, "completed_at": "2024-02-03T13:00:00Z", "person_external_id": "p1", "note": "pauta",
   "created_at": "2024-02-01T12:00:00Z"},
  {"external_id": "a3", "company_id": "00000000-0000-4000-8000-000000000001", "owner_id": "00000000-0000-4000-8000-000000000011",
   "type": "task", "channel_name": "E-mail", "subject": "tst-Órfã", "due_at": "2024-02-04T12:00:00Z",
   "done": false, "deal_external_id": "inexistente", "created_at": "2024-02-01T12:00:00Z"},
  {"external_id": "a4", "company_id": "00000000-0000-4000-8000-000000000001", "owner_id": "00000000-0000-4000-8000-000000000012",
   "type": "task", "channel_name": "Canal Desconhecido", "subject": "tst-Pendente", "due_at": "2024-02-05T12:00:00Z",
   "done": false, "lead_external_id": "l2", "created_at": "2024-02-01T12:00:00Z"}]'),
  pg_temp.res(3, 0, 0, 0, 1), 'atividades: sem vínculo vira erro de linha e o lote segue');
select ok((select a.legacy and a.done and a.completed_at = '2024-02-02T13:00:00Z' and a.deal_id = pg_temp.rec('deals', 'd1')
  and t.name = 'Tarefa' and c.name = 'WhatsApp' and o.name = 'Importado' and a.meeting_outcome is null
  from activities a join activity_types t on t.id = a.type_id join activity_channels c on c.id = a.channel_id
  join activity_outcomes o on o.id = a.outcome_id where a.id = pg_temp.rec('activities', 'a1')),
  'tarefa concluída sem resultado recebe "Importado", legado, canal casado sem caixa');
select ok((select classification = 'neutral' and not active from activity_outcomes
  where company_id = pg_temp.u(1) and name = 'Importado'), 'resultado "Importado" é neutro e inativo');
select ok((select a.legacy and t.is_meeting and a.meeting_outcome = 'held' and a.outcome_id is null and c.is_legacy
  and a.description = 'pauta'
  from activities a join activity_types t on t.id = a.type_id join activity_channels c on c.id = a.channel_id
  where a.id = pg_temp.rec('activities', 'a2')), 'reunião concluída sem resultado vira held, canal nulo vai para o legado');
select ok((select not a.done and a.outcome_id is null and c.is_legacy and a.lead_id = pg_temp.rec('leads', 'l2')
  from activities a join activity_channels c on c.id = a.channel_id where a.id = pg_temp.rec('activities', 'a4')),
  'canal desconhecido vai para o legado');
select is(pg_temp.rec('activities', 'a3'), null::uuid, 'atividade sem vínculo não é criada');
select ok((select (counters->'activities'->>'errors')::int = 1 and (counters->'activities'->>'warnings')::int = 1
  and errors @> '[{"entity": "activities", "external_id": "a3"}]'
  from import_jobs where id = pg_temp.u(701)), 'erro da linha e aviso de held registrados no job');

select ok((select errors @> '[{"entity": "activities", "external_id": "a3"}]'
  and exists (select 1 from jsonb_array_elements(errors) e
              where e->>'external_id' = 'a3' and e->>'reason' like 'OXYN_IMPORT_NO_LINK: %')
  from import_jobs where id = pg_temp.u(701)), 'motivo do erro traz o código e o detalhe');
select is(pg_temp.imp('activities', '[
  {"external_id": "a1", "company_id": "00000000-0000-4000-8000-000000000001", "owner_id": "00000000-0000-4000-8000-000000000011",
   "type": "meeting", "channel_name": "Telefone", "subject": "tst-Mensagem 2", "due_at": "2024-02-02T12:00:00Z",
   "done": true, "completed_at": "2024-02-02T13:00:00Z", "meeting_outcome": "no_show", "deal_external_id": "d1",
   "created_at": "2024-02-01T12:00:00Z"}]'),
  pg_temp.res(0, 1, 0, 0, 0), 'atividade concluída reimportada é atualizada');
select ok((select a.subject = 'tst-Mensagem 2' and t.name = 'Tarefa' and c.name = 'WhatsApp'
  and a.outcome_id is not null and a.meeting_outcome is null
  from activities a join activity_types t on t.id = a.type_id join activity_channels c on c.id = a.channel_id
  where a.id = pg_temp.rec('activities', 'a1')), 'concluída mantém tipo e canal, e o resultado segue o tipo gravado');

-- 7. Anotações e produtos -------------------------------------------------------------------------------------
select is(pg_temp.imp('notes', '[
  {"external_id": "n1", "company_id": "00000000-0000-4000-8000-000000000001", "entity": "deals", "record_external_id": "d1",
   "content": "tst-nota", "author_id": "00000000-0000-4000-8000-000000000012", "created_at": "2024-02-10T12:00:00Z"}]'),
  pg_temp.res(1, 0, 0, 0, 0), 'anotação criada');
select ok((select entity = 'deals' and record_id = pg_temp.rec('deals', 'd1') and created_by = pg_temp.u(12)
  and body = 'tst-nota' and created_at = '2024-02-10T12:00:00Z' from notes where id = pg_temp.rec('notes', 'n1')),
  'anotação ligada ao negócio com o autor');
select is(pg_temp.imp('products', '[
  {"external_id": "pr1", "company_id": "00000000-0000-4000-8000-000000000001", "name": "tst-Produto", "kind": "recurring", "price": 99.5}]'),
  pg_temp.res(1, 0, 0, 0, 0), 'produto criado');
select ok((select kind = 'recurring' and default_price = 99.5 from products where id = pg_temp.rec('products', 'pr1')),
  'produto com tipo e preço');

-- 8. Nenhum evento de linha do tempo -----------------------------------------------------------------------------
select is((select count(*) from timeline_events where company_id in (pg_temp.u(1), pg_temp.u(2))), 0::bigint,
  'importação não gera timeline_events');

-- 9. Reimportação -------------------------------------------------------------------------------------------------
select is(pg_temp.imp('deals', '[
  {"external_id": "d1", "company_id": "00000000-0000-4000-8000-000000000001", "owner_id": "00000000-0000-4000-8000-000000000011",
   "pipeline_id": "00000000-0000-4000-8000-000000000401", "stage_id": "00000000-0000-4000-8000-000000000502",
   "title": "tst-Neg Ganho", "status": "won", "value": 20000, "setup_total": 1000, "mrr": 500, "contract_months": 12,
   "won_at": "2024-03-10T12:00:00Z", "stage_entered_at": "2024-02-01T12:00:00Z", "person_external_id": "p1",
   "organization_external_id": "o1", "lead_external_id": "l1", "created_at": "2024-01-05T12:00:00Z"}]'),
  pg_temp.res(0, 0, 0, 1, 0), 'reimportação idêntica do negócio');
select is((select count(*) from deals where company_id = pg_temp.u(1) and title = 'tst-Neg Ganho'), 1::bigint,
  'negócio não duplica');
select is(pg_temp.imp('leads', '[
  {"external_id": "l1", "company_id": "00000000-0000-4000-8000-000000000001", "owner_id": "00000000-0000-4000-8000-000000000011",
   "title": "tst-Lead Um", "value": 1500, "person_external_id": "p1", "organization_external_id": "o1",
   "source_name": "indicacao", "labels": ["Hot", "OXYN"], "status": "open", "created_at": "2023-06-01T10:00:00Z"}]'),
  pg_temp.res(0, 0, 0, 1, 0), 'lead convertido pela importação segue atualizável (não conta como edição no CRM)');
select is((select status from leads where id = pg_temp.rec('leads', 'l1')), 'converted', 'reimportação não desfaz a conversão');
select is(pg_temp.imp('organizations', '[
  {"external_id": "o1", "company_id": "00000000-0000-4000-8000-000000000001", "owner_id": "00000000-0000-4000-8000-000000000011",
   "name": "tst-Org Renomeada", "address": "Rua A, 10", "created_at": "2023-05-01T10:00:00Z"}]'),
  pg_temp.res(0, 1, 0, 0, 0), 'reimportação com nome alterado atualiza');
select is((select name from organizations where id = pg_temp.rec('organizations', 'o1')), 'tst-Org Renomeada', 'nome atualizado');

-- edição no CRM: a mesma transação tem now() fixo, então recua o carimbo da importação para simular a edição posterior
select set_config('oxyn.importing', '', true);
update organizations set name = 'tst-Org CRM' where id = pg_temp.rec('organizations', 'o1');
update external_ids set record_updated_at = record_updated_at - interval '1 second'
  where entity = 'organizations' and external_id = 'o1';
select is(pg_temp.imp('organizations', '[
  {"external_id": "o1", "company_id": "00000000-0000-4000-8000-000000000001", "owner_id": "00000000-0000-4000-8000-000000000011",
   "name": "tst-Org Pipedrive", "address": "Rua A, 10", "created_at": "2023-05-01T10:00:00Z"}]'),
  pg_temp.res(0, 0, 1, 0, 0), 'registro editado no CRM é pulado');
select is((select name from organizations where id = pg_temp.rec('organizations', 'o1')), 'tst-Org CRM',
  'título do CRM preservado');
select is(current_setting('oxyn.importing', true), '', 'import_upsert limpa o desvio ao terminar');

select * from finish();
rollback;
