begin;
select plan(53);

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

-- fixtures: empresas 1 (volt) e 2 (naia); gestor u(11) em 1; outsider u(12) em 2
insert into companies (id, name, slug) values
  (pg_temp.u(1), 'Volt Teste', 'tst-volt'), (pg_temp.u(2), 'Naia Teste', 'tst-naia');
insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data) values
  (pg_temp.u(11), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tst-gestor@oxyn.test', '{"full_name":"gestor"}'),
  (pg_temp.u(12), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tst-fora@oxyn.test', '{"full_name":"fora"}');
insert into roles (id, name, description, permissions) values
  (pg_temp.u(21), 'tst-Gestor', 'teste', '{"visibility":{"leads":"company","deals":"company","persons":"company","organizations":"company","activities":"company"},"actions":{"create":true,"edit":true,"delete":true,"export":true,"reassign_owner":true},"settings":{"manage_pipelines":true,"manage_custom_fields":true,"manage_products":true,"view_reports":true,"create_dashboards":true,"share_dashboards":true}}'::jsonb);
insert into memberships (user_id, company_id, role_id) values
  (pg_temp.u(11), pg_temp.u(1), pg_temp.u(21)), (pg_temp.u(12), pg_temp.u(2), pg_temp.u(21));

insert into pipelines (id, company_id, name, next_activity_rule) values
  (pg_temp.u(401), pg_temp.u(1), 'tst-funil-require', 'require'),
  (pg_temp.u(402), pg_temp.u(1), 'tst-funil-off', 'off');
insert into stages (id, pipeline_id, company_id, name, position) values
  (pg_temp.u(501), pg_temp.u(401), pg_temp.u(1), 'tst-e1', 0),
  (pg_temp.u(502), pg_temp.u(402), pg_temp.u(1), 'tst-e2', 0);
insert into deals (id, company_id, owner_id, title, pipeline_id, stage_id, created_by) values
  (pg_temp.u(201), pg_temp.u(1), pg_temp.u(11), 'tst-neg-require', pg_temp.u(401), pg_temp.u(501), pg_temp.u(11)),
  (pg_temp.u(202), pg_temp.u(1), pg_temp.u(11), 'tst-neg-ganho', pg_temp.u(401), pg_temp.u(501), pg_temp.u(11)),
  (pg_temp.u(203), pg_temp.u(1), pg_temp.u(11), 'tst-neg-off', pg_temp.u(402), pg_temp.u(502), pg_temp.u(11)),
  (pg_temp.u(204), pg_temp.u(1), pg_temp.u(11), 'tst-neg-proximas', pg_temp.u(402), pg_temp.u(502), pg_temp.u(11)),
  (pg_temp.u(205), pg_temp.u(1), pg_temp.u(11), 'tst-neg-futuro', pg_temp.u(402), pg_temp.u(502), pg_temp.u(11)),
  (pg_temp.u(206), pg_temp.u(1), pg_temp.u(11), 'tst-neg-vazio', pg_temp.u(402), pg_temp.u(502), pg_temp.u(11)),
  (pg_temp.u(207), pg_temp.u(1), pg_temp.u(11), 'tst-neg-outra-aberta', pg_temp.u(401), pg_temp.u(501), pg_temp.u(11)),
  (pg_temp.u(208), pg_temp.u(1), pg_temp.u(11), 'tst-neg-reuniao-conta', pg_temp.u(401), pg_temp.u(501), pg_temp.u(11));
update deals set status = 'won' where id = pg_temp.u(202);
insert into leads (id, company_id, owner_id, title, created_by) values
  (pg_temp.u(101), pg_temp.u(1), pg_temp.u(11), 'tst-lead-aberto', pg_temp.u(11)),
  (pg_temp.u(102), pg_temp.u(1), pg_temp.u(11), 'tst-lead-desq', pg_temp.u(11)),
  (pg_temp.u(103), pg_temp.u(1), pg_temp.u(11), 'tst-lead-proximas', pg_temp.u(11));
update leads set status = 'disqualified',
  disqualification_reason_id = (select id from disqualification_reasons where company_id = pg_temp.u(1) limit 1)
  where id = pg_temp.u(102);
update companies set settings = coalesce(settings, '{}'::jsonb) || '{"lead_next_activity_rule":"require"}'::jsonb
  where id = pg_temp.u(1);
update activity_outcomes set active = false
  where company_id = pg_temp.u(1) and name = 'Número ou perfil inválido';

create function pg_temp.mk(n int, tname text, ch text, p_lead uuid default null, p_deal uuid default null,
  p_due timestamptz default now(), p_rem int default null) returns void language plpgsql as $$
begin
  insert into activities (id, company_id, owner_id, created_by, type_id, channel_id, subject, due_at, lead_id, deal_id, reminder_minutes)
  values (pg_temp.u(n), pg_temp.u(1), pg_temp.u(11), pg_temp.u(11),
    (select id from activity_types where company_id = pg_temp.u(1) and name = tname),
    (select id from activity_channels where company_id = pg_temp.u(1) and name = ch),
    'tst-ativ-' || n, p_due, p_lead, p_deal, p_rem);
end $$;
create function pg_temp.oid(nm text) returns uuid language sql stable as $$
  select id from activity_outcomes where company_id = pg_temp.u(1) and name = nm $$;
grant execute on function pg_temp.mk(int, text, text, uuid, uuid, timestamptz, int), pg_temp.oid(text) to public;

select pg_temp.mk(301, 'Tarefa', 'E-mail', null, pg_temp.u(203));
select pg_temp.mk(302, 'Reunião', 'Videochamada', null, pg_temp.u(203));
select pg_temp.mk(303, 'Tarefa', 'LinkedIn', null, pg_temp.u(203));
select pg_temp.mk(304, 'Tarefa', 'E-mail', null, pg_temp.u(201));
select pg_temp.mk(305, 'Tarefa', 'E-mail', null, pg_temp.u(202));
select pg_temp.mk(306, 'Tarefa', 'E-mail', pg_temp.u(101), pg_temp.u(203));
select pg_temp.mk(307, 'Tarefa', 'E-mail', pg_temp.u(101), null);
select pg_temp.mk(308, 'Tarefa', 'E-mail', pg_temp.u(102), null);
select pg_temp.mk(309, 'Tarefa', 'LinkedIn', null, pg_temp.u(208));
select pg_temp.mk(310, 'Tarefa', 'E-mail', null, pg_temp.u(207));
select pg_temp.mk(311, 'Tarefa', 'E-mail', null, pg_temp.u(207), now() + interval '3 days');
select pg_temp.mk(312, 'Tarefa', 'E-mail', null, pg_temp.u(203));
select pg_temp.mk(313, 'Tarefa', 'E-mail', null, pg_temp.u(203));

-- 1. resultado obrigatório --------------------------------------------------------
select pg_temp.as_user(pg_temp.u(11));
select throws_ok($$ select complete_activity(pg_temp.u(301)) $$, 'P0001', 'OXYN_OUTCOME_REQUIRED', 'tarefa sem resultado');
select throws_ok($$ select complete_activity(pg_temp.u(301), p_meeting_outcome => 'held') $$, 'P0001', 'OXYN_OUTCOME_REQUIRED', 'tarefa com resultado de reunião');
select throws_ok($$ select complete_activity(pg_temp.u(302), pg_temp.oid('Sem resposta')) $$, 'P0001', 'OXYN_OUTCOME_REQUIRED', 'reunião com resultado comum');
select throws_ok($$ select complete_activity(pg_temp.u(301), pg_temp.oid('Número ou perfil inválido')) $$, 'P0001', 'OXYN_OUTCOME_REQUIRED', 'resultado inativo');
select lives_ok($$ select complete_activity(pg_temp.u(302), p_meeting_outcome => 'held') $$, 'reunião com held');
select is((select meeting_outcome from activities where id = pg_temp.u(302)), 'held', 'reunião concluída com held');
select ok((select done and completed_at is not null from activities where id = pg_temp.u(302)), 'done e completed_at gravados');
select throws_ok($$ select complete_activity(pg_temp.u(302), p_meeting_outcome => 'held') $$, 'P0001', 'OXYN_ALREADY_DONE', 'concluir duas vezes');
select pg_temp.as_user(pg_temp.u(12));
select throws_ok($$ select complete_activity(pg_temp.u(301), pg_temp.oid('Sem resposta')) $$, 'P0001', 'OXYN_NOT_FOUND', 'usuário de outra empresa não conclui');
select pg_temp.as_user(pg_temp.u(11));

-- 2. cadeia de reunião --------------------------------------------------------------
select throws_ok($$ select complete_activity(pg_temp.u(303), pg_temp.oid('Reunião agendada')) $$, 'P0001', 'OXYN_MEETING_REQUIRED', 'reunião agendada sem p_meeting');
select throws_ok($$ select complete_activity(pg_temp.u(303), pg_temp.oid('Reunião agendada'), p_meeting => '{"subject":"x"}'::jsonb) $$, 'P0001', 'OXYN_MEETING_REQUIRED', 'p_meeting incompleto');
select lives_ok($$ select complete_activity(pg_temp.u(303), pg_temp.oid('Reunião agendada'), null, 'ok',
  jsonb_build_object('due_at', now() + interval '2 days', 'duration_minutes', 45, 'subject', 'tst-reuniao-criada')) $$, 'conclui criando reunião');
select is((select count(*) from activities where booked_by_activity_id = pg_temp.u(303)), 1::bigint, 'reunião criada com booked_by');
select is((select a.origin_channel_id from activities a where a.booked_by_activity_id = pg_temp.u(303)),
  (select id from activity_channels where company_id = pg_temp.u(1) and name = 'LinkedIn'), 'origin_channel_id = LinkedIn');
select ok((select t.is_meeting and a.deal_id = pg_temp.u(203) and a.owner_id = pg_temp.u(11) and a.channel_id = a.origin_channel_id and a.duration_minutes = 45
  from activities a join activity_types t on t.id = a.type_id where a.booked_by_activity_id = pg_temp.u(303)),
  'reunião é do tipo reunião, mesmos vínculos, responsável e canal');
select is((select completion_note from activities where id = pg_temp.u(303)), 'ok', 'nota gravada');
-- lixeira na reunião criada não toca a tarefa
update activities set deleted_at = now() where booked_by_activity_id = pg_temp.u(303);
select ok((select done and outcome_id = pg_temp.oid('Reunião agendada') and deleted_at is null from activities where id = pg_temp.u(303)),
  'lixeira na reunião criada não altera a tarefa de origem');

-- 3. próxima atividade ----------------------------------------------------------------
select throws_ok($$ select complete_activity(pg_temp.u(304), pg_temp.oid('Sem resposta')) $$, 'P0001', 'OXYN_NEXT_ACTIVITY_REQUIRED', 'funil require exige próxima');
select is((select done from activities where id = pg_temp.u(304)), false, 'falha não conclui');
select throws_ok($$ select complete_activity(pg_temp.u(304), pg_temp.oid('Sem resposta'), p_next => '{"subject":"x"}'::jsonb) $$, 'P0001', 'OXYN_NEXT_ACTIVITY_REQUIRED', 'p_next incompleto');
select lives_ok($$ select complete_activity(pg_temp.u(304), pg_temp.oid('Sem resposta'), p_next => jsonb_build_object(
  'type_id', (select id from activity_types where company_id = pg_temp.u(1) and name = 'Ligação'),
  'channel_id', (select id from activity_channels where company_id = pg_temp.u(1) and name = 'Telefone'),
  'subject', 'tst-proxima', 'due_at', now() + interval '1 day', 'duration_minutes', 15, 'reminder_minutes', 10)) $$, 'com p_next conclui');
select ok((select a.deal_id = pg_temp.u(201) and a.reminder_minutes = 10 and not a.done and a.owner_id = pg_temp.u(11) and a.subject = 'tst-proxima'
  from activities a where a.company_id = pg_temp.u(1) and a.subject = 'tst-proxima'), 'próxima criada com os mesmos vínculos');
select is((select complete_activity(pg_temp.u(305), pg_temp.oid('Sem resposta'))->>'rule'), 'require', 'negócio ganho não exige (regra devolvida)');
select ok((select done from activities where id = pg_temp.u(305)), 'negócio ganho concluído sem próxima');
select lives_ok($$ select complete_activity(pg_temp.u(306), pg_temp.oid('Sem resposta')) $$, 'lead + negócio segue a regra do funil (off)');
select throws_ok($$ select complete_activity(pg_temp.u(307), pg_temp.oid('Sem resposta')) $$, 'P0001', 'OXYN_NEXT_ACTIVITY_REQUIRED', 'lead com regra require da empresa');
select lives_ok($$ select complete_activity(pg_temp.u(308), pg_temp.oid('Sem resposta')) $$, 'lead desqualificado não exige');
select is((select complete_activity(pg_temp.u(309), pg_temp.oid('Reunião agendada'), null, null,
  jsonb_build_object('due_at', now() + interval '2 days', 'duration_minutes', 30, 'subject', 'tst-reuniao-conta'))->>'rule'), 'require',
  'reunião criada no passo conta como próxima');
select lives_ok($$ select complete_activity(pg_temp.u(310), pg_temp.oid('Sem resposta')) $$, 'outra atividade aberta no negócio conta');

-- 4. trava de conclusão direta ---------------------------------------------------------
select throws_ok($$ update activities set done = true, completed_at = now() where id = pg_temp.u(312) $$, 'P0001', 'OXYN_FORBIDDEN_FIELD', 'done direto bloqueado');
select throws_ok($$ update activities set outcome_id = pg_temp.oid('Sem resposta') where id = pg_temp.u(312) $$, 'P0001', 'OXYN_FORBIDDEN_FIELD', 'outcome direto bloqueado');
select throws_ok($$ update activities set type_id = (select id from activity_types where company_id = pg_temp.u(1) and name = 'Ligação') where id = pg_temp.u(303) $$,
  'P0001', 'OXYN_FORBIDDEN_FIELD', 'type_id de concluída bloqueado');
select lives_ok($$ update activities set type_id = (select id from activity_types where company_id = pg_temp.u(1) and name = 'Ligação') where id = pg_temp.u(312) $$, 'type_id de aberta segue livre');

-- 5. reabrir ------------------------------------------------------------------------
select lives_ok($$ select reopen_activity(pg_temp.u(309)) $$, 'reabrir');
select ok((select not done and completed_at is null and outcome_id is null and completion_note is null from activities where id = pg_temp.u(309)), 'reabrir limpa a conclusão');
select is((select count(*) from activities where booked_by_activity_id = pg_temp.u(309)), 1::bigint, 'reabrir mantém a reunião criada');
select throws_ok($$ select reopen_activity(pg_temp.u(309)) $$, 'P0001', 'OXYN_NOT_DONE', 'reabrir atividade aberta');

-- 6. linha do tempo --------------------------------------------------------------------
select pg_temp.as_pg();
select ok(exists (select 1 from timeline_events where kind = 'activity_scheduled' and entity = 'deals' and record_id = pg_temp.u(203)
  and data->>'activity_id' = pg_temp.u(303)::text), 'activity_scheduled no negócio');
select ok(exists (select 1 from timeline_events where kind = 'activity_completed' and entity = 'deals' and record_id = pg_temp.u(203)
  and data->>'activity_id' = pg_temp.u(303)::text and data->>'classification' = 'success'), 'activity_completed no negócio');
select ok(exists (select 1 from timeline_events where kind = 'activity_completed' and entity = 'leads' and record_id = pg_temp.u(101)
  and data->>'activity_id' = pg_temp.u(306)::text), 'activity_completed também no lead vinculado');

-- 7. lembretes ----------------------------------------------------------------------------
select pg_temp.mk(320, 'Tarefa', 'E-mail', null, pg_temp.u(204), now() - interval '1 minute', 10);
select pg_temp.mk(321, 'Tarefa', 'E-mail', null, pg_temp.u(204), now() + interval '1 day', 10);
select pg_temp.mk(322, 'Tarefa', 'E-mail', null, pg_temp.u(204), now() - interval '1 minute', 10);
update activities set deleted_at = now() where id = pg_temp.u(322);
select ok(generate_activity_reminders() >= 1, 'gera lembretes');
select is((select count(*) from notifications where activity_id = pg_temp.u(320)), 1::bigint, '1 notificação');
select ok((select reminder_sent_at is not null from activities where id = pg_temp.u(320)), 'marca reminder_sent_at');
select is((select count(*) from notifications where activity_id in (pg_temp.u(321), pg_temp.u(322))), 0::bigint, 'futura e na lixeira não geram');
select generate_activity_reminders();
select is((select count(*) from notifications where activity_id = pg_temp.u(320)), 1::bigint, 'segunda chamada não duplica');
update activities set due_at = now() + interval '5 minutes' where id = pg_temp.u(320);
select ok((select reminder_sent_at is null from activities where id = pg_temp.u(320)), 'remarcar zera reminder_sent_at');
select generate_activity_reminders();
select is((select count(*) from notifications where activity_id = pg_temp.u(320)), 2::bigint, 'remarcar gera nova notificação');
select pg_temp.as_user(pg_temp.u(11));
select throws_ok($$ select generate_activity_reminders() $$, '42501', null, 'usuário não executa o gerador');

-- 8. próximas atividades por registro ---------------------------------------------------------
select pg_temp.as_pg();
select pg_temp.mk(330, 'Tarefa', 'E-mail', null, pg_temp.u(204), now() + interval '2 days');
select pg_temp.mk(331, 'Tarefa', 'E-mail', null, pg_temp.u(204), now() - interval '1 day');
select pg_temp.mk(332, 'Tarefa', 'E-mail', null, pg_temp.u(205), now() + interval '1 day');
select pg_temp.mk(333, 'Tarefa', 'E-mail', pg_temp.u(103), null, now() - interval '2 hours');
select pg_temp.as_user(pg_temp.u(11));
select is((select activity_id from next_activity_for('deals', array[pg_temp.u(204)]) where record_id = pg_temp.u(204) and activity_id in (pg_temp.u(330), pg_temp.u(331))),
  pg_temp.u(331), 'mais próxima (por data) do negócio');
select ok((select overdue from next_activity_for('deals', array[pg_temp.u(204)]) where record_id = pg_temp.u(204) and activity_id = pg_temp.u(331)), 'marca overdue');
select ok((select not overdue from next_activity_for('deals', array[pg_temp.u(205)])), 'futura não é overdue');
select is((select count(*) from next_activity_for('deals', array[pg_temp.u(204), pg_temp.u(205), pg_temp.u(206)])), 2::bigint, 'registro sem atividade não volta');
select is((select activity_id from next_activity_for('leads', array[pg_temp.u(103)])), pg_temp.u(333), 'funciona para leads');

select * from finish();
rollback;
