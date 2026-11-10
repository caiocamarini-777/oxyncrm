begin;
select plan(20);

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

insert into companies (id, name, slug, settings) values
  (pg_temp.u(1), 'Agenda Teste', 'tst-agenda', '{"calendar_sync":{"enabled":true}}');
insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data) values
  (pg_temp.u(11), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tst-agenda-gestor@oxyn.test', '{"full_name":"gestor"}');
insert into roles (id, name, description, permissions) values
  (pg_temp.u(21), 'tst-Agenda-Gestor', 'teste', '{"visibility":{"leads":"company","deals":"company","persons":"company","organizations":"company","activities":"company"},"actions":{"create":true,"edit":true,"delete":true,"export":true,"reassign_owner":true},"settings":{"manage_pipelines":true,"manage_custom_fields":true,"manage_products":true,"view_reports":true,"create_dashboards":true,"share_dashboards":true}}'::jsonb);
insert into memberships (user_id, company_id, role_id) values (pg_temp.u(11), pg_temp.u(1), pg_temp.u(21));
insert into pipelines (id, company_id, name, next_activity_rule) values (pg_temp.u(402), pg_temp.u(1), 'tst-agenda-funil', 'off');
insert into stages (id, pipeline_id, company_id, name, position) values (pg_temp.u(502), pg_temp.u(402), pg_temp.u(1), 'tst-e1', 0);
insert into deals (id, company_id, owner_id, title, pipeline_id, stage_id, created_by) values
  (pg_temp.u(201), pg_temp.u(1), pg_temp.u(11), 'tst-agenda-neg', pg_temp.u(402), pg_temp.u(502), pg_temp.u(11));
insert into email_accounts (id, user_id, company_id, email) values
  (pg_temp.u(401), pg_temp.u(11), pg_temp.u(1), 'tst-agenda-caixa@oxyn.test');

create function pg_temp.tipo() returns uuid language sql stable as $$
  select id from activity_types where company_id = pg_temp.u(1) and name = 'Tarefa' $$;
create function pg_temp.canal() returns uuid language sql stable as $$
  select id from activity_channels where company_id = pg_temp.u(1) and name = 'E-mail' $$;
grant execute on function pg_temp.tipo(), pg_temp.canal() to public;

-- 1. gatilho de pendente guarda a hora da mudança do CRM (lado do CRM no conflito) ------------------------------
insert into activities (id, company_id, owner_id, created_by, type_id, channel_id, subject, due_at, deal_id)
values (pg_temp.u(601), pg_temp.u(1), pg_temp.u(11), pg_temp.u(11), pg_temp.tipo(), pg_temp.canal(), 'tst-a', now() + interval '1 day', pg_temp.u(201));
select is((select calendar_state from activities where id = pg_temp.u(601)), 'pending', 'Agenda ligada: a atividade nova fica pendente');
select isnt((select calendar_local_changed_at from activities where id = pg_temp.u(601)), null, 'e guarda a hora da mudança do CRM');

-- 2. usuário logado não grava as colunas da Agenda no insert ---------------------------------------------------
select pg_temp.as_user(pg_temp.u(11));
insert into activities (id, company_id, owner_id, created_by, type_id, channel_id, subject, due_at, deal_id,
  calendar_account_id, calendar_event_id, calendar_etag, calendar_state, calendar_error, calendar_attempts, meet_url,
  calendar_invited_email, calendar_generation, calendar_is_organizer, calendar_local_changed_at)
values (pg_temp.u(602), pg_temp.u(1), pg_temp.u(11), pg_temp.u(11), pg_temp.tipo(), pg_temp.canal(), 'tst-b', now() + interval '1 day', pg_temp.u(201),
  pg_temp.u(401), 'ev-forjado', '"e"', 'synced', 'x', 5, 'https://evil.test', 'a@b.test', 7, true, '2000-01-01');
select pg_temp.as_pg();
select is((select row(calendar_account_id, calendar_event_id, calendar_etag, meet_url, calendar_invited_email, calendar_is_organizer)::text
           from activities where id = pg_temp.u(602)), row(null::uuid, null::text, null::text, null::text, null::text, null::boolean)::text,
  'insert do usuário: vínculo, etag, Meet, convidado e organizador ficam vazios');
select is((select row(calendar_state, calendar_attempts, calendar_error, calendar_generation)::text from activities where id = pg_temp.u(602)),
  row('pending'::text, 0, null::text, 0)::text, 'insert do usuário: o estado é do gatilho de pendente, tentativas e geração zeradas');
select isnt((select calendar_local_changed_at from activities where id = pg_temp.u(602)), '2000-01-01'::timestamptz,
  'insert do usuário: a hora da mudança é do gatilho');

-- 3. usuário logado não muda as colunas da Agenda no update (desfeito em silêncio) -------------------------------
update activities set calendar_account_id = pg_temp.u(401), calendar_event_id = 'ev-a', calendar_etag = '"a1"',
  calendar_state = 'error', calendar_attempts = 3, calendar_error = 'falha', meet_url = 'https://meet.google.com/a',
  calendar_invited_email = 'cliente@acme.test', calendar_generation = 1, calendar_local_changed_at = '2026-01-01'
 where id = pg_temp.u(601);
select pg_temp.as_user(pg_temp.u(11));
select lives_ok($$ update activities set calendar_account_id = null, calendar_event_id = 'ev-de-outro', calendar_etag = null,
  meet_url = 'https://evil.test', calendar_state = 'synced', calendar_attempts = 0, calendar_error = null,
  calendar_invited_email = null, calendar_generation = 0, calendar_is_organizer = true, calendar_local_changed_at = now()
  where id = pg_temp.u(601) $$, 'update do usuário nas colunas da Agenda não dá erro');
select pg_temp.as_pg();
select is((select calendar_account_id from activities where id = pg_temp.u(601)), pg_temp.u(401), 'caixa do evento mantida');
select is((select calendar_event_id from activities where id = pg_temp.u(601)), 'ev-a', 'evento mantido');
select is((select meet_url from activities where id = pg_temp.u(601)), 'https://meet.google.com/a', 'link do Meet mantido');
select is((select row(calendar_state, calendar_attempts, calendar_error)::text from activities where id = pg_temp.u(601)),
  row('error'::text, 3, 'falha'::text)::text, 'estado só muda para pendente: synced é desfeito');
select is((select row(calendar_invited_email, calendar_generation, calendar_is_organizer, calendar_local_changed_at)::text
           from activities where id = pg_temp.u(601)),
  row('cliente@acme.test'::text, 1, null::boolean, '2026-01-01'::timestamptz)::text, 'convidado, geração, organizador e hora mantidos');

-- 4. "Tentar de novo": pendente com tentativas e erro zerados ---------------------------------------------------
select pg_temp.as_user(pg_temp.u(11));
update activities set calendar_state = 'pending', calendar_attempts = 9, calendar_error = 'qualquer' where id = pg_temp.u(601);
select pg_temp.as_pg();
select is((select row(calendar_state, calendar_attempts, calendar_error)::text from activities where id = pg_temp.u(601)),
  row('pending'::text, 0, null::text)::text, 'Tentar de novo: pendente, tentativas 0 e erro nulo');
select is((select calendar_event_id from activities where id = pg_temp.u(601)), 'ev-a', 'e o vínculo continua');

-- 5. mudança do usuário no que aparece no evento marca pendente com a hora ---------------------------------------
update activities set calendar_state = 'synced', calendar_local_changed_at = '2026-01-01' where id = pg_temp.u(601);
select pg_temp.as_user(pg_temp.u(11));
update activities set subject = 'tst-a2' where id = pg_temp.u(601);
select pg_temp.as_pg();
select is((select calendar_state from activities where id = pg_temp.u(601)), 'pending', 'assunto mudado: pendente');
select isnt((select calendar_local_changed_at from activities where id = pg_temp.u(601)), '2026-01-01'::timestamptz, 'com a hora nova');

-- 6. funções do sistema gravam as colunas novas, sem marcar pendente --------------------------------------------
select calendar_mark_synced(pg_temp.u(601),
  '{"calendar_state":"synced","calendar_invited_email":"novo@acme.test","calendar_generation":2}'::jsonb);
select is((select row(calendar_state, calendar_invited_email, calendar_generation)::text from activities where id = pg_temp.u(601)),
  row('synced'::text, 'novo@acme.test'::text, 2)::text, 'calendar_mark_synced grava convidado e geração');
select calendar_apply_inbound(pg_temp.u(601), '{"calendar_invited_email":"outro@acme.test","subject":"tst-a3"}'::jsonb);
select is((select row(subject, calendar_invited_email, calendar_state)::text from activities where id = pg_temp.u(601)),
  row('tst-a3'::text, 'outro@acme.test'::text, 'synced'::text)::text, 'calendar_apply_inbound grava o convidado sem marcar pendente');
select set_config('tst.da_agenda', calendar_insert_inbound(jsonb_build_object(
  'company_id', pg_temp.u(1), 'owner_id', pg_temp.u(11), 'type_id', pg_temp.tipo(), 'channel_id', pg_temp.canal(),
  'subject', 'tst-da-agenda', 'due_at', now() + interval '2 days', 'calendar_account_id', pg_temp.u(401),
  'calendar_event_id', 'ev-g', 'calendar_state', 'synced', 'calendar_is_organizer', true))::text, true);
select is((select calendar_is_organizer from activities where id = current_setting('tst.da_agenda')::uuid), true,
  'calendar_insert_inbound grava se o vendedor organiza o evento');

-- 7. um evento de uma caixa fica ligado a uma atividade só -----------------------------------------------------
select throws_ok($$ insert into activities (company_id, owner_id, created_by, type_id, channel_id, subject, due_at, deal_id,
  calendar_account_id, calendar_event_id)
  values (pg_temp.u(1), pg_temp.u(11), pg_temp.u(11), pg_temp.tipo(), pg_temp.canal(), 'tst-dup', now(), pg_temp.u(201),
  pg_temp.u(401), 'ev-a') $$, '23505', null, 'o mesmo evento da mesma caixa não liga duas atividades');
select lives_ok($$ insert into activities (company_id, owner_id, created_by, type_id, channel_id, subject, due_at, deal_id,
  calendar_event_id)
  values (pg_temp.u(1), pg_temp.u(11), pg_temp.u(11), pg_temp.tipo(), pg_temp.canal(), 'tst-sem-caixa', now(), pg_temp.u(201), 'ev-a') $$,
  'sem a caixa (desconectada), o id do evento pode repetir');

select * from finish();
rollback;
