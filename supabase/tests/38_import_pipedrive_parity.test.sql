begin;
select plan(9);

create function pg_temp.u(n int) returns uuid language sql immutable as $$
  select ('00000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
create function pg_temp.imp(p_entity text, p_rows jsonb) returns jsonb language sql as $$
  select public.import_upsert(pg_temp.u(701), p_entity, p_rows) $$;
create function pg_temp.rec(p_entity text, p_ext text) returns uuid language sql as $$
  select record_id from public.external_ids
  where source = 'pipedrive' and entity = p_entity and external_id = p_ext and company_id = pg_temp.u(1) $$;

insert into companies (id, name, slug) values (pg_temp.u(1), 'Paridade Imp', 'tst-parimp');
insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data) values
  (pg_temp.u(11), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tst-parimp@oxyn.test', '{"full_name":"x"}');
update profiles set is_super_admin = true where id = pg_temp.u(11);
insert into roles (id, name, description, permissions) values
  (pg_temp.u(21), 'tst-Gestor-parimp', 'teste', '{"visibility":{"leads":"company","deals":"company","persons":"company","organizations":"company","activities":"company"},"actions":{"create":true,"edit":true,"delete":true,"export":true,"reassign_owner":true},"settings":{"manage_pipelines":true,"manage_custom_fields":true,"manage_products":true,"view_reports":true,"create_dashboards":true,"share_dashboards":true}}'::jsonb);
insert into memberships (user_id, company_id, role_id) values (pg_temp.u(11), pg_temp.u(1), pg_temp.u(21));
insert into pipelines (id, company_id, name) values (pg_temp.u(401), pg_temp.u(1), 'tst-funil');
insert into stages (id, pipeline_id, company_id, name, position) values (pg_temp.u(501), pg_temp.u(401), pg_temp.u(1), 'tst-e1', 0);
insert into import_jobs (id, source, status, created_by) values (pg_temp.u(701), 'pipedrive', 'running', pg_temp.u(11));

-- negócio com canal de origem
select pg_temp.imp('deals', jsonb_build_array(jsonb_build_object('external_id', 'd1', 'company_id', pg_temp.u(1),
  'owner_id', pg_temp.u(11), 'pipeline_id', pg_temp.u(401), 'stage_id', pg_temp.u(501), 'title', 'tst-neg',
  'source_name', 'Jitterbit')));
select is((select s.name from deals d join lead_sources s on s.id = d.source_id where d.id = pg_temp.rec('deals', 'd1')),
  'Jitterbit', 'negócio importado ganha o canal (criado em lead_sources)');
select pg_temp.imp('deals', jsonb_build_array(jsonb_build_object('external_id', 'd1', 'company_id', pg_temp.u(1),
  'owner_id', pg_temp.u(11), 'pipeline_id', pg_temp.u(401), 'stage_id', pg_temp.u(501), 'title', 'tst-neg',
  'source_name', null)));
select is((select source_id from deals where id = pg_temp.rec('deals', 'd1')), null, 'sem canal na origem limpa o canal');

-- atividades
create function pg_temp.act(p_ext text, p_type text, p_channel text, p_done boolean, p_mo text, p_out text) returns jsonb
language sql as $$
  select pg_temp.imp('activities', jsonb_build_array(jsonb_build_object('external_id', p_ext, 'company_id', pg_temp.u(1),
    'owner_id', pg_temp.u(11), 'type', p_type, 'channel_name', p_channel, 'subject', 'tst', 'due_at', now(),
    'done', p_done, 'completed_at', case when p_done then now() end, 'meeting_outcome', p_mo, 'outcome_name', p_out,
    'deal_external_id', 'd1'))) $$;
select pg_temp.act('a1', 'task', 'WhatsApp', true, null, 'Reunião agendada');
select is((select o.name from activities a join activity_outcomes o on o.id = a.outcome_id where a.id = pg_temp.rec('activities', 'a1')),
  'Reunião agendada', 'tentativa concluída usa o resultado pelo nome');
select pg_temp.act('a2', 'task', 'WhatsApp', true, null, 'Nome desconhecido');
select is((select o.name from activities a join activity_outcomes o on o.id = a.outcome_id where a.id = pg_temp.rec('activities', 'a2')),
  'Importado', 'resultado desconhecido cai em Importado');
select pg_temp.act('a3', 'meeting', null, true, 'held', 'Concluída qualificada');
select is((select a.meeting_outcome || ':' || o.name from activities a join activity_outcomes o on o.id = a.outcome_id
  where a.id = pg_temp.rec('activities', 'a3')), 'held:Concluída qualificada', 'reunião realizada grava a qualificação');
select pg_temp.act('a4', 'meeting', null, true, 'no_show', 'Concluída qualificada');
select is((select meeting_outcome || ':' || coalesce(outcome_id::text, 'sem') from activities where id = pg_temp.rec('activities', 'a4')),
  'no_show:sem', 'no_show não leva qualificação');
select pg_temp.act('a5', 'task', 'WhatsApp', true, null, 'Concluída qualificada');
select is((select o.name from activities a join activity_outcomes o on o.id = a.outcome_id where a.id = pg_temp.rec('activities', 'a5')),
  'Importado', 'tentativa não pega resultado de reunião');

-- reimportação corrige o canal de atividade já concluída
select pg_temp.act('a6', 'task', null, true, null, 'Sem resposta');
select is((select c.name from activities a join activity_channels c on c.id = a.channel_id where a.id = pg_temp.rec('activities', 'a6')),
  'Não informado', 'sem canal vai para o legado');
select pg_temp.act('a6', 'task', 'Telefone', true, null, 'Sem resposta');
select is((select c.name from activities a join activity_channels c on c.id = a.channel_id where a.id = pg_temp.rec('activities', 'a6')),
  'Telefone', 'reimportação troca o canal da atividade concluída');

select * from finish();
rollback;
