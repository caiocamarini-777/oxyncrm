begin;
select plan(12);

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

insert into companies (id, name, slug) values (pg_temp.u(1), 'Paridade Teste', 'tst-par'), (pg_temp.u(2), 'Outra Teste', 'tst-par2');
insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data) values
  (pg_temp.u(11), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tst-par@oxyn.test', '{"full_name":"gestor"}');
insert into roles (id, name, description, permissions) values
  (pg_temp.u(21), 'tst-Gestor-par', 'teste', '{"visibility":{"leads":"company","deals":"company","persons":"company","organizations":"company","activities":"company"},"actions":{"create":true,"edit":true,"delete":true,"export":true,"reassign_owner":true},"settings":{"manage_pipelines":true,"manage_custom_fields":true,"manage_products":true,"view_reports":true,"create_dashboards":true,"share_dashboards":true}}'::jsonb);
insert into memberships (user_id, company_id, role_id) values (pg_temp.u(11), pg_temp.u(1), pg_temp.u(21));
insert into pipelines (id, company_id, name, next_activity_rule) values (pg_temp.u(402), pg_temp.u(1), 'tst-funil', 'off');
insert into stages (id, pipeline_id, company_id, name, position) values (pg_temp.u(502), pg_temp.u(402), pg_temp.u(1), 'tst-e', 0);
insert into lead_sources (id, company_id, name) values (pg_temp.u(601), pg_temp.u(1), 'tst-Jitterbit'), (pg_temp.u(602), pg_temp.u(2), 'tst-Outra');
insert into deals (id, company_id, owner_id, title, pipeline_id, stage_id, created_by) values
  (pg_temp.u(201), pg_temp.u(1), pg_temp.u(11), 'tst-neg', pg_temp.u(402), pg_temp.u(502), pg_temp.u(11));

-- 1. canal de origem do negócio
update deals set source_id = pg_temp.u(601) where id = pg_temp.u(201);
select is((select source_id from deals where id = pg_temp.u(201)), pg_temp.u(601), 'negócio grava canal de origem');
select throws_ok($$ update deals set source_id = pg_temp.u(602) where id = pg_temp.u(201) $$,
  'P0001', 'OXYN_CROSS_COMPANY', 'canal de outra empresa é barrado');

-- 2. resultados de reunião semeados
select is((select count(*) from activity_outcomes where company_id = pg_temp.u(1) and applies_to = 'meeting'), 3::bigint,
  'empresa nova ganha os três resultados de reunião');
select is((select classification from activity_outcomes where company_id = pg_temp.u(1) and name = 'Concluída qualificada'),
  'success', 'qualificada é sucesso');

-- 3. complete_activity com qualificação
create function pg_temp.mk(n int, tname text) returns void language plpgsql as $$
begin
  insert into activities (id, company_id, owner_id, created_by, type_id, channel_id, subject, due_at, deal_id)
  values (pg_temp.u(n), pg_temp.u(1), pg_temp.u(11), pg_temp.u(11),
    (select id from activity_types where company_id = pg_temp.u(1) and name = tname),
    (select id from activity_channels where company_id = pg_temp.u(1) and name = 'E-mail'),
    'tst-ativ-' || n, now(), pg_temp.u(201));
end $$;
create function pg_temp.oid(nm text) returns uuid language sql stable as $$
  select id from activity_outcomes where company_id = pg_temp.u(1) and name = nm $$;
grant execute on function pg_temp.mk(int, text), pg_temp.oid(text) to public;
select pg_temp.mk(701, 'Reunião');
select pg_temp.mk(702, 'Reunião');
select pg_temp.mk(703, 'Reunião');
select pg_temp.mk(704, 'Tarefa');
select pg_temp.mk(705, 'Reunião');

select pg_temp.as_user(pg_temp.u(11));
select lives_ok($$ select complete_activity(pg_temp.u(701), pg_temp.oid('Concluída qualificada'), 'held') $$,
  'reunião realizada com qualificação');
select is((select meeting_outcome || ':' || (select name from activity_outcomes o where o.id = a.outcome_id)
  from activities a where id = pg_temp.u(701)), 'held:Concluída qualificada', 'grava desfecho e qualificação');
select lives_ok($$ select complete_activity(pg_temp.u(705), null, 'held') $$, 'qualificação é opcional');
select throws_ok($$ select complete_activity(pg_temp.u(702), pg_temp.oid('Concluída qualificada'), 'no_show') $$,
  'P0001', 'OXYN_OUTCOME_REQUIRED', 'qualificação só com reunião realizada');
select throws_ok($$ select complete_activity(pg_temp.u(703), pg_temp.oid('Sem resposta'), 'held') $$,
  'P0001', 'OXYN_OUTCOME_REQUIRED', 'reunião não aceita resultado de tentativa');
select throws_ok($$ select complete_activity(pg_temp.u(704), pg_temp.oid('Concluída qualificada')) $$,
  'P0001', 'OXYN_OUTCOME_REQUIRED', 'tentativa não aceita resultado de reunião');

-- 4. check da tabela
select pg_temp.as_pg();
select throws_ok($$ update activities set done = true, completed_at = now(), meeting_outcome = 'no_show',
  outcome_id = pg_temp.oid('Concluída qualificada') where id = pg_temp.u(702) $$,
  '23514', null, 'resultado com desfecho diferente de held é barrado pelo check');
select lives_ok($$ update activities set done = true, completed_at = now(), meeting_outcome = 'held',
  outcome_id = pg_temp.oid('Concluída com pendência') where id = pg_temp.u(702) $$,
  'held com resultado passa no check');

select * from finish();
rollback;
