begin;
select plan(25);

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

insert into companies (id, name, slug) values (pg_temp.u(1), 'Volt Teste', 'tst-volt'), (pg_temp.u(2), 'Naia Teste', 'tst-naia');
insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data) values
  (pg_temp.u(11), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tst-gestor@oxyn.test', '{"full_name":"gestor"}'),
  (pg_temp.u(12), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tst-fora@oxyn.test', '{"full_name":"fora"}'),
  (pg_temp.u(13), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tst-vend@oxyn.test', '{"full_name":"vend"}'),
  (pg_temp.u(14), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tst-editor@oxyn.test', '{"full_name":"editor"}');
insert into roles (id, name, description, permissions) values
  (pg_temp.u(21), 'tst-Gestor', 'teste', '{"visibility":{"leads":"company","deals":"company","persons":"company","organizations":"company","activities":"company"},"actions":{"create":true,"edit":true,"delete":true,"export":true,"reassign_owner":true},"settings":{"manage_pipelines":true,"manage_custom_fields":true,"manage_products":true,"view_reports":true,"create_dashboards":true,"share_dashboards":true}}'::jsonb),
  (pg_temp.u(22), 'tst-Vendedor', 'teste', '{"visibility":{"leads":"own","deals":"own","persons":"own","organizations":"own","activities":"own"},"actions":{"create":true,"edit":true,"delete":false,"export":false,"reassign_owner":false},"settings":{"manage_pipelines":false,"manage_custom_fields":false,"manage_products":false,"view_reports":true,"create_dashboards":true,"share_dashboards":false}}'::jsonb),
  (pg_temp.u(23), 'tst-Editor', 'teste', '{"visibility":{"leads":"company","deals":"company","persons":"company","organizations":"company","activities":"company"},"actions":{"create":true,"edit":true,"delete":false,"export":false,"reassign_owner":false},"settings":{"manage_pipelines":false,"manage_custom_fields":false,"manage_products":false,"view_reports":true,"create_dashboards":true,"share_dashboards":false}}'::jsonb);
insert into memberships (user_id, company_id, role_id) values
  (pg_temp.u(11), pg_temp.u(1), pg_temp.u(21)), (pg_temp.u(12), pg_temp.u(2), pg_temp.u(21)),
  (pg_temp.u(13), pg_temp.u(1), pg_temp.u(22)), (pg_temp.u(14), pg_temp.u(1), pg_temp.u(23));

insert into pipelines (id, company_id, name, next_activity_rule) values
  (pg_temp.u(401), pg_temp.u(1), 'tst-funil-require', 'require'),
  (pg_temp.u(402), pg_temp.u(1), 'tst-funil-off', 'off');
insert into stages (id, pipeline_id, company_id, name, position) values
  (pg_temp.u(501), pg_temp.u(401), pg_temp.u(1), 'tst-e1', 0), (pg_temp.u(502), pg_temp.u(402), pg_temp.u(1), 'tst-e2', 0);
insert into deals (id, company_id, owner_id, title, pipeline_id, stage_id, created_by) values
  (pg_temp.u(201), pg_temp.u(1), pg_temp.u(11), 'tst-neg-require', pg_temp.u(401), pg_temp.u(501), pg_temp.u(11)),
  (pg_temp.u(203), pg_temp.u(1), pg_temp.u(11), 'tst-neg-off', pg_temp.u(402), pg_temp.u(502), pg_temp.u(11));

create function pg_temp.mk(n int, tname text, ch text, p_owner uuid, p_deal uuid, p_rem int default null, p_due timestamptz default now())
returns void language plpgsql as $$
begin
  insert into activities (id, company_id, owner_id, created_by, type_id, channel_id, subject, due_at, deal_id, reminder_minutes)
  values (pg_temp.u(n), pg_temp.u(1), p_owner, p_owner,
    (select id from activity_types where company_id = pg_temp.u(1) and name = tname),
    (select id from activity_channels where company_id = pg_temp.u(1) and name = ch),
    'tst-ativ-' || n, p_due, p_deal, p_rem);
end $$;
create function pg_temp.oid(nm text) returns uuid language sql stable as $$
  select id from activity_outcomes where company_id = pg_temp.u(1) and name = nm $$;
create function pg_temp.nx(extra jsonb default '{}') returns jsonb language sql stable as $$
  select jsonb_build_object(
    'type_id', (select id from activity_types where company_id = pg_temp.u(1) and name = 'Ligação'),
    'channel_id', (select id from activity_channels where company_id = pg_temp.u(1) and name = 'Telefone'),
    'subject', 'tst-prox', 'due_at', now() + interval '1 day') || extra $$;
grant execute on function pg_temp.mk(int, text, text, uuid, uuid, int, timestamptz), pg_temp.oid(text), pg_temp.nx(jsonb) to public;

-- vendedor (own) é dono de atividade em negócio require que não lê
select pg_temp.mk(301, 'Tarefa', 'E-mail', pg_temp.u(13), pg_temp.u(201));
-- editor sem reassign conclui atividade do gestor
select pg_temp.mk(303, 'Tarefa', 'E-mail', pg_temp.u(11), pg_temp.u(203));
select pg_temp.mk(304, 'Tarefa', 'LinkedIn', pg_temp.u(11), pg_temp.u(203));
select pg_temp.mk(305, 'Tarefa', 'E-mail', pg_temp.u(11), pg_temp.u(203));
select pg_temp.mk(306, 'Tarefa', 'E-mail', pg_temp.u(11), pg_temp.u(203));
select pg_temp.mk(307, 'Tarefa', 'E-mail', pg_temp.u(11), pg_temp.u(203));
select pg_temp.mk(308, 'Tarefa', 'E-mail', pg_temp.u(11), pg_temp.u(203));

-- 1. regra não falha aberta -------------------------------------------------------------
select pg_temp.as_user(pg_temp.u(13));
select is((select count(*) from deals where id = pg_temp.u(201)), 0::bigint, 'vendedor não lê o negócio');
select throws_ok($$ select complete_activity(pg_temp.u(301), pg_temp.oid('Sem resposta')) $$, 'P0001', 'OXYN_NEXT_ACTIVITY_REQUIRED',
  'regra require vale mesmo sem ler o negócio');
select lives_ok($$ select complete_activity(pg_temp.u(301), pg_temp.oid('Sem resposta'), p_next => pg_temp.nx()) $$,
  'com p_next conclui mesmo sem ler o negócio (vínculo herdado)');
select ok((select a.owner_id = pg_temp.u(13) and a.deal_id = pg_temp.u(201) from (select * from activities where subject = 'tst-prox') a), 'próxima do vendedor herdou vínculo e dono');
select throws_ok($$ insert into activities (company_id, owner_id, type_id, channel_id, subject, due_at, deal_id)
  select company_id, owner_id, type_id, channel_id, 'x', now(), deal_id from activities where id = pg_temp.u(301) $$,
  'P0001', 'OXYN_LINK_FORBIDDEN', 'insert direto no negócio ilegível segue barrado');
select pg_temp.as_user(pg_temp.u(12));
select throws_ok($$ select activity_next_rule(pg_temp.u(301)) $$, 'P0001', 'OXYN_FORBIDDEN', 'activity_next_rule exige poder editar');

-- 2. cadeia por editor sem reassign -------------------------------------------------------------
select pg_temp.as_user(pg_temp.u(14));
select lives_ok($$ select complete_activity(pg_temp.u(303), pg_temp.oid('Sem resposta'), p_next => pg_temp.nx()) $$, 'editor sem reassign conclui com p_next');
select is((select owner_id from activities where subject = 'tst-prox' and deal_id = pg_temp.u(203)), pg_temp.u(11), 'próxima vai para o dono original');
select lives_ok($$ select complete_activity(pg_temp.u(304), pg_temp.oid('Reunião agendada'), null, null,
  jsonb_build_object('due_at', now() + interval '2 days', 'subject', 'tst-reuniao')) $$, 'editor sem reassign conclui criando reunião');
select is((select owner_id from activities where booked_by_activity_id = pg_temp.u(304)), pg_temp.u(11), 'reunião vai para o dono original');
select throws_ok($$ select complete_activity(pg_temp.u(305), pg_temp.oid('Sem resposta'), p_next => pg_temp.nx(jsonb_build_object('owner_id', pg_temp.u(11)))) $$,
  'P0001', 'OXYN_FORBIDDEN', 'dono estrangeiro sem reassign');
select lives_ok($$ select complete_activity(pg_temp.u(305), pg_temp.oid('Sem resposta'), p_next => pg_temp.nx(jsonb_build_object('owner_id', pg_temp.u(14)))) $$,
  'owner_id igual ao próprio usuário passa');
select pg_temp.as_user(pg_temp.u(11));
select lives_ok($$ select complete_activity(pg_temp.u(306), pg_temp.oid('Sem resposta'), p_next => pg_temp.nx(jsonb_build_object('owner_id', pg_temp.u(14)))) $$,
  'gestor com reassign escolhe outro dono');
select is((select owner_id from activities where id = (select id from activities where deal_id = pg_temp.u(203) and subject = 'tst-prox' and owner_id = pg_temp.u(14) order by created_at desc, id limit 1)),
  pg_temp.u(14), 'próxima com dono escolhido');
select throws_ok($$ select complete_activity(pg_temp.u(307), pg_temp.oid('Sem resposta'), p_next => pg_temp.nx(jsonb_build_object('owner_id', pg_temp.u(12)))) $$,
  'P0001', 'OXYN_OWNER_NOT_MEMBER', 'dono que não é da empresa');

-- 3. validação de entrada ------------------------------------------------------------------------------
select throws_ok($$ select complete_activity(pg_temp.u(307), pg_temp.oid('Sem resposta'), p_next => pg_temp.nx('{"due_at":"abc"}')) $$,
  'P0001', 'OXYN_INVALID_INPUT', 'data inválida');
select throws_ok($$ select complete_activity(pg_temp.u(307), pg_temp.oid('Sem resposta'), p_next => pg_temp.nx(jsonb_build_object('channel_id',
  (select id from activity_channels where company_id = pg_temp.u(1) and name = 'Não informado')))) $$,
  'P0001', 'OXYN_INVALID_INPUT', 'canal inativo');
select throws_ok($$ select complete_activity(pg_temp.u(307), pg_temp.oid('Sem resposta'), p_next => pg_temp.nx('{"type_id":"nao-uuid"}')) $$,
  'P0001', 'OXYN_INVALID_INPUT', 'uuid inválido');

-- 4. flag presa ao id --------------------------------------------------------------------------------------
select set_config('oxyn.completing', 'on', true);
select throws_ok($$ update activities set done = true, completed_at = now(), outcome_id = pg_temp.oid('Sem resposta') where id = pg_temp.u(308) $$,
  'P0001', 'OXYN_FORBIDDEN_FIELD', 'flag "on" não libera');
select set_config('oxyn.completing', pg_temp.u(307)::text, true);
select throws_ok($$ update activities set done = true, completed_at = now(), outcome_id = pg_temp.oid('Sem resposta') where id = pg_temp.u(308) $$,
  'P0001', 'OXYN_FORBIDDEN_FIELD', 'flag com id de outra atividade não libera');
select set_config('oxyn.completing', '', true);

-- 5. lembretes, funções inlináveis ------------------------------------------------------------------------
select pg_temp.as_pg();
select pg_temp.mk(320, 'Tarefa', 'E-mail', pg_temp.u(11), pg_temp.u(203), 10, now() - interval '1 minute');
select pg_temp.mk(321, 'Tarefa', 'E-mail', pg_temp.u(11), pg_temp.u(203), 10, now() - interval '1 minute');
select pg_temp.mk(322, 'Tarefa', 'E-mail', pg_temp.u(12), pg_temp.u(203), 10, now() - interval '1 minute');
update activities set legacy = true where id = pg_temp.u(321);
select generate_activity_reminders();
select is((select count(*) from notifications where activity_id = pg_temp.u(320)), 1::bigint, 'lembrete normal gerado');
select is((select count(*) from notifications where activity_id in (pg_temp.u(321), pg_temp.u(322))), 0::bigint, 'legado e dono sem vínculo não geram lembrete');
select ok((select bool_and(proconfig is null) from pg_proc where proname in ('next_activity_for') and pronamespace = 'public'::regnamespace),
  'consultas sem set search_path (inlináveis)');

select pg_temp.as_user(pg_temp.u(11));
select throws_ok($$ select chain_insert_activity(pg_temp.u(301), 'meeting', '{"subject":"x","due_at":"2030-01-01T10:00:00Z"}'::jsonb) $$,
  'P0001', 'OXYN_FORBIDDEN', 'chain_insert_activity direto via RPC é barrado');
select throws_ok($$ select set_config('oxyn.completing', pg_temp.u(999)::text, true), chain_insert_activity(pg_temp.u(301), 'meeting', '{"subject":"x","due_at":"2030-01-01T10:00:00Z"}'::jsonb) $$,
  'P0001', 'OXYN_FORBIDDEN', 'flag de outra atividade não libera chain_insert_activity');
select pg_temp.as_pg();

select * from finish();
rollback;
