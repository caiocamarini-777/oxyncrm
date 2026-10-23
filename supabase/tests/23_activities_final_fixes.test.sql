begin;
select plan(52);

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
insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data) values
  (pg_temp.u(11), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tst-gestor@oxyn.test', '{"full_name":"gestor"}'),
  (pg_temp.u(12), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tst-admin@oxyn.test', '{"full_name":"admin"}'),
  (pg_temp.u(13), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tst-vend@oxyn.test', '{"full_name":"vend"}');
update profiles set is_super_admin = true where id = pg_temp.u(12);
insert into roles (id, name, description, permissions) values
  (pg_temp.u(21), 'tst-Gestor', 'teste', '{"visibility":{"leads":"company","deals":"company","persons":"company","organizations":"company","activities":"company"},"actions":{"create":true,"edit":true,"delete":true,"export":true,"reassign_owner":true},"settings":{"manage_pipelines":true,"manage_custom_fields":true,"manage_products":true,"view_reports":true,"create_dashboards":true,"share_dashboards":true}}'::jsonb),
  (pg_temp.u(22), 'tst-Vendedor', 'teste', '{"visibility":{"leads":"own","deals":"own","persons":"own","organizations":"own","activities":"own"},"actions":{"create":true,"edit":true,"delete":false,"export":false,"reassign_owner":false},"settings":{"manage_pipelines":false,"manage_custom_fields":false,"manage_products":false,"view_reports":true,"create_dashboards":true,"share_dashboards":false}}'::jsonb);
insert into memberships (user_id, company_id, role_id) values
  (pg_temp.u(11), pg_temp.u(1), pg_temp.u(21)), (pg_temp.u(13), pg_temp.u(1), pg_temp.u(22));

insert into pipelines (id, company_id, name, next_activity_rule) values (pg_temp.u(402), pg_temp.u(1), 'tst-funil-off', 'off');
insert into stages (id, pipeline_id, company_id, name, position) values (pg_temp.u(502), pg_temp.u(402), pg_temp.u(1), 'tst-e2', 0);
insert into deals (id, company_id, owner_id, title, pipeline_id, stage_id, created_by) values
  (pg_temp.u(201), pg_temp.u(1), pg_temp.u(11), 'tst-neg-lixeira', pg_temp.u(402), pg_temp.u(502), pg_temp.u(11)),
  (pg_temp.u(202), pg_temp.u(1), pg_temp.u(11), 'tst-neg-fluxos', pg_temp.u(402), pg_temp.u(502), pg_temp.u(11));
insert into leads (id, company_id, owner_id, title, created_by) values
  (pg_temp.u(101), pg_temp.u(1), pg_temp.u(11), 'tst-lead-conversao', pg_temp.u(11)),
  (pg_temp.u(102), pg_temp.u(1), pg_temp.u(11), 'tst-lead-lixeira', pg_temp.u(11));
insert into persons (id, company_id, owner_id, full_name) values (pg_temp.u(301), pg_temp.u(1), pg_temp.u(11), 'tst-pessoa');
insert into organizations (id, company_id, owner_id, name) values (pg_temp.u(311), pg_temp.u(1), pg_temp.u(11), 'tst-org');

create function pg_temp.mk(n int, tname text, ch text, p_lead uuid default null, p_deal uuid default null,
  p_person uuid default null, p_org uuid default null, p_rem int default null, p_due timestamptz default now())
returns void language plpgsql as $$
begin
  insert into activities (id, company_id, owner_id, created_by, type_id, channel_id, subject, due_at, lead_id, deal_id,
    person_id, organization_id, reminder_minutes)
  values (pg_temp.u(n), pg_temp.u(1), pg_temp.u(11), pg_temp.u(11),
    (select id from activity_types where company_id = pg_temp.u(1) and name = tname),
    (select id from activity_channels where company_id = pg_temp.u(1) and name = ch),
    'tst-ativ-' || n, p_due, p_lead, p_deal, p_person, p_org, p_rem);
end $$;
create function pg_temp.oid(nm text) returns uuid language sql stable as $$
  select id from activity_outcomes where company_id = pg_temp.u(1) and name = nm $$;
create function pg_temp.mt(subj text default 'tst-reuniao') returns jsonb language sql stable as $$
  select jsonb_build_object('subject', subj, 'due_at', now() + interval '2 days') $$;
grant execute on function pg_temp.mk(int, text, text, uuid, uuid, uuid, uuid, int, timestamptz), pg_temp.oid(text), pg_temp.mt(text) to public;

-- 1. conversão de lead migra atividades ---------------------------------------------------------------
select pg_temp.mk(601, 'Tarefa', 'E-mail', pg_temp.u(101));
select pg_temp.mk(602, 'Tarefa', 'E-mail', pg_temp.u(101));
select pg_temp.mk(603, 'Tarefa', 'E-mail', pg_temp.u(101));
update activities set deleted_at = now() where id = pg_temp.u(603);
select pg_temp.as_user(pg_temp.u(11));
select lives_ok($$ select complete_activity(pg_temp.u(602), pg_temp.oid('Sem resposta')) $$, 'conclui atividade do lead');
select lives_ok($$ select set_config('tst.deal', convert_lead(pg_temp.u(101), pg_temp.u(402), pg_temp.u(502))::text, true) $$, 'converte o lead');
select is((select count(*) from activities where id in (pg_temp.u(601), pg_temp.u(602))
  and deal_id = current_setting('tst.deal')::uuid and lead_id = pg_temp.u(101)), 2::bigint, 'aberta e concluída ganham deal_id e mantêm lead_id');
select is((select deal_id from activities where id = pg_temp.u(603)), null, 'atividade na lixeira não migra');
select is((select activity_id from next_activity_for('deals', array[current_setting('tst.deal')::uuid])), pg_temp.u(601), 'next_activity_for acha a aberta no negócio');

-- 2. campos de métrica não são forjáveis -----------------------------------------------------------------------
select pg_temp.as_pg();
select pg_temp.mk(610, 'Tarefa', 'E-mail', null, pg_temp.u(202));
select pg_temp.as_user(pg_temp.u(11));
select throws_ok($$ insert into activities (company_id, owner_id, type_id, channel_id, subject, due_at, deal_id, origin_channel_id)
  select company_id, owner_id, type_id, channel_id, 'f', now(), deal_id, channel_id from activities where id = pg_temp.u(610) $$,
  'P0001', 'OXYN_FORBIDDEN_FIELD', 'insert com origin_channel_id é barrado');
select throws_ok($$ insert into activities (company_id, owner_id, type_id, channel_id, subject, due_at, deal_id, legacy)
  select company_id, owner_id, type_id, channel_id, 'f', now(), deal_id, true from activities where id = pg_temp.u(610) $$,
  'P0001', 'OXYN_FORBIDDEN_FIELD', 'insert com legacy é barrado');
select throws_ok($$ insert into activities (company_id, owner_id, type_id, channel_id, subject, due_at, deal_id, reminder_sent_at)
  select company_id, owner_id, type_id, channel_id, 'f', now(), deal_id, now() from activities where id = pg_temp.u(610) $$,
  'P0001', 'OXYN_FORBIDDEN_FIELD', 'insert com reminder_sent_at é barrado');
select throws_ok($$ update activities set booked_by_activity_id = pg_temp.u(601) where id = pg_temp.u(610) $$,
  'P0001', 'OXYN_FORBIDDEN_FIELD', 'update de booked_by é barrado');
select throws_ok($$ update activities set origin_channel_id = channel_id where id = pg_temp.u(610) $$,
  'P0001', 'OXYN_FORBIDDEN_FIELD', 'update de origin_channel_id é barrado');
select throws_ok($$ update activities set legacy = true where id = pg_temp.u(610) $$,
  'P0001', 'OXYN_FORBIDDEN_FIELD', 'update de legacy é barrado');
select throws_ok($$ update activities set channel_id = (select id from activity_channels where company_id = pg_temp.u(1) and name = 'Telefone') where id = pg_temp.u(602) $$,
  'P0001', 'OXYN_FORBIDDEN_FIELD', 'canal de atividade concluída não muda');
select lives_ok($$ update activities set channel_id = (select id from activity_channels where company_id = pg_temp.u(1) and name = 'Telefone') where id = pg_temp.u(610) $$,
  'canal de atividade aberta muda');
select lives_ok($$ update activities set channel_id = (select id from activity_channels where company_id = pg_temp.u(1) and name = 'E-mail') where id = pg_temp.u(610) $$,
  'e volta');

-- 3. reunião remarcada mantém a atribuição ------------------------------------------------------------------------
select lives_ok($$ select set_config('tst.m1', complete_activity(pg_temp.u(610), pg_temp.oid('Reunião agendada'), p_meeting => pg_temp.mt('m1'))->>'meeting_id', true) $$,
  'tarefa agenda reunião');
select is((select booked_by_activity_id from activities where id = current_setting('tst.m1')::uuid), pg_temp.u(610), 'reunião agendada pela tarefa');
select lives_ok($$ select set_config('tst.m2', complete_activity(current_setting('tst.m1')::uuid, p_meeting_outcome => 'rescheduled', p_meeting => pg_temp.mt('m2'))->>'meeting_id', true) $$,
  'reunião remarcada cria a nova no mesmo chamado');
select is((select booked_by_activity_id from activities where id = current_setting('tst.m2')::uuid), pg_temp.u(610), 'remarcada herda booked_by');
select lives_ok($$ select complete_activity(current_setting('tst.m2')::uuid, p_meeting_outcome => 'held') $$, 'nova reunião realizada');
select is((select booked_by_activity_id from activities where id = current_setting('tst.m2')::uuid), pg_temp.u(610), 'realizada mantém booked_by original');
select is((select origin_channel_id from activities where id = current_setting('tst.m2')::uuid),
  (select id from activity_channels where company_id = pg_temp.u(1) and name = 'E-mail'), 'realizada mantém o canal de origem');
select pg_temp.as_pg();
select pg_temp.mk(611, 'Reunião', 'Videochamada', null, pg_temp.u(202));
select pg_temp.as_user(pg_temp.u(11));
select lives_ok($$ select complete_activity(pg_temp.u(611), p_meeting_outcome => 'rescheduled') $$, 'remarcar sem nova reunião continua válido');
-- exclusão definitiva da origem zera booked_by sem acusar campo proibido (ação de FK)
select lives_ok($$ update activities set deleted_at = now() where id = pg_temp.u(610) $$, 'coloca a origem na lixeira');
select pg_temp.as_user(pg_temp.u(12));
select lives_ok($$ select purge_record('activities', pg_temp.u(610)) $$, 'exclui a origem definitivamente');
select pg_temp.as_user(pg_temp.u(11));
select is((select booked_by_activity_id from activities where id = current_setting('tst.m2')::uuid), null, 'FK limpa booked_by');

-- 4. lixeira do registro leva as atividades abertas --------------------------------------------------------------
select pg_temp.as_pg();
select pg_temp.mk(620, 'Tarefa', 'E-mail', pg_temp.u(102));
select pg_temp.mk(621, 'Tarefa', 'E-mail', pg_temp.u(102));
select pg_temp.mk(622, 'Tarefa', 'E-mail', pg_temp.u(102), null, pg_temp.u(301));
select pg_temp.mk(623, 'Tarefa', 'E-mail', pg_temp.u(102));
update activities set deleted_at = now() - interval '1 day' where id = pg_temp.u(623);
select pg_temp.mk(630, 'Tarefa', 'E-mail', null, pg_temp.u(201));
select pg_temp.mk(631, 'Tarefa', 'E-mail', null, pg_temp.u(201));
select pg_temp.mk(632, 'Tarefa', 'E-mail', null, pg_temp.u(201), null, pg_temp.u(311));
select pg_temp.as_user(pg_temp.u(11));
select lives_ok($$ select complete_activity(pg_temp.u(621), pg_temp.oid('Sem resposta')) $$, 'conclui atividade do lead');
select lives_ok($$ select complete_activity(pg_temp.u(631), pg_temp.oid('Sem resposta')) $$, 'conclui atividade do negócio');
select lives_ok($$ update leads set deleted_at = now() where id = pg_temp.u(102) $$, 'lead vai para a lixeira');
select is((select count(*) from activities where id in (pg_temp.u(620)) and deleted_at is not null), 1::bigint, 'aberta de vínculo único vai junto');
select is((select count(*) from activities where id in (pg_temp.u(621), pg_temp.u(622)) and deleted_at is null), 2::bigint, 'concluída e com outro vínculo vivo ficam');
select lives_ok($$ update leads set deleted_at = null where id = pg_temp.u(102) $$, 'lead restaurado');
select is((select count(*) from activities where id in (pg_temp.u(620), pg_temp.u(621), pg_temp.u(622)) and deleted_at is null), 3::bigint, 'atividade volta com o lead');
select is((select count(*) from activities where id = pg_temp.u(623) and deleted_at is not null), 1::bigint, 'atividade excluída antes continua na lixeira');
select lives_ok($$ update deals set deleted_at = now() where id = pg_temp.u(201) $$, 'negócio vai para a lixeira');
select is((select count(*) from activities where id = pg_temp.u(630) and deleted_at is not null), 1::bigint, 'aberta do negócio vai junto');
select is((select count(*) from activities where id in (pg_temp.u(631), pg_temp.u(632)) and deleted_at is null), 2::bigint, 'concluída e com organização viva ficam');
select lives_ok($$ update deals set deleted_at = null where id = pg_temp.u(201) $$, 'negócio restaurado');
select is((select count(*) from activities where id = pg_temp.u(630) and deleted_at is null), 1::bigint, 'aberta do negócio volta');

-- 5. reabrir e concluir de novo ------------------------------------------------------------------------------
select pg_temp.as_pg();
select pg_temp.mk(640, 'Tarefa', 'E-mail', null, pg_temp.u(202));
select pg_temp.mk(641, 'Tarefa', 'E-mail', null, pg_temp.u(202));
select pg_temp.as_user(pg_temp.u(11));
select lives_ok($$ select set_config('tst.r1', complete_activity(pg_temp.u(640), pg_temp.oid('Reunião agendada'), p_meeting => pg_temp.mt('r1'))->>'meeting_id', true) $$, 'agenda');
select lives_ok($$ select reopen_activity(pg_temp.u(640)) $$, 'reabre');
select lives_ok($$ select set_config('tst.r2', complete_activity(pg_temp.u(640), pg_temp.oid('Reunião agendada'), p_meeting => pg_temp.mt('r2'))->>'meeting_id', true) $$, 'conclui de novo');
select ok(current_setting('tst.r1') = current_setting('tst.r2')
  and (select count(*) from activities where booked_by_activity_id = pg_temp.u(640)) = 1, 'reutiliza a mesma reunião, sem duplicar');
select lives_ok($$ select set_config('tst.q1', complete_activity(pg_temp.u(641), pg_temp.oid('Reunião agendada'), p_meeting => pg_temp.mt('q1'))->>'meeting_id', true) $$, 'agenda outra');
select lives_ok($$ select reopen_activity(pg_temp.u(641)) $$, 'reabre a outra');
select lives_ok($$ select complete_activity(pg_temp.u(641), pg_temp.oid('Sem resposta')) $$, 'conclui sem agendar');
select ok((select booked_by_activity_id is null from activities where id = current_setting('tst.q1')::uuid)
  and (select deleted_at is null from activities where id = current_setting('tst.q1')::uuid), 'reunião fica, sem crédito de agendamento');

-- 6. lembretes rearmados -----------------------------------------------------------------------------------------------
select pg_temp.as_pg();
select pg_temp.mk(650, 'Tarefa', 'E-mail', null, pg_temp.u(202), null, null, 10, now() - interval '1 minute');
select generate_activity_reminders();
select ok((select reminder_sent_at is not null from activities where id = pg_temp.u(650)), 'lembrete marcado como enviado');
select pg_temp.as_user(pg_temp.u(11));
select lives_ok($$ update activities set owner_id = pg_temp.u(13) where id = pg_temp.u(650) $$, 'reatribui');
select ok((select reminder_sent_at is null from activities where id = pg_temp.u(650)), 'troca de dono rearma o lembrete');
select pg_temp.as_pg();
update activities set reminder_sent_at = now() where id = pg_temp.u(650);
select pg_temp.as_user(pg_temp.u(11));
select lives_ok($$ select complete_activity(pg_temp.u(650), pg_temp.oid('Sem resposta')) $$, 'conclui');
select lives_ok($$ select reopen_activity(pg_temp.u(650)) $$, 'reabre');
select ok((select reminder_sent_at is null from activities where id = pg_temp.u(650)), 'reabrir rearma o lembrete');

select * from finish();
rollback;
